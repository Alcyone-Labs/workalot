import { Elysia, t } from "elysia";
import { EventEmitter } from "node:events";
import { WorkerMessage, WorkerMessageType, type ChannelMessage } from "../types/index.js";

import { ulid } from "ulidx";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { trace, metrics, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("workalot-ws");
const meter = metrics.getMeter("workalot-ws");

const connectionCounter = meter.createUpDownCounter("ws_connections", {
  description: "Number of active WebSocket connections",
});

const messageCounter = meter.createCounter("ws_messages_received", {
  description: "Total number of messages received",
});

const messageSentCounter = meter.createCounter("ws_messages_sent", {
  description: "Total number of messages sent",
});

export interface WebSocketConnection {
  id: string;
  workerId?: number;
  ws: any; // Elysia WebSocket instance
  connectedAt: Date;
  lastPing?: Date;
  lastPong?: Date;
  pendingMessages: Map<string, PendingMessage>;
}

export type { ChannelMessage } from "../types/index.js";

export interface PendingMessage {
  message: WorkerMessage;
  timestamp: Date;
  retryCount: number;
  ackTimeout?: NodeJS.Timeout;
}

export interface WebSocketServerConfig {
  port?: number;
  hostname?: string;
  messageTimeout?: number;
  maxRetries?: number;
  pingInterval?: number;
  enableMessageRecovery?: boolean;
  enableHeartbeat?: boolean;
}

export interface MessageRoute {
  pattern: string | RegExp | ((message: WorkerMessage) => boolean);
  handler: (connection: WebSocketConnection, message: WorkerMessage) => Promise<void> | void;
  priority?: number;
}

export interface ChannelRoute {
  handler: (connection: WebSocketConnection, message: ChannelMessage) => Promise<void> | void;
  priority?: number;
}

/**
 * WebSocket server for centralized worker communication
 * Provides reliable message delivery with acknowledgment and recovery
 */
export class WebSocketServer extends EventEmitter {
  private app?: any;
  private config: Required<WebSocketServerConfig>;
  private connections = new Map<string, WebSocketConnection>();
  private workerConnections = new Map<number, string>();
  private messageRoutes: MessageRoute[] = [];
  private channelRoutes: ChannelRoute[] = [];
  private heartbeatInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(config: WebSocketServerConfig = {}) {
    super();
    this.config = {
      port: config.port || 8080,
      hostname: config.hostname || "localhost",
      messageTimeout: config.messageTimeout || 5000,
      maxRetries: config.maxRetries || 3,
      pingInterval: config.pingInterval || 30000,
      enableMessageRecovery: config.enableMessageRecovery !== false,
      enableHeartbeat: config.enableHeartbeat !== false,
    };
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("WebSocket server is already running");
    }

    const self = this;

    // Check if we're running in Bun before initializing WebSocket server
    if (typeof globalThis.Bun !== "undefined") {
      this.app = new Elysia()
        .use(opentelemetry())
        .ws("/worker", {
          body: t.Object({
            type: t.String(),
            payload: t.Optional(t.Any()),
            id: t.Optional(t.String()),
            error: t.Optional(t.String()),
          }),
          open(ws) {
            const connectionId = ulid();
            const connection: WebSocketConnection = {
              id: connectionId,
              ws,
              connectedAt: new Date(),
              pendingMessages: new Map(),
            };

            // Store connection
            self.connections.set(connectionId, connection);

            // Store reference in ws for later access
            (ws.raw as any).connectionId = connectionId;

            connectionCounter.add(1);

            self.emit("connection", connection);
            self.emit("connection-established", {
              connectionId,
            });
          },
          message(ws: any, message: WorkerMessage) {
            const connectionId = (ws.raw as any).connectionId;
            const connection = self.connections.get(connectionId);

            if (!connection) {
              console.error("Connection not found:", connectionId);
              return;
            }

            // Handle different message types
            self.handleMessage(connection, message);

            self.emit("message", {
              connectionId,
              message,
            });
          },
          close(ws: any, code: number, reason: string) {
            const connectionId = (ws.raw as any).connectionId;
            const connection = self.connections.get(connectionId);

            if (connection) {
              self.handleDisconnection(connection);
              connectionCounter.add(-1);
              self.emit("close", {
                connectionId,
                code,
                message: reason,
              });
            }
          },
        })
        .listen({
          port: this.config.port,
          hostname: this.config.hostname,
        });

      this.isRunning = true;

      // Start heartbeat if enabled
      if (this.config.enableHeartbeat) {
        this.startHeartbeat();
      }

      this.emit("started", {
        port: this.config.port,
        hostname: this.config.hostname,
      });
    } else {
      // In Node.js environment, we can't start a WebSocket server
      // Just mark as running and emit started event
      this.isRunning = true;
      this.emit("started", {
        port: this.config.port,
        hostname: this.config.hostname,
      });
    }
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // Clean up all connections
    for (const connection of this.connections.values()) {
      this.cleanupConnection(connection);
      if (connection.ws && typeof connection.ws.close === "function") {
        connection.ws.close();
      }
    }

    // Stop the server
    if (this.app) {
      await this.app.stop();
      this.app = undefined;
    }

    this.connections.clear();
    this.workerConnections.clear();
    this.isRunning = false;

    this.emit("stopped");
  }

  /**
   * Send a message to a specific connection
   */
  sendToConnection(connectionId: string, message: WorkerMessage): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.ws) {
      return false;
    }

    return this.sendMessage(connection, message);
  }

  /**
   * Send a message to a specific worker
   */
  sendToWorker(workerId: number, message: WorkerMessage): boolean {
    const connectionId = this.workerConnections.get(workerId);
    if (!connectionId) {
      return false;
    }

    return this.sendToConnection(connectionId, message);
  }

  /**
   * Broadcast a message to all connections
   */
  broadcast(message: WorkerMessage): void {
    for (const connection of this.connections.values()) {
      this.sendMessage(connection, message);
    }
  }

  /**
   * Register a message route
   */
  registerRoute(route: MessageRoute): void {
    this.messageRoutes.push(route);
    this.messageRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Register a channel route
   */
  registerChannelRoute(route: ChannelRoute): void {
    this.channelRoutes.push(route);
    this.channelRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Register a structured route with custom predicate
   */
  registerStructuredRoute(
    predicate: (message: WorkerMessage) => boolean,
    handler: (connection: WebSocketConnection, message: WorkerMessage) => Promise<void> | void,
    priority?: number,
  ): void {
    const route: MessageRoute = {
      pattern: (message: WorkerMessage) => predicate(message),
      handler,
      priority,
    };
    this.registerRoute(route);
  }

  /**
   * Send a channel message to a specific worker
   */
  sendChannelToWorker(workerId: number, message: ChannelMessage): boolean {
    const channelMessage: WorkerMessage = {
      type: WorkerMessageType.CHANNEL,
      id: ulid(),
      payload: message,
    };

    return this.sendToWorker(workerId, channelMessage);
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): WebSocketConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all active connections
   */
  getAllConnections(): WebSocketConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Send a message to a connection
   */
  private sendMessage(
    connection: WebSocketConnection,
    message: WorkerMessage,
    isRetry = false,
  ): boolean {
    try {
      // Send the message using Elysia's send method
      if (connection.ws && typeof connection.ws.send === "function") {
        connection.ws.send(JSON.stringify(message));

        // Track message for recovery if enabled
        if (this.config.enableMessageRecovery && !isRetry && message.id) {
          this.trackPendingMessage(connection, message);
        }

        this.emit("message-sent", {
          connectionId: connection.id,
          message,
        });

        messageSentCounter.add(1, { type: message.type });

        return true;
      }
      return false;
    } catch (error) {
      this.emit("message-error", {
        connectionId: connection.id,
        message,
        error,
      });
      return false;
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(
    connection: WebSocketConnection,
    message: WorkerMessage,
  ): Promise<void> {
    return tracer.startActiveSpan("WebSocketServer.handleMessage", async (span) => {
      span.setAttribute("message.type", message.type);
      span.setAttribute("connection.id", connection.id);
      if (message.id) span.setAttribute("message.id", message.id);

      messageCounter.add(1, { type: message.type });

      try {
        // Update last activity
        connection.lastPing = new Date();

        // Handle acknowledgments
        if (message.type === WorkerMessageType.JOB_ACK && message.payload?.originalMessageId) {
          this.handleAcknowledgment(connection, message.payload.originalMessageId);
          span.addEvent("Ack handled");
          return;
        }

        // Handle pong messages
        if (message.type === WorkerMessageType.PONG) {
          connection.lastPong = new Date();
          span.addEvent("Pong handled");
          return;
        }

        // Handle channel messages
        if (message.type === WorkerMessageType.CHANNEL && message.payload) {
          const channelMessage = message.payload as ChannelMessage;
          for (const route of this.channelRoutes) {
            await route.handler(connection, channelMessage);
          }
          span.addEvent("Channel message passed to routes");
          return;
        }

        // Route message to handlers
        for (const route of this.messageRoutes) {
          if (this.matchesRoute(message, route.pattern)) {
            await route.handler(connection, message);
          }
        }

        // Handle worker registration
        if (message.type === WorkerMessageType.WORKER_READY) {
          console.log("WebSocketServer: Received WORKER_READY message", message);
          await this.handleWorkerReady(connection, message);
          span.addEvent("Worker registered");
        }

        // Send acknowledgment if message has an ID
        if (message.id) {
          await this.sendAcknowledgment(connection, message.id);
          span.addEvent("Ack sent");
        }

        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Check if a message matches a route pattern
   */
  private matchesRoute(
    message: WorkerMessage,
    pattern: string | RegExp | ((message: WorkerMessage) => boolean),
  ): boolean {
    if (typeof pattern === "string") {
      return message.type === pattern;
    }
    if (typeof pattern === "function") {
      return pattern(message);
    }
    return pattern.test(message.type);
  }

  /**
   * Track a pending message for recovery
   */
  private trackPendingMessage(connection: WebSocketConnection, message: WorkerMessage): void {
    if (!message.id) return;

    const pending: PendingMessage = {
      message,
      timestamp: new Date(),
      retryCount: 0,
    };

    // Set timeout for acknowledgment
    pending.ackTimeout = setTimeout(() => {
      this.handleMessageTimeout(connection, message.id!);
    }, this.config.messageTimeout);

    connection.pendingMessages.set(message.id, pending);
  }

  /**
   * Handle message acknowledgment
   */
  private handleAcknowledgment(connection: WebSocketConnection, messageId: string): void {
    const pending = connection.pendingMessages.get(messageId);
    if (pending) {
      if (pending.ackTimeout) {
        clearTimeout(pending.ackTimeout);
      }
      connection.pendingMessages.delete(messageId);

      this.emit("message-acknowledged", {
        connectionId: connection.id,
        messageId,
      });
    }
  }

  /**
   * Handle message timeout
   */
  private handleMessageTimeout(connection: WebSocketConnection, messageId: string): void {
    const pending = connection.pendingMessages.get(messageId);
    if (!pending) return;

    pending.retryCount++;

    if (pending.retryCount <= this.config.maxRetries) {
      // Retry sending the message
      this.sendMessage(connection, pending.message, true);

      // Reset timeout
      pending.ackTimeout = setTimeout(() => {
        this.handleMessageTimeout(connection, messageId);
      }, this.config.messageTimeout);

      this.emit("message-retry", {
        connectionId: connection.id,
        messageId,
        retryCount: pending.retryCount,
      });
    } else {
      // Max retries reached, give up
      connection.pendingMessages.delete(messageId);

      this.emit("message-failed", {
        connectionId: connection.id,
        messageId,
        message: pending.message,
      });
    }
  }

  /**
   * Handle worker ready message
   */
  private async handleWorkerReady(
    connection: WebSocketConnection,
    message: WorkerMessage,
  ): Promise<void> {
    const workerId = message.payload?.workerId;
    if (!workerId) return;

    // Check if worker is already registered
    const existingConnectionId = this.workerConnections.get(workerId);
    if (existingConnectionId && existingConnectionId !== connection.id) {
      // Close existing connection
      const existingConnection = this.connections.get(existingConnectionId);
      if (existingConnection?.ws) {
        existingConnection.ws.close();
      }
      this.connections.delete(existingConnectionId);
    }

    // Register new connection
    connection.workerId = workerId;
    this.workerConnections.set(workerId, connection.id);

    this.emit("worker-ready", {
      workerId,
      connectionId: connection.id,
    });
  }

  /**
   * Send acknowledgment message
   */
  private async sendAcknowledgment(
    connection: WebSocketConnection,
    messageId: string,
  ): Promise<void> {
    const ackMessage: WorkerMessage = {
      type: WorkerMessageType.JOB_ACK,
      id: ulid(),
      payload: { originalMessageId: messageId },
    };

    this.sendMessage(connection, ackMessage);
  }

  /**
   * Handle connection disconnection
   */
  private handleDisconnection(connection: WebSocketConnection): void {
    // Clean up worker registration
    if (connection.workerId !== undefined) {
      this.workerConnections.delete(connection.workerId);

      this.emit("worker-disconnected", {
        workerId: connection.workerId,
        connectionId: connection.id,
      });
    }

    // Clean up connection
    this.cleanupConnection(connection);
    this.connections.delete(connection.id);

    this.emit("connection-closed", {
      connectionId: connection.id,
    });
  }

  /**
   * Clean up connection resources
   */
  private cleanupConnection(connection: WebSocketConnection): void {
    // Clear all pending message timeouts
    for (const pending of connection.pendingMessages.values()) {
      if (pending.ackTimeout) {
        clearTimeout(pending.ackTimeout);
      }
    }
    connection.pendingMessages.clear();
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeat();
    }, this.config.pingInterval);
  }

  /**
   * Perform heartbeat check
   */
  private async performHeartbeat(): Promise<void> {
    const now = Date.now();
    const timeout = this.config.pingInterval * 2;

    for (const connection of this.connections.values()) {
      // Send ping
      const pingMessage: WorkerMessage = {
        type: WorkerMessageType.PING,
        id: ulid(),
      };
      this.sendMessage(connection, pingMessage);

      // Check for stale connections
      if (connection.lastPong) {
        const timeSinceLastPong = now - connection.lastPong.getTime();
        if (timeSinceLastPong > timeout) {
          // Connection is stale, close it
          this.emit("connection-stale", {
            connectionId: connection.id,
            workerId: connection.workerId,
            lastPong: connection.lastPong,
          });

          this.cleanupConnection(connection);
          if (connection.ws && typeof connection.ws.close === "function") {
            connection.ws.close();
          }
        }
      }
    }
  }

  /**
   * Get server statistics
   */
  getStats(): {
    isRunning: boolean;
    connections: number;
    workers: number;
    pendingMessages: number;
  } {
    let pendingMessages = 0;
    for (const connection of this.connections.values()) {
      pendingMessages += connection.pendingMessages.size;
    }

    return {
      isRunning: this.isRunning,
      connections: this.connections.size,
      workers: this.workerConnections.size,
      pendingMessages,
    };
  }
}
