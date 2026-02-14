import { EventEmitter } from "node:events";
import { WorkerMessage, WorkerMessageType } from "../types/index.js";
import { ulid } from "ulidx";

export interface WebSocketClientConfig {
  url?: string;
  workerId: number;
  reconnectInterval?: number; // Default 5000ms
  maxReconnectAttempts?: number; // Default Infinity
  messageTimeout?: number; // Default 5000ms
  enableAutoReconnect?: boolean; // Default true
  enableHeartbeat?: boolean; // Default true
}

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout?: NodeJS.Timeout;
}

/**
 * WebSocket client for worker communication using Bun's native WebSocket
 * Handles connection management, reconnection, and message acknowledgment
 */
export class WebSocketClient extends EventEmitter {
  private ws?: WebSocket;
  private config: Required<WebSocketClientConfig>;
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimeout?: NodeJS.Timeout;
  private isConnected = false;
  private isConnecting = false;
  private shouldReconnect = true;
  private messageQueue: WorkerMessage[] = [];

  constructor(config: WebSocketClientConfig) {
    super();
    this.config = {
      url: config.url || "ws://localhost:8080/worker",
      workerId: config.workerId,
      reconnectInterval: config.reconnectInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || Infinity,
      messageTimeout: config.messageTimeout || 5000,
      enableAutoReconnect: config.enableAutoReconnect !== false,
      enableHeartbeat: config.enableHeartbeat !== false,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      await this.establishConnection();
    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Establish WebSocket connection using Bun's native WebSocket
   */
  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use native WebSocket (available in Bun)
        this.ws = new WebSocket(this.config.url);

        const connectionTimeout = setTimeout(() => {
          if (this.ws) {
            this.ws.close();
          }
          reject(new Error("Connection timeout"));
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.handleOpen();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (event) => {
          clearTimeout(connectionTimeout);
          this.handleError(new Error("WebSocket error"));
          reject(new Error("WebSocket error"));
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          this.handleClose(event.code, event.reason);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();

    this.emit("disconnected");
  }

  /**
   * Send a message to the server
   */
  async send(message: WorkerMessage): Promise<void> {
    // Add message ID if not present
    if (!message.id) {
      message.id = ulid();
    }

    // Queue message if not connected
    if (!this.isConnected) {
      if (this.config.enableAutoReconnect) {
        this.messageQueue.push(message);
        this.emit("message-queued", message);
        return;
      } else {
        throw new Error("Not connected to WebSocket server");
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not open"));
        return;
      }

      try {
        this.ws.send(JSON.stringify(message));
        resolve();
        this.emit("message-sent", message);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send a message and wait for a response
   */
  async sendAndWait<T = any>(
    message: WorkerMessage,
    timeout?: number,
  ): Promise<T> {
    // Add message ID if not present
    if (!message.id) {
      message.id = ulid();
    }

    const messageId = message.id;
    const timeoutMs = timeout || this.config.messageTimeout;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout for message ${messageId}`));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(messageId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Send the message
      this.send(message).catch((error) => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(messageId);
        reject(error);
      });
    });
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    this.isConnected = true;
    this.isConnecting = false;
    this.reconnectAttempts = 0;

    this.emit("connected");

    // Send worker ready message
    this.send({
      type: WorkerMessageType.WORKER_READY,
      payload: { workerId: this.config.workerId },
    }).catch((error) => {
      console.error("Failed to send worker ready message:", error);
    });

    // Process queued messages
    this.processMessageQueue();
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string | ArrayBuffer | Blob): void {
    try {
      // Convert data to string if needed
      let messageStr: string;
      if (typeof data === "string") {
        messageStr = data;
      } else if (data instanceof ArrayBuffer) {
        messageStr = new TextDecoder().decode(data);
      } else {
        // Handle Blob (shouldn't happen in normal operation)
        console.error("Received Blob data, which is not supported");
        return;
      }

      const message: WorkerMessage = JSON.parse(messageStr);

      // Handle ping message
      if (message.type === WorkerMessageType.PING) {
        this.handlePing(message);
        return;
      }

      // Handle acknowledgment
      if (
        message.type === WorkerMessageType.JOB_ACK &&
        message.payload?.originalMessageId
      ) {
        this.handleAcknowledgment(message.payload.originalMessageId);
        return;
      }

      // Check if this is a response to a pending request
      if (message.id) {
        const pendingRequest = this.pendingRequests.get(message.id);
        if (pendingRequest) {
          if (pendingRequest.timeout) {
            clearTimeout(pendingRequest.timeout);
          }
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pendingRequest.reject(new Error(message.error));
          } else {
            pendingRequest.resolve(message.payload);
          }
          return;
        }
      }

      // Emit message for external handling
      this.emit("message", message);
      this.emit(`message:${message.type}`, message);
    } catch (error) {
      this.emit("parse-error", { data, error });
    }
  }

  /**
   * Handle ping message
   */
  private handlePing(message: WorkerMessage): void {
    const pongMessage: WorkerMessage = {
      type: WorkerMessageType.PONG,
      id: message.id,
      payload: {
        workerId: this.config.workerId,
        timestamp: Date.now(),
      },
    };

    this.send(pongMessage).catch((error) => {
      console.error("Failed to send pong:", error);
    });
  }

  /**
   * Handle message acknowledgment
   */
  private handleAcknowledgment(originalMessageId: string): void {
    this.emit("acknowledgment", originalMessageId);
  }

  /**
   * Handle WebSocket error
   */
  private handleError(error: Error): void {
    this.emit("error", error);

    // Attempt reconnection if enabled
    if (this.config.enableAutoReconnect && this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(code: number, reason: string): void {
    this.isConnected = false;
    this.isConnecting = false;
    this.ws = undefined;

    this.emit("closed", { code, reason });

    // Attempt reconnection if enabled
    if (this.config.enableAutoReconnect && this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.emit("max-reconnect-attempts", this.reconnectAttempts);
      this.shouldReconnect = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1),
      30000, // Max 30 seconds
    );

    this.emit("reconnecting", {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = undefined;

      try {
        await this.establishConnection();
      } catch (error) {
        // Will trigger another reconnect attempt through error handler
        this.emit("reconnect-failed", {
          attempt: this.reconnectAttempts,
          error,
        });
      }
    }, delay);
  }

  /**
   * Process queued messages after reconnection
   */
  private async processMessageQueue(): Promise<void> {
    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of queue) {
      try {
        await this.send(message);
      } catch (error) {
        this.emit("queue-process-error", { message, error });
      }
    }
  }

  /**
   * Get client statistics
   */
  getStats(): {
    isConnected: boolean;
    isConnecting: boolean;
    reconnectAttempts: number;
    pendingRequests: number;
    queuedMessages: number;
    config: Required<WebSocketClientConfig>;
  } {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
      queuedMessages: this.messageQueue.length,
      config: this.config,
    };
  }

  /**
   * Wait for connection to be established
   */
  async waitForConnection(timeout: number = 10000): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.off("connected", onConnected);
        reject(new Error("Connection timeout"));
      }, timeout);

      const onConnected = () => {
        clearTimeout(timeoutHandle);
        resolve();
      };

      this.once("connected", onConnected);

      // Try to connect if not already attempting
      if (!this.isConnecting) {
        this.connect().catch(reject);
      }
    });
  }

  /**
   * Check if connected
   */
  isConnectedToServer(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}
