import { EventEmitter } from "node:events";
import {
  WebSocketServer,
  WebSocketConnection,
} from "../communication/WebSocketServer.js";
import { IQueueBackend } from "../queue/IQueueBackend.js";
import { QueueFactory } from "../queue/QueueFactory.js";
import {
  JobPayload,
  JobResult,
  JobStatus,
  QueueItem,
  WorkerMessage,
  WorkerMessageType,
} from "../types/index.js";
import { ulid } from "ulidx";

export interface SimpleOrchestratorConfig {
  wsPort?: number;
  wsHostname?: string;
  queueBackend?: IQueueBackend;
  queueConfig?: any;
  distributionStrategy?: "round-robin" | "least-loaded" | "random";
}

interface ConnectedWorker {
  workerId: number;
  connectionId: string;
  connection: WebSocketConnection;
  busy: boolean;
  jobsProcessed: number;
}

/**
 * Simplified orchestrator for basic job distribution
 *
 * This class provides the minimal functionality needed for orchestration:
 * - Accept worker connections via WebSocket
 * - Distribute jobs to workers
 * - Track job completion
 *
 * For advanced use cases, extend BaseOrchestrator instead.
 */
export class SimpleOrchestrator extends EventEmitter {
  private wsServer: WebSocketServer;
  private config: SimpleOrchestratorConfig;
  private workers = new Map<number, ConnectedWorker>();
  private queueBackend: IQueueBackend;
  private isRunning = false;
  private nextWorkerId = 1;
  private roundRobinIndex = 0;

  constructor(config: SimpleOrchestratorConfig = {}) {
    super();

    this.config = {
      wsPort: 8080,
      wsHostname: "localhost",
      distributionStrategy: "round-robin",
      ...config,
    };

    // Initialize WebSocket server
    this.wsServer = new WebSocketServer({
      port: this.config.wsPort!,
      hostname: this.config.wsHostname!,
    });

    // Initialize queue backend
    if (this.config.queueBackend) {
      this.queueBackend = this.config.queueBackend;
    } else {
      // Use static method to create queue
      this.queueBackend = QueueFactory.createQueue(
        this.config.queueConfig || {},
      );
    }
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // Initialize queue backend
    await this.queueBackend.initialize();

    // Set up WebSocket handlers
    this.setupWebSocketHandlers();

    // Start WebSocket server
    await this.wsServer.start();

    this.isRunning = true;
    this.emit("started");

    console.log(
      `SimpleOrchestrator listening on ws://${this.config.wsHostname}:${this.config.wsPort}`,
    );
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Disconnect all workers
    for (const worker of this.workers.values()) {
      if (
        worker.connection.ws &&
        typeof worker.connection.ws.close === "function"
      ) {
        worker.connection.ws.close();
      }
    }
    this.workers.clear();

    // Stop WebSocket server
    await this.wsServer.stop();

    // Shutdown queue backend
    await this.queueBackend.shutdown();

    this.emit("stopped");
  }

  /**
   * Add a job to the queue
   */
  async addJob(jobPayload: JobPayload): Promise<string> {
    const jobId = await this.queueBackend.addJob(jobPayload);
    this.emit("job-added", jobId);

    // Try to distribute immediately
    await this.distributeJobs();

    return jobId;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<QueueItem | undefined> {
    return await this.queueBackend.getJob(jobId);
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    return await this.queueBackend.getJobsByStatus(status);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<any> {
    return await this.queueBackend.getStats();
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): any {
    const stats = {
      totalWorkers: this.workers.size,
      availableWorkers: 0,
      busyWorkers: 0,
      workers: [] as any[],
    };

    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        stats.availableWorkers++;
      } else {
        stats.busyWorkers++;
      }

      stats.workers.push({
        id: worker.workerId,
        busy: worker.busy,
        jobsProcessed: worker.jobsProcessed,
      });
    }

    return stats;
  }

