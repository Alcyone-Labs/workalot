import { EventEmitter } from "node:events";
import {
  WebSocketServer,
  WebSocketConnection,
} from "../communication/WebSocketServer.js";
import { QueueOrchestrator } from "./QueueOrchestrator.js";
import { JobExecutor } from "../jobs/JobExecutor.js";
import {
  JobPayload,
  JobResult,
  BatchJobContext,
  BatchExecutionResult,
  BatchJobResult,
  WorkerMessage,
  WorkerMessageType,
  QueueConfig,
  JobStatus,
  BaseJobExecutionContext,
} from "../types/index.js";
import { ulid } from "ulidx";

export interface WorkerManagerConfig {
  numWorkers?: number;
  projectRoot?: string;
  silent?: boolean;
  wsPort?: number;
  wsHostname?: string;
  enableHealthCheck?: boolean;
  healthCheckInterval?: number;
  jobTimeout?: number;
  batchTimeout?: number;
}

interface WorkerState {
  id: number;
  busy: boolean;
  ready: boolean;
  connectionId?: string;
  activeJobId?: string;
  currentJobId?: string;
}

export interface WorkerManagerEvents {
  initialized: () => void;
  "worker-error": (workerId: number, error: string) => void;
  "worker-connected": (workerId: number) => void;
  "worker-ready": (workerId: number) => void;
  "worker-disconnected": (workerId: number) => void;
  "job-queued": (jobId: string, jobPayload: JobPayload) => void;
  "job-result": (jobId: string, result: JobResult) => void;
  "job-completed": (jobId: string, result: JobResult) => void;
  "batch-completed": (workerId: number, result: BatchExecutionResult) => void;
  "job-error": (jobId: string, error: Error) => void;
  "job-failed": (jobId: string, error: string) => void;
  shutdown: () => void;
}

interface PendingJob {
  resolve: (result: JobResult) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
  jobId?: string;
  workerId?: number;
}

interface PendingBatch {
  resolve: (result: BatchExecutionResult) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
  jobIds: Set<string>;
  results: BatchJobContext[];
  workerId?: number;
}

/**
 * WebSocket-based WorkerManager
 * Manages worker connections and job distribution via WebSocket
 */
export class WorkerManager extends EventEmitter {
  private wsServer: WebSocketServer;
  private workerStates = new Map<number, WorkerState>();
  private workerConnections = new Map<number, WebSocketConnection>();
  private pendingJobs = new Map<string, PendingJob>();
  private pendingBatches = new Map<string, PendingBatch>();
  private config: Required<WorkerManagerConfig>;
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private queueOrchestrator: QueueOrchestrator;
  private jobExecutor: JobExecutor;
  private nextWorkerId = 1;
  private projectRoot: string;

  constructor(
    queueOrchestrator: QueueOrchestrator,
    config: WorkerManagerConfig = {},
  ) {
    super();

    this.queueOrchestrator = queueOrchestrator;
    this.projectRoot = config.projectRoot || process.cwd();

    this.config = {
      numWorkers: config.numWorkers || 4,
      projectRoot: this.projectRoot,
      silent: config.silent || false,
      wsPort: config.wsPort || 8080,
      wsHostname: config.wsHostname || "localhost",
      enableHealthCheck: config.enableHealthCheck !== false,
      healthCheckInterval: config.healthCheckInterval || 30000,
      jobTimeout: config.jobTimeout || 30000,
      batchTimeout: config.batchTimeout || 60000,
    };

    // Initialize WebSocket server
    this.wsServer = new WebSocketServer({
      port: this.config.wsPort,
      hostname: this.config.wsHostname,
    });

    // Initialize job executor
    this.jobExecutor = new JobExecutor(this.projectRoot, this.config.jobTimeout);

    this.setupWebSocketHandlers();
    this.setupOrchestratorEvents();
  }

