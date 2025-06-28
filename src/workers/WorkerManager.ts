import { Worker } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { ulid } from "ulidx";
import {
  WorkerMessage,
  WorkerMessageType,
  WorkerState,
  JobPayload,
  JobResult,
  QueueConfig,
  BatchJobContext,
  BatchExecutionResult,
  WorkerQueueConfig,
  RequestJobsPayload,
  QueueResultPayload,
  BaseJobExecutionContext,
} from "../types/index.js";
import { JobExecutionContext } from "../jobs/index.js";
import { QueueOrchestrator } from "./QueueOrchestrator.js";

/**
 * Events emitted by the WorkerManager
 */
export interface WorkerManagerEvents {
  "worker-ready": (workerId: number) => void;
  "worker-error": (workerId: number, error: string) => void;
  "job-started": (workerId: number, jobId: string) => void;
  "job-completed": (workerId: number, jobId: string, result: JobResult) => void;
  "job-failed": (workerId: number, jobId: string, error: string) => void;
  "batch-started": (workerId: number, batchId: string, jobCount: number) => void;
  "batch-completed": (workerId: number, batchId: string, result: BatchExecutionResult) => void;
  "all-workers-ready": () => void;
}

/**
 * Manages a pool of worker threads for job execution
 */
export class WorkerManager extends EventEmitter {
  private workers = new Map<number, Worker>();
  private workerStates = new Map<number, WorkerState>();
  private workerJobCounts = new Map<number, number>();
  private pendingJobs = new Map<
    string,
    {
      resolve: (result: JobResult) => void;
      reject: (error: Error) => void;
      timeout?: NodeJS.Timeout;
    }
  >();
  private pendingBatches = new Map<
    string,
    {
      resolve: (result: BatchExecutionResult) => void;
      reject: (error: Error) => void;
      timeout?: NodeJS.Timeout;
    }
  >();

  private config: Required<QueueConfig>;
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private allWorkersReady = false;
  private queueOrchestrator: QueueOrchestrator;
  constructor(
    config: QueueConfig,
    private projectRoot: string = process.cwd(),
  ) {
    super();

    this.config = {
      maxInMemoryAge: config.maxInMemoryAge || 24 * 60 * 60 * 1000,
      maxThreads: this.calculateMaxThreads(config.maxThreads),
      persistenceFile: config.persistenceFile || "queue-state.json",
      healthCheckInterval: config.healthCheckInterval || 5000,
      backend: config.backend || 'memory',
      databaseUrl: config.databaseUrl || '',
      silent: config.silent || false,
      jobRecoveryEnabled: config.jobRecoveryEnabled !== false // Default to true
    };

    // Initialize queue orchestrator for worker-local queues
    this.queueOrchestrator = new QueueOrchestrator({
      workerQueueSize: 500, // Much larger queue for high throughput
      queueThreshold: 100,  // Higher threshold for continuous flow
      ackTimeout: 5000,
      enableWorkerQueues: true,
    });

    // Set up orchestrator event handlers
    this.setupOrchestratorEvents();
  }

  /**
   * Set up queue orchestrator event handlers
   */
  private setupOrchestratorEvents(): void {
    this.queueOrchestrator.on("distribution-needed", (data) => {
      // This will be handled by JobScheduler when it calls distributeJobsToWorkers
    });

    this.queueOrchestrator.on("jobs-distributed", (data) => {
      // Emit job-started events for each job distributed to the worker
      for (let i = 0; i < data.jobCount; i++) {
        this.emit("job-started", data.workerId, `queue-job-${Date.now()}-${i}`);

        // Update worker job count for tracking
        const currentCount = this.workerJobCounts.get(data.workerId) || 0;
        this.workerJobCounts.set(data.workerId, currentCount + 1);
      }
    });

    this.queueOrchestrator.on("job-result", (data) => {
      // Acknowledge the job completion
      this.queueOrchestrator.acknowledgeJob(
        data.workerId,
        data.jobId,
        (workerId, message) => this.sendMessageToWorker(workerId, message)
      );

      // Emit the job completion event
      if (data.success) {
        this.emit("job-completed", data.workerId, data.jobId, data.result);
      } else {
        this.emit("job-failed", data.workerId, data.jobId, data.error || "Unknown error");
      }
    });

    this.queueOrchestrator.on("worker-registered", (workerId) => {
      console.log(`Worker ${workerId} registered with orchestrator`);
    });
  }

