import { EventEmitter } from "node:events";
import { WebSocketClient } from "../../communication/WebSocketClient.js";
import { JobExecutor } from "../../jobs/index.js";
import {
  JobPayload,
  JobResult,
  WorkerMessage,
  WorkerMessageType,
  JobExecutionContext,
} from "../../types/index.js";

export interface SimpleWorkerConfig {
  workerId: number;
  wsUrl?: string;
  projectRoot?: string;
  defaultTimeout?: number;
  silent?: boolean;
}

/**
 * Simplified worker class for basic job execution
 *
 * This class provides the minimal functionality needed for a worker:
 * - Connect to orchestrator via WebSocket
 * - Execute jobs
 * - Report results
 *
 * For advanced use cases, extend BaseWorker instead.
 */
export class SimpleWorker extends EventEmitter {
  protected config: SimpleWorkerConfig;
  protected wsClient: WebSocketClient;
  protected jobExecutor: JobExecutor;
  protected isReady = false;

  constructor(config: SimpleWorkerConfig) {
    super();

    this.config = {
      wsUrl: "ws://localhost:8080/worker",
      projectRoot: process.cwd(),
      defaultTimeout: 30000,
      silent: false,
      ...config,
    };

    // Set up silent mode if requested
    if (this.config.silent) {
      this.setupSilentMode();
    }

    // Initialize WebSocket client
    this.wsClient = new WebSocketClient({
      url: this.config.wsUrl!,
      workerId: this.config.workerId,
      enableAutoReconnect: true,
      enableHeartbeat: true,
    });

    // Initialize job executor
    this.jobExecutor = new JobExecutor(
      this.config.projectRoot!,
      this.config.defaultTimeout!,
    );
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    // Connect to WebSocket server
    await this.wsClient.connect();

    // Set up message handling
    this.wsClient.on("message", (message: WorkerMessage) => {
      this.handleMessage(message);
    });

    // Send ready signal
    this.wsClient.send({
      type: WorkerMessageType.WORKER_READY,
      id: this.generateId(),
      payload: {
        workerId: this.config.workerId,
      },
    });

    this.isReady = true;
    this.emit("ready");
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    this.isReady = false;
    await this.wsClient.disconnect();
    this.emit("stopped");
  }

  /**
   * Handle incoming messages
   */
  protected async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case WorkerMessageType.EXECUTE_JOB:
        await this.executeJob(message.payload as JobPayload);
        break;

      case WorkerMessageType.PING:
        this.handleHealthCheck();
        break;

      case WorkerMessageType.WORKER_ERROR:
        // Handle shutdown or error message
        if (message.payload?.shutdown) {
          await this.stop();
        }
        break;

      default:
        // Ignore other message types
        break;
    }
  }

  /**
   * Execute a job
   */
  protected async executeJob(jobPayload: JobPayload): Promise<void> {
    const startTime = Date.now();
    const context: JobExecutionContext = {
      jobId: this.generateId(),
      startTime: Date.now(),
      queueTime: 0,
      timeout: jobPayload.jobTimeout || 5000,
      scheduleAndWait: (jobPayload) => Promise.resolve(this.generateId()),
      schedule: (jobPayload) => this.generateId(),
      _schedulingRequests: [],
    };

    try {
      // Execute the job
      const result = await this.jobExecutor.executeJob(jobPayload, context);

      // Send success result
const jobResult: JobResult = {
      results: result,
      executionTime: Date.now() - startTime,
      queueTime: 0,
    };

      this.wsClient.send({
        type: WorkerMessageType.JOB_RESULT,
        id: this.generateId(),
        payload: jobResult,
      });

      this.emit("job-completed", jobResult);
    } catch (error) {
      // Send error result
const jobResult: JobResult = {
      results: { error: error instanceof Error ? error.message : String(error) },
      executionTime: Date.now() - startTime,
      queueTime: 0,
    };

      this.wsClient.send({
        type: WorkerMessageType.JOB_ERROR,
        id: this.generateId(),
        payload: jobResult,
      });

      this.emit("job-failed", jobResult);
    }
  }

  /**
   * Handle health check request
   */
  protected handleHealthCheck(): void {
    this.wsClient.send({
      type: WorkerMessageType.PONG,
      id: this.generateId(),
      payload: {
        workerId: this.config.workerId,
        status: "healthy",
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Generate a unique ID
   */
  protected generateId(): string {
    return `${this.config.workerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set up silent mode
   */
  protected setupSilentMode(): void {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
  }

  /**
   * Get worker status
   */
  getStatus(): { ready: boolean; workerId: number } {
    return {
      ready: this.isReady,
      workerId: this.config.workerId,
    };
  }
}