  /**
   * Initialize the WorkerManager and wait for workers to connect
   */
  async initialize(): Promise<void> {
    // Check if we're running in Bun environment before starting WebSocket server
    if (typeof globalThis.Bun !== "undefined") {
      // Start WebSocket server
      await this.wsServer.start();

      console.log(
        `WorkerManager WebSocket server listening on ws://${this.config.wsHostname}:${this.config.wsPort}`,
      );
      console.log(`Waiting for ${this.config.numWorkers} workers to connect...`);
    } else {
      // In Node.js environment, register workers directly without WebSocket
      for (let i = 0; i < this.config.numWorkers; i++) {
        const workerId = this.nextWorkerId++;
        this.workerStates.set(workerId, {
          id: workerId,
          busy: false,
          ready: true, // Mark as ready immediately in Node.js environment
        });
        this.queueOrchestrator.registerWorker(workerId);
      }
      console.log(`WorkerManager initialized with ${this.config.numWorkers} workers in Node.js mode`);
    }

    this.emit("initialized");

    // Start health check if enabled and in Bun environment
    if (this.config.enableHealthCheck && typeof globalThis.Bun !== "undefined") {
      this.startHealthCheck();
    }

    // Note: Workers will connect asynchronously
    // The system will work with whatever workers are available
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupWebSocketHandlers(): void {
    // Handle new worker connections
    this.wsServer.on("connection", (connection: WebSocketConnection) => {
      const workerId = this.nextWorkerId++;

      // Store connection
      this.workerConnections.set(workerId, connection);

      // Initialize worker state
      this.workerStates.set(workerId, {
        id: workerId,
        busy: false,
        ready: false,
        connectionId: connection.id,
      });

      // Set up connection handlers through the server
      this.wsServer.on(
        "message",
        (data: { connectionId: string; message: WorkerMessage }) => {
          if (data.connectionId === connection.id) {
            this.handleWorkerMessage(workerId, data.message);
          }
        },
      );

      this.wsServer.on("close", (data: { connectionId: string }) => {
        if (data.connectionId === connection.id) {
          this.handleWorkerDisconnect(workerId);
        }
      });

      this.wsServer.on(
        "error",
        (data: { connectionId: string; error: Error }) => {
          if (data.connectionId === connection.id) {
            console.error(`Worker ${workerId} connection error:`, data.error);
            this.emit("worker-error", workerId, data.error.message);
          }
        },
      );

      // Send initialization message
      connection.ws.send({
        type: "init",
        payload: {
          workerId,
          projectRoot: this.projectRoot,
        },
      });

      this.emit("worker-connected", workerId);
    });
  }

  /**
   * Set up queue orchestrator event handlers
   */
  private setupOrchestratorEvents(): void {
    // Listen for job distribution events
    this.queueOrchestrator.on("jobs-available", async () => {
      const stats = this.queueOrchestrator.getStats();
      if (stats.totalPendingJobs > 0 && this.hasAvailableWorkers()) {
        await this.distributeJobsToWorkers(stats.totalPendingJobs);
      }
    });

    // Handle job results from orchestrator
    this.queueOrchestrator.on(
      "job-result",
      (jobId: string, result: JobResult) => {
        const pending = this.pendingJobs.get(jobId);
        if (pending) {
          if (pending.timeout) {
            clearTimeout(pending.timeout);
          }
          pending.resolve(result);
          this.pendingJobs.delete(jobId);
        }
      },
    );

    // Handle job errors from orchestrator
    this.queueOrchestrator.on("job-error", (jobId: string, error: Error) => {
      const pending = this.pendingJobs.get(jobId);
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.reject(error);
        this.pendingJobs.delete(jobId);
      }
    });
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) return;

    switch (message.type) {
      case WorkerMessageType.WORKER_READY:
        workerState.ready = true;
        this.queueOrchestrator.registerWorker(workerId);
        this.emit("worker-ready", workerId);
        break;

      case WorkerMessageType.JOB_RESULT:
        this.handleJobResult(workerId, message.payload as JobResult);
        break;

      case WorkerMessageType.BATCH_RESULT:
        this.handleBatchResult(
          workerId,
          message.payload as BatchExecutionResult,
        );
        break;

      case WorkerMessageType.JOB_ERROR:
        this.handleJobError(workerId, message.payload);
        break;

      case WorkerMessageType.REQUEST_JOBS:
        // Worker is requesting a job
        this.distributeJobToWorker(workerId);
        break;

      case WorkerMessageType.QUEUE_STATUS:
        // Update worker status
        Object.assign(workerState, message.payload);
        break;

      default:
        console.warn(
          `Unknown message type from worker ${workerId}:`,
          message.type,
        );
    }
  }

  /**
   * Handle worker disconnection
   */
  private handleWorkerDisconnect(workerId: number): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) return;

    // Clean up any pending jobs
    if (workerState.activeJobId) {
      const pending = this.pendingJobs.get(workerState.activeJobId);
      if (pending) {
        pending.reject(new Error(`Worker ${workerId} disconnected`));
        this.pendingJobs.delete(workerState.activeJobId);
      }
    }

    // Unregister from orchestrator
    this.queueOrchestrator.unregisterWorker(workerId);

    // Clean up state
    this.workerStates.delete(workerId);
    this.workerConnections.delete(workerId);

    this.emit("worker-disconnected", workerId);

    // Log if not shutting down
    if (!this.isShuttingDown) {
      console.log(
        `Worker ${workerId} disconnected. Waiting for reconnection...`,
      );
    }
  }