  /**
   * Set up WebSocket server handlers
   */
  private setupWebSocketHandlers(): void {
    this.wsServer.on("worker-ready", (data: { workerId: number; connectionId: string }) => {
      const workerId = data.workerId;
      const connection = this.wsServer.getConnection(data.connectionId);
      
      if (connection) {
        // Create worker record if it doesn't exist
        if (!this.workers.has(workerId)) {
          const worker: ConnectedWorker = {
            workerId,
            connectionId: connection.id,
            connection,
            busy: false,
            jobsProcessed: 0,
          };
          this.workers.set(workerId, worker);
          this.emit("worker-connected", workerId);
        }
      }
    });

    this.wsServer.on("connection-closed", (data: { connectionId: string }) => {
      // Find worker by connectionId
      for (const [workerId, worker] of this.workers.entries()) {
        if (worker.connectionId === data.connectionId) {
          this.workers.delete(workerId);
          this.emit("worker-disconnected", workerId);
          break;
        }
      }
    });

    this.wsServer.on("message", (data: { connectionId: string; message: WorkerMessage }) => {
      const connection = this.wsServer.getConnection(data.connectionId);
      if (connection && connection.workerId !== undefined) {
        this.handleWorkerMessage(connection.workerId, data.message);
      }
    });
  }

  /**
   * Handle messages from workers
   */
  private async handleWorkerMessage(
    workerId: number,
    message: WorkerMessage,
  ): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    switch (message.type) {
      case WorkerMessageType.WORKER_READY:
        // Worker is ready, try to send a job
        await this.sendJobToWorker(workerId);
        break;

      case WorkerMessageType.JOB_RESULT:
        await this.handleJobResult(workerId, message.payload as JobResult);
        break;

      case WorkerMessageType.JOB_ERROR:
        await this.handleJobError(workerId, message.payload);
        break;

      case WorkerMessageType.REQUEST_JOBS:
        // Worker requesting a job
        await this.sendJobToWorker(workerId);
        break;

      default:
        // Ignore other message types
        break;
    }
  }

  /**
   * Handle job result from worker
   */
  private async handleJobResult(
    workerId: number,
    result: JobResult,
  ): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.busy = false;
    worker.jobsProcessed++;

    // Note: JobResult doesn't have jobId, need to track it separately
    // For now, we'll emit the result as-is
    this.emit("job-completed", result);

    // Try to send another job
    await this.sendJobToWorker(workerId);
  }

  /**
   * Handle job error from worker
   */
  private async handleJobError(workerId: number, payload: any): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.busy = false;

    const error = new Error(payload.error || "Job execution failed");
    const result: JobResult = {
      results: { error: error.message },
      executionTime: payload.executionTime || 0,
      queueTime: 0,
    };

    this.emit("job-failed", result);

    // Try to send another job
    await this.sendJobToWorker(workerId);
  }

  /**
   * Send a job to a worker
   */
  private async sendJobToWorker(workerId: number): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker || worker.busy) return;

    // Get next job from queue
    const job = await this.queueBackend.getNextPendingJob();
    if (!job) return;

    worker.busy = true;

// Send job to worker via WebSocketServer
      this.wsServer.sendToWorker(workerId, {
        type: WorkerMessageType.EXECUTE_JOB,
        id: ulid(),
        payload: job.jobPayload,
      });

    this.emit("job-assigned", workerId, job.id);
  }

  /**
   * Distribute jobs to available workers
   */
  private async distributeJobs(): Promise<void> {
    const availableWorkers = this.getAvailableWorkers();

    for (const workerId of availableWorkers) {
      await this.sendJobToWorker(workerId);
    }
  }

  /**
   * Get available workers based on distribution strategy
   */
  private getAvailableWorkers(): number[] {
    const available = Array.from(this.workers.entries())
      .filter(([_, worker]) => !worker.busy)
      .map(([id, _]) => id);

    if (available.length === 0) return [];

    switch (this.config.distributionStrategy) {
      case "round-robin":
        // Return workers in round-robin order
        const sorted = available.sort((a, b) => a - b);
        if (this.roundRobinIndex >= sorted.length) {
          this.roundRobinIndex = 0;
        }
        const selected = sorted
          .slice(this.roundRobinIndex)
          .concat(sorted.slice(0, this.roundRobinIndex));
        this.roundRobinIndex = (this.roundRobinIndex + 1) % sorted.length;
        return selected;

      case "least-loaded":
        // Sort by jobs processed (ascending)
        return available.sort((a, b) => {
          const workerA = this.workers.get(a)!;
          const workerB = this.workers.get(b)!;
          return workerA.jobsProcessed - workerB.jobsProcessed;
        });

      case "random":
        // Shuffle array randomly
        for (let i = available.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [available[i], available[j]] = [available[j], available[i]];
        }
        return available;

      default:
        return available;
    }
  }

  /**
   * Check if orchestrator is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get number of connected workers
   */
  getWorkerCount(): number {
    return this.workers.size;
  }
}