  /**
   * Initialize all worker threads
   */
  async initialize(): Promise<void> {
    console.log(`Initializing ${this.config.maxThreads} worker threads...`);

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < this.config.maxThreads; i++) {
      workerPromises.push(this.createWorker(i));
    }

    // Wait for all workers to be ready
    await Promise.all(workerPromises);

    this.allWorkersReady = true;
    this.emit("all-workers-ready");

    // Start queue orchestrator
    this.queueOrchestrator.start();

    // Start health check
    this.startHealthCheck();

    console.log(`All ${this.config.maxThreads} workers are ready with queue orchestrator`);
  }

  /**
   * Execute a job on an available worker
   */
  async executeJob(
    jobPayload: JobPayload,
    context: BaseJobExecutionContext,
  ): Promise<JobResult> {
    if (this.isShuttingDown) {
      throw new Error("WorkerManager is shutting down");
    }

    const availableWorker = this.getAvailableWorker();
    if (!availableWorker) {
      throw new Error("No available workers");
    }

    return new Promise((resolve, reject) => {
      const messageId = ulid();
      const timeout = jobPayload.jobTimeout || 10000;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingJobs.delete(messageId);
        reject(new Error(`Job execution timed out after ${timeout}ms`));
      }, timeout);

      // Store promise resolvers
      this.pendingJobs.set(messageId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Mark worker as busy
      const workerState = this.workerStates.get(availableWorker.id)!;
      workerState.busy = true;
      workerState.currentJobId = context.jobId;
      workerState.activeMessageId = messageId; // Store the messageId

      // Emit job started event
      this.emit("job-started", availableWorker.id, context.jobId);

      // Send job to worker
      const message: WorkerMessage = {
        type: WorkerMessageType.EXECUTE_JOB,
        id: messageId,
        payload: {
          jobPayload,
          context,
        },
      };

      availableWorker.worker.postMessage(message);
    });
  }

  /**
   * Execute a batch of jobs on an available worker
   */
  async executeBatchJobs(batchJobs: BatchJobContext[]): Promise<BatchExecutionResult> {
    if (this.isShuttingDown) {
      throw new Error("WorkerManager is shutting down");
    }

    if (batchJobs.length === 0) {
      throw new Error("Batch cannot be empty");
    }

    const availableWorker = this.getAvailableWorker();
    if (!availableWorker) {
      throw new Error("No available workers");
    }

    return new Promise((resolve, reject) => {
      const batchId = ulid();
      const timeout = Math.max(...batchJobs.map(job => job.jobPayload.jobTimeout || 10000));

      // Set up timeout for the entire batch
      const timeoutHandle = setTimeout(() => {
        this.pendingJobs.delete(batchId);
        reject(new Error(`Batch execution timed out after ${timeout}ms`));
      }, timeout);

      // Store promise resolvers
      this.pendingBatches.set(batchId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Mark worker as busy
      const workerState = this.workerStates.get(availableWorker.id)!;
      workerState.busy = true;
      workerState.currentJobId = `batch-${batchId}`;
      workerState.activeMessageId = batchId;

      // Emit batch started event
      this.emit("batch-started", availableWorker.id, batchId, batchJobs.length);

      // Send batch to worker
      const message: WorkerMessage = {
        type: WorkerMessageType.EXECUTE_BATCH_JOBS,
        id: batchId,
        payload: {
          batchJobs,
        },
      };

      availableWorker.worker.postMessage(message);
    });
  }

  /**
   * Get an available worker
   */
  private getAvailableWorker(): { id: number; worker: Worker } | null {
    for (const [id, state] of this.workerStates.entries()) {
      if (state.ready && !state.busy) {
        const worker = this.workers.get(id);
        if (worker) {
          return { id, worker };
        }
      }
    }
    return null;
  }

  /**
   * Check if any workers are available (for worker-local queue system)
   */
  hasAvailableWorkers(): boolean {
    // For immediate job execution, check if we have any ready workers
    // that are not busy (for direct execution) OR any workers that can accept more jobs
    const readyWorkers = Array.from(this.workerStates.values()).filter(state => state.ready);
    if (readyWorkers.length === 0) {
      return false;
    }

    // Check for workers available for immediate execution (not busy)
    const availableForImmediate = readyWorkers.some(state => !state.busy);
    if (availableForImmediate) {
      return true;
    }

    // Check if any workers need more jobs (have space in their queues)
    const workersNeedingJobs = this.queueOrchestrator.getWorkersNeedingJobs();
    return workersNeedingJobs.length > 0;
  }

  /**
   * Get total number of workers
   */
  getWorkerCount(): number {
    return this.config.maxThreads;
  }

  /**
   * Distribute jobs to workers using the queue orchestrator
   */
  async distributeJobsToWorkers(jobs: BatchJobContext[]): Promise<void> {
    const workersNeedingJobs = this.queueOrchestrator.getWorkersNeedingJobs();

    if (workersNeedingJobs.length === 0 || jobs.length === 0) {
      return;
    }

    // Distribute jobs evenly among workers that need them
    const jobsPerWorker = Math.ceil(jobs.length / workersNeedingJobs.length);
    let jobIndex = 0;

    for (const workerId of workersNeedingJobs) {
      if (jobIndex >= jobs.length) {
        break;
      }

      const workerJobs = jobs.slice(jobIndex, jobIndex + jobsPerWorker);
      if (workerJobs.length > 0) {
        await this.queueOrchestrator.distributeJobsToWorker(
          workerId,
          workerJobs,
          (workerId, message) => this.sendMessageToWorker(workerId, message)
        );
        jobIndex += workerJobs.length;
      }
    }
  }

  /**
   * Send message to a specific worker
   */
  private sendMessageToWorker(workerId: number, message: WorkerMessage): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.postMessage(message);
    } else {
      console.warn(`Attempted to send message to unknown worker ${workerId}`);
    }
  }

  /**
   * Get queue orchestrator statistics
   */
  getQueueStats() {
    return this.queueOrchestrator.getStats();
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): {
    total: number;
    ready: number;
    busy: number;
    available: number;
    distribution: number[];
    totalJobsProcessed: number;
  } {
    let ready = 0;
    let busy = 0;
    const distribution: number[] = [];
    let totalJobsProcessed = 0;

    for (const [workerId, state] of this.workerStates.entries()) {
      if (state.ready) {
        ready++;
        if (state.busy) {
          busy++;
        }
      }

      const jobCount = this.workerJobCounts.get(workerId) || 0;
      distribution.push(jobCount);
      totalJobsProcessed += jobCount;
    }

    return {
      total: this.workers.size,
      ready,
      busy,
      available: ready - busy,
      distribution,
      totalJobsProcessed,
    };
  }

  /**
   * Shutdown all workers
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop queue orchestrator
    this.queueOrchestrator.stop();

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Clear all pending job timeouts
    for (const pending of this.pendingJobs.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("WorkerManager is shutting down"));
    }
    this.pendingJobs.clear();

    // Terminate all workers
    const terminationPromises: Promise<number>[] = [];
    for (const [workerId, worker] of this.workers.entries()) {
      // Unregister worker from orchestrator
      this.queueOrchestrator.unregisterWorker(workerId);
      terminationPromises.push(worker.terminate());
    }

    await Promise.all(terminationPromises);
    this.workers.clear();
    this.workerStates.clear();
    this.workerJobCounts.clear();
    this.pendingBatches.clear();

    console.log("All workers terminated and orchestrator stopped");
  }

  /**
   * Create a single worker thread
   */
  private async createWorker(workerId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Determine the correct worker path based on whether we're running from src or dist
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);

      // Check if we're running from dist (compiled) or src (development)
      const isCompiledVersion = __dirname.includes("/dist/");
      const workerPath = isCompiledVersion
        ? join(__dirname, "worker.js") // Already in dist
        : join(__dirname, "../../dist/src/workers/worker.js"); // Running from src, point to dist

      const worker = new Worker(workerPath, {
        workerData: {
          workerId,
          projectRoot: this.projectRoot,
          defaultTimeout: 5000,
          silent: this.config.silent,
        },
      });

      // Initialize worker state
      this.workerStates.set(workerId, {
        id: workerId,
        busy: false,
        ready: false,
      });

      // Initialize job count
      this.workerJobCounts.set(workerId, 0);

      // Handle worker errors
      worker.on("error", (error) => {
        console.error(`Worker ${workerId} error:`, error);
        this.emit("worker-error", workerId, error.message);
        reject(error);
      });

      // Handle worker exit
      worker.on("exit", (code) => {
        if (code !== 0) {
          console.error(`Worker ${workerId} exited with code ${code}`);
        }

        const workerState = this.workerStates.get(workerId);
        if (workerState?.activeMessageId) {
          const pending = this.pendingJobs.get(workerState.activeMessageId);
          if (pending) {
            if (pending.timeout) {
              clearTimeout(pending.timeout);
            }
            pending.reject(
              new Error(
                `Worker ${workerId} exited unexpectedly while processing job.`,
              ),
            );
            this.pendingJobs.delete(workerState.activeMessageId);
            this.emit(
              "job-failed",
              workerId,
              workerState.currentJobId || "unknown",
              "Worker exited unexpectedly",
            );
          }
        }

        // Unregister worker from orchestrator
        this.queueOrchestrator.unregisterWorker(workerId);

        this.workerStates.delete(workerId);
        this.workers.delete(workerId);
        this.workerJobCounts.delete(workerId);

        // Respawn worker if not shutting down
        if (!this.isShuttingDown) {
          console.log(`Respawning worker ${workerId}...`);
          setTimeout(() => {
            this.createWorker(workerId).catch((error) => {
              console.error(`Failed to respawn worker ${workerId}:`, error);
            });
          }, 1000); // Wait 1 second before respawning
        }
      });

      // Wait for worker ready signal
      const readyTimeout = setTimeout(() => {
        reject(
          new Error(`Worker ${workerId} failed to initialize within timeout`),
        );
      }, 10000);

      const onReady = () => {
        clearTimeout(readyTimeout);
        resolve();
      };

      // Listen for ready signal
      worker.once("message", (message: WorkerMessage) => {
        if (message.type === WorkerMessageType.WORKER_READY) {
          const state = this.workerStates.get(workerId)!;
          state.ready = true;
          this.workers.set(workerId, worker);

          // Register worker with queue orchestrator
          this.queueOrchestrator.registerWorker(workerId);

          // NOW set up the general message handler after worker is fully initialized
          worker.on("message", (message: WorkerMessage) => {
            this.handleWorkerMessage(workerId, message);
          });

          this.emit("worker-ready", workerId);
          onReady();
        } else {
          reject(
            new Error(
              `Unexpected message from worker ${workerId}: ${message.type}`,
            ),
          );
        }
      });
    });
  }

  /**
   * Handle messages from worker threads
   */
  private handleWorkerMessage(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) {
      console.error(`Received message from unknown worker ${workerId}`);
      return;
    }

    switch (message.type) {
      case WorkerMessageType.WORKER_READY:
        // This should only happen during initialization, but handle it gracefully
        if (!workerState.ready) {
          workerState.ready = true;
          this.emit("worker-ready", workerId);
        }
        break;

      case WorkerMessageType.PONG:
        workerState.lastPing = new Date();
        break;

      case WorkerMessageType.JOB_RESULT:
        this.handleJobResult(workerId, message);
        break;

      case WorkerMessageType.BATCH_RESULT:
        this.handleBatchResult(workerId, message);
        break;

      case WorkerMessageType.JOB_ERROR:
        this.handleJobError(workerId, message);
        break;

      case WorkerMessageType.WORKER_ERROR:
        console.error(`Worker ${workerId} error:`, message.error);
        this.emit("worker-error", workerId, message.error || "Unknown error");
        break;

      case WorkerMessageType.REQUEST_JOBS:
        this.handleJobRequest(workerId, message);
        break;

      case WorkerMessageType.QUEUE_RESULT:
        this.handleQueueResult(workerId, message);
        break;

      case WorkerMessageType.QUEUE_STATUS:
        this.handleQueueStatus(workerId, message);
        break;

      default:
        console.warn(
          `Unknown message type from worker ${workerId}:`,
          message.type,
        );
    }
  }

  /**
   * Handle successful job result from worker
   */
  private handleJobResult(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) {
      console.error(`Received job result from unknown worker ${workerId}`);
      return;
    }

    // Mark worker as available
    const jobId = workerState.currentJobId || "unknown";
    workerState.busy = false;
    workerState.currentJobId = undefined;
    workerState.activeMessageId = undefined;

    if (message.id) {
      const pending = this.pendingJobs.get(message.id);
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.resolve(message.payload.result);
        this.pendingJobs.delete(message.id);

        // Increment job count for this worker
        const currentCount = this.workerJobCounts.get(workerId) || 0;
        this.workerJobCounts.set(workerId, currentCount + 1);

        this.emit("job-completed", workerId, jobId, message.payload.result);
      } else {
        // This can happen when a job times out but then actually completes
        // We should still emit the completion event to ensure proper job tracking
        console.warn(`No pending job found for message ID ${message.id}, but job ${jobId} completed successfully (likely after timeout)`);

        // Still increment job count for tracking
        const currentCount = this.workerJobCounts.get(workerId) || 0;
        this.workerJobCounts.set(workerId, currentCount + 1);

        this.emit("job-completed", workerId, jobId, message.payload.result);
      }
    } else {
      console.warn(`Job result message missing ID from worker ${workerId}`);
    }
  }

  /**
   * Handle batch result from worker
   */
  private handleBatchResult(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) {
      console.error(`Received batch result from unknown worker ${workerId}`);
      return;
    }

    // Mark worker as available
    const batchId = workerState.currentJobId || "unknown";
    workerState.busy = false;
    workerState.currentJobId = undefined;
    workerState.activeMessageId = undefined;

    if (message.id) {
      const pending = this.pendingBatches.get(message.id);
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }

        const batchResult = message.payload.result as BatchExecutionResult;

        // Update job counts for this worker
        const currentCount = this.workerJobCounts.get(workerId) || 0;
        this.workerJobCounts.set(workerId, currentCount + batchResult.totalJobs);

        pending.resolve(batchResult);
        this.pendingBatches.delete(message.id);

        this.emit("batch-completed", workerId, batchId, batchResult);
      } else {
        console.warn(`No pending batch found for message ID ${message.id}, but batch ${batchId} completed (likely after timeout)`);

        // Still update job counts for tracking
        const batchResult = message.payload.result as BatchExecutionResult;
        const currentCount = this.workerJobCounts.get(workerId) || 0;
        this.workerJobCounts.set(workerId, currentCount + batchResult.totalJobs);

        this.emit("batch-completed", workerId, batchId, batchResult);
      }
    } else {
      console.warn(`Batch result message missing ID from worker ${workerId}`);
    }
  }

  /**
   * Handle job error from worker
   */
  private handleJobError(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId)!;
    workerState.busy = false;
    const jobId = workerState.currentJobId || "unknown";
    workerState.currentJobId = undefined;
    workerState.activeMessageId = undefined;

    if (message.id) {
      const pending = this.pendingJobs.get(message.id);
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.reject(new Error(message.error || "Job execution failed"));
        this.pendingJobs.delete(message.id);

        this.emit(
          "job-failed",
          workerId,
          jobId,
          message.error || "Unknown error",
        );
      } else {
        // This can happen when a job times out but then actually fails
        // We should still emit the failure event to ensure proper job tracking
        console.warn(`No pending job found for error message ID ${message.id}, but job ${jobId} failed (likely after timeout)`);
        this.emit(
          "job-failed",
          workerId,
          jobId,
          message.error || "Unknown error",
        );
      }
    }
  }

  /**
   * Start periodic health check of workers
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check by pinging all workers
   */
  private performHealthCheck(): void {
    for (const [workerId, worker] of this.workers.entries()) {
      const message: WorkerMessage = {
        type: WorkerMessageType.PING,
        id: ulid(),
      };
      worker.postMessage(message);
    }
  }

  /**
   * Handle job request from worker
   */
  private handleJobRequest(workerId: number, message: WorkerMessage): void {
    const payload = message.payload as RequestJobsPayload;
    this.queueOrchestrator.handleJobRequest(workerId, payload);
  }

  /**
   * Handle queue result from worker
   */
  private handleQueueResult(workerId: number, message: WorkerMessage): void {
    const payload = message.payload as QueueResultPayload;
    this.queueOrchestrator.handleJobResult(workerId, payload);
  }

  /**
   * Handle queue status from worker
   */
  private handleQueueStatus(workerId: number, message: WorkerMessage): void {
    // Update orchestrator with worker status if needed
    // This is mainly for monitoring purposes
  }

  /**
   * Calculate maximum number of threads based on configuration
   */
  private calculateMaxThreads(maxThreads?: number): number {
    const cpuCount = cpus().length;

    if (maxThreads === undefined) {
      return Math.max(1, cpuCount - 2);
    }

    if (maxThreads < 0) {
      return Math.max(1, cpuCount + maxThreads);
    }

    return Math.max(1, maxThreads);
  }
}