/**
   * Execute a single job
   */
  async executeJob(jobPayload: JobPayload, jobId?: string): Promise<JobResult> {
    // Check if we're running in Bun environment
    if (typeof globalThis.Bun !== "undefined") {
      const messageId = ulid();
      const actualJobId = jobId || ulid();

      return new Promise((resolve, reject) => {
        // Store pending job
        this.pendingJobs.set(messageId, {
          resolve,
          reject,
          jobId: actualJobId,
        });

        // Set timeout
        const timeout = setTimeout(() => {
          const pending = this.pendingJobs.get(messageId);
          if (pending) {
            pending.reject(new Error(`Job ${actualJobId} timed out`));
            this.pendingJobs.delete(messageId);
          }
        }, this.config.jobTimeout);

        this.pendingJobs.get(messageId)!.timeout = timeout;

        // Find available worker
        const workerId = this.getAvailableWorker();
        if (workerId === undefined) {
          // Queue the job - emit event for orchestrator to handle
          this.emit("job-queued", actualJobId, jobPayload);
          return;
        }

        // Send job to worker
        const connection = this.workerConnections.get(workerId);
        if (connection) {
          const workerState = this.workerStates.get(workerId)!;
          workerState.busy = true;
          workerState.activeJobId = messageId;
          workerState.currentJobId = actualJobId;

          connection.ws.send({
            type: WorkerMessageType.EXECUTE_JOB,
            id: messageId,
            payload: { ...jobPayload, id: actualJobId },
          });

          this.pendingJobs.get(messageId)!.workerId = workerId;
        }
      });
    } else {
      // In Node.js environment, execute job directly
      console.log(`[WorkerManager] Worker states: ${Array.from(this.workerStates.entries()).map(([id, state]) => ({id, busy: state.busy, ready: state.ready})).join(', ')}`);
      const workerId = this.getAvailableWorker();
      console.log(`[WorkerManager] Found available worker: ${workerId}`);
      if (workerId === undefined) {
        throw new Error("No available workers");
      }

      // Use the provided job ID or generate a new one
      const actualJobId = jobId || ulid();
      console.log(`[WorkerManager] Job ID: ${actualJobId}`);
      const context: BaseJobExecutionContext = {
        jobId: actualJobId,
        startTime: Date.now(),
        queueTime: 0,
        timeout: jobPayload.jobTimeout || this.config.jobTimeout,
      };

      // Mark worker as busy
      const workerState = this.workerStates.get(workerId)!;
      workerState.busy = true;
      workerState.currentJobId = actualJobId;
      console.log(`[WorkerManager] Worker ${workerId} marked as busy for job ${actualJobId}`);

      // Return a promise that resolves when the job completes
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log(`[WorkerManager] Job ${actualJobId} timed out`);
          reject(new Error(`Job ${actualJobId} timed out`));
        }, jobPayload.jobTimeout || this.config.jobTimeout);

        console.log(`[WorkerManager] About to execute job with payload:`, jobPayload);
        // Execute job and emit events for JobScheduler
        this.jobExecutor.executeJob(jobPayload, context)
          .then(result => {
            console.log(`[WorkerManager] Job ${actualJobId} completed with result:`, result);
            // Mark worker as available again
            workerState.busy = false;
            workerState.currentJobId = undefined;
            
            // Clear timeout
            clearTimeout(timeout);
            
            // Emit job completion events for JobScheduler
            console.log(`[WorkerManager] Emitting job-completed event for ${actualJobId}`);
            this.emit("job-completed", actualJobId, result);
            
            resolve(result);
          })
          .catch(error => {
            console.log(`[WorkerManager] Job ${actualJobId} failed with error:`, error);
            // Mark worker as available again
            workerState.busy = false;
            workerState.currentJobId = undefined;
            
            // Clear timeout
            clearTimeout(timeout);
            
            // Emit job failure events for JobScheduler
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`[WorkerManager] Emitting job-failed event for ${actualJobId} with error: ${errorMessage}`);
            this.emit("job-failed", actualJobId, errorMessage);
            
            reject(error);
          });
      });
    }
  }

  /**
   * Execute a batch of jobs
   */
  async executeBatchJobs(jobs: JobPayload[], jobIds?: string[]): Promise<BatchExecutionResult> {
    // Check if we're running in Bun environment
    if (typeof globalThis.Bun !== "undefined") {
      const messageId = ulid();
      const batchJobIds = jobIds || jobs.map(() => ulid());
      const jobIdSet = new Set(batchJobIds);

      return new Promise((resolve, reject) => {
        // Store pending batch
        this.pendingBatches.set(messageId, {
          resolve,
          reject,
          jobIds: jobIdSet,
          results: [],
        });

        // Set timeout
        const timeout = setTimeout(() => {
          const pending = this.pendingBatches.get(messageId);
          if (pending) {
            pending.reject(new Error("Batch execution timed out"));
            this.pendingBatches.delete(messageId);
          }
        }, this.config.batchTimeout);

        this.pendingBatches.get(messageId)!.timeout = timeout;

        // Find available worker
        const workerId = this.getAvailableWorker();
        if (workerId === undefined) {
          // Queue the jobs individually - emit events for orchestrator
          for (let i = 0; i < jobs.length; i++) {
            const jobId = (jobIds && jobIds[i]) || ulid();
            this.emit("job-queued", jobId, jobs[i]);
          }
          return;
        }

        // Send batch to worker
        const connection = this.workerConnections.get(workerId);
        if (connection) {
          const workerState = this.workerStates.get(workerId)!;
          workerState.busy = true;
          workerState.activeJobId = messageId;

          connection.ws.send({
            type: WorkerMessageType.EXECUTE_BATCH_JOBS,
            id: messageId,
            payload: jobs,
          });

          this.pendingBatches.get(messageId)!.workerId = workerId;
        }
      });
    } else {
      // In Node.js environment, execute jobs directly
      const workerId = this.getAvailableWorker();
      if (workerId === undefined) {
        throw new Error("No available workers");
      }

      const batchId = ulid();
      const jobResults: BatchJobResult[] = [];
      
      // Mark worker as busy
      const workerState = this.workerStates.get(workerId)!;
      workerState.busy = true;
      workerState.currentJobId = batchId;

      try {
        let successCount = 0;
        let failureCount = 0;

        // Execute each job in the batch
        for (let i = 0; i < jobs.length; i++) {
          // Use provided job ID or generate a new one
          const jobId = (jobIds && jobIds[i]) || ulid();
          try {
            const context: BaseJobExecutionContext = {
              jobId: jobId,
              startTime: Date.now(),
              queueTime: 0,
              timeout: jobs[i].jobTimeout || this.config.jobTimeout,
            };

            const result = await this.jobExecutor.executeJob(jobs[i], context);
            jobResults.push({
              jobId,
              success: true,
              result,
            });
            successCount++;
          } catch (error) {
            jobResults.push({
              jobId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
            failureCount++;
          }
        }

        // Mark worker as available again
        workerState.busy = false;
        workerState.currentJobId = undefined;

        const batchResult: BatchExecutionResult = {
          batchId,
          results: jobResults,
          totalJobs: jobs.length,
          successCount,
          failureCount,
        };

        // Emit batch completion events for JobScheduler
        this.emit("batch-completed", workerId, batchResult);

        return batchResult;
      } catch (error) {
        // Mark worker as available again
        workerState.busy = false;
        workerState.currentJobId = undefined;
        
        throw error;
      }
    }
  }

  /**
   * Get an available worker
   */
  private getAvailableWorker(): number | undefined {
    for (const [workerId, state] of this.workerStates) {
      if (state.ready && !state.busy) {
        return workerId;
      }
    }
    return undefined;
  }

  /**
   * Distribute a job to a specific worker
   */
  private async distributeJobToWorker(workerId: number): Promise<void> {
    const workerState = this.workerStates.get(workerId);
    const connection = this.workerConnections.get(workerId);

    if (!workerState || !connection || workerState.busy) {
      return;
    }

    // For now, we'll rely on the orchestrator to push jobs to workers
    // rather than pulling from a queue
    return;
  }

  /**
   * Distribute jobs to available workers
   */
  private async distributeJobsToWorkers(maxJobs: number): Promise<void> {
    let distributed = 0;

    for (const [workerId, state] of this.workerStates) {
      if (distributed >= maxJobs) break;
      if (state.ready && !state.busy) {
        await this.distributeJobToWorker(workerId);
        distributed++;
      }
    }
  }

  /**
   * Handle job result from worker
   */
  private handleJobResult(workerId: number, result: JobResult): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) return;

    // Mark worker as available
    workerState.busy = false;
    workerState.activeJobId = undefined;
    workerState.currentJobId = undefined;

    // Emit job completion event for orchestrator
    const jobId = workerState.currentJobId;
    if (jobId) {
      this.emit("job-result", jobId, result);
      this.emit("job-completed", jobId, result);
    }

    // Resolve pending job if exists
    const pending = this.pendingJobs.get(workerState.activeJobId || "");
    if (pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.resolve(result);
      this.pendingJobs.delete(workerState.activeJobId || "");
    }

    // Try to get another job
    this.distributeJobToWorker(workerId);
  }

  /**
   * Handle batch result from worker
   */
  private handleBatchResult(
    workerId: number,
    result: BatchExecutionResult,
  ): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) return;

    // Mark worker as available
    workerState.busy = false;
    workerState.activeJobId = undefined;

    // Resolve pending batch if exists
    const pending = this.pendingBatches.get(workerState.activeJobId || "");
    if (pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.resolve(result);
      this.pendingBatches.delete(workerState.activeJobId || "");
    }

    this.emit("batch-completed", workerId, result);

    // Try to get another job
    this.distributeJobToWorker(workerId);
  }

  /**
   * Handle job error from worker
   */
  private handleJobError(workerId: number, payload: any): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) return;

    // Mark worker as available
    workerState.busy = false;
    const jobId = workerState.currentJobId || ulid();
    workerState.activeJobId = undefined;
    workerState.currentJobId = undefined;

    // Create error result
    const error = new Error(payload.error || "Job execution failed");
    const result: JobResult = {
      results: { error: error.message },
      executionTime: 0,
      queueTime: 0,
    };

    // Emit job error event for orchestrator
    if (workerState.currentJobId) {
      this.emit("job-error", workerState.currentJobId, error);
    }

    // Resolve pending job if exists
    const pending = this.pendingJobs.get(workerState.activeJobId || "");
    if (pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
      this.pendingJobs.delete(workerState.activeJobId || "");
    }

    this.emit("job-error", jobId, error);
    this.emit("job-failed", jobId, error.message);

    // Try to get another job
    this.distributeJobToWorker(workerId);
  }

  /**
   * Check if there are available workers
   */
  hasAvailableWorkers(): boolean {
    for (const state of this.workerStates.values()) {
      if (state.ready && !state.busy) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get worker count
   */
  getWorkerCount(): number {
    return this.workerStates.size;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<any> {
    return this.queueOrchestrator.getStats();
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): any {
    const stats = {
      total: this.workerStates.size,
      ready: 0,
      available: 0,
      busy: 0,
      workers: [] as any[],
    };

    for (const [workerId, state] of this.workerStates) {
      if (state.ready && !state.busy) {
        stats.available++;
        stats.ready++;
      } else if (state.busy) {
        stats.busy++;
        stats.ready++;
      }

      stats.workers.push({
        id: workerId,
        ready: state.ready,
        busy: state.busy,
        currentJob: state.currentJobId,
      });
    }

    return stats;
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check on all workers
   */
  private performHealthCheck(): void {
    for (const [workerId, connection] of this.workerConnections) {
      connection.ws.send({
        type: WorkerMessageType.PING,
        id: ulid(),
      });
    }
  }

  /**
   * Shutdown the WorkerManager
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Cancel all pending jobs
    for (const [messageId, pending] of this.pendingJobs) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("WorkerManager is shutting down"));
    }
    this.pendingJobs.clear();

    // Cancel all pending batches
    for (const [messageId, pending] of this.pendingBatches) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("WorkerManager is shutting down"));
    }
    this.pendingBatches.clear();

    // Close all worker connections
    for (const [workerId, connection] of this.workerConnections) {
      connection.ws.send({
        type: WorkerMessageType.WORKER_ERROR,
        id: ulid(),
        payload: { message: "Shutting down" },
      });
      connection.ws.close();
    }

    // Stop WebSocket server
    await this.wsServer.stop();

    // Clear state
    this.workerStates.clear();
    this.workerConnections.clear();

    this.emit("shutdown");
  }
}
