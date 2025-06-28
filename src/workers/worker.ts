import { parentPort, workerData } from "node:worker_threads";
import { JobExecutor } from "../jobs/index.js";
import { WorkerLocalQueue } from "./WorkerLocalQueue.js";
import {
  WorkerMessage,
  WorkerMessageType,
  JobPayload,
  BatchJobContext,
  BatchExecutionResult,
  BatchJobResult,
  FillQueuePayload,
  RequestJobsPayload,
  JobAckPayload,
  QueueResultPayload,
} from "../types/index.js";

/**
 * Worker thread script with worker-local queue for ultra-high throughput
 * Implements three separate processes:
 * 1. Job Listener Process - receives jobs from orchestrator
 * 2. Job Executor Process - processes jobs from local queue
 * 3. ACK Handler Process - sends results and handles acknowledgments
 */
class Worker {
  private jobExecutor: JobExecutor;
  private workerId: number;
  private isReady = false;
  private silent: boolean;
  private localQueue: WorkerLocalQueue;
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private ackInterval?: NodeJS.Timeout;

  constructor() {
    this.workerId = workerData.workerId;
    this.silent = workerData.silent || false;
    this.jobExecutor = new JobExecutor(
      workerData.projectRoot,
      workerData.defaultTimeout,
    );

    // Initialize worker-local queue
    this.localQueue = new WorkerLocalQueue({
      maxQueueSize: 50,
      lowThreshold: 10,
      ackTimeout: 5000,
      enabled: true,
    });

    // Override console methods if in silent mode
    if (this.silent) {
      this.setupSilentMode();
    }

    this.setupQueueEventHandlers();
    this.setupMessageHandling();
    this.initialize();
  }

  /**
   * Set up silent mode by overriding console methods
   */
  private setupSilentMode(): void {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.error = noop;
    console.debug = noop;
    console.trace = noop;
  }

  /**
   * Conditional logging that respects silent mode
   */
  private log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  /**
   * Set up worker-local queue event handlers
   */
  private setupQueueEventHandlers(): void {
    // Handle requests for more jobs
    this.localQueue.on("request-more-jobs", (data) => {
      this.sendMessage({
        type: WorkerMessageType.REQUEST_JOBS,
        payload: {
          workerId: this.workerId,
          requestedCount: data.maxQueueSize - data.currentQueueSize,
          currentQueueSize: data.currentQueueSize,
        } as RequestJobsPayload,
      });
    });

    // Handle job completion
    this.localQueue.on("job-completed", (data) => {
      this.sendMessage({
        type: WorkerMessageType.QUEUE_RESULT,
        payload: {
          jobId: data.jobId,
          workerId: this.workerId,
          result: data.result,
          processingTime: data.processingTime,
        } as QueueResultPayload,
      });
    });

    // Handle job failure
    this.localQueue.on("job-failed", (data) => {
      this.sendMessage({
        type: WorkerMessageType.QUEUE_RESULT,
        payload: {
          jobId: data.jobId,
          workerId: this.workerId,
          error: data.error,
          processingTime: data.processingTime,
        } as QueueResultPayload,
      });
    });
  }

  /**
   * Initialize the worker and signal readiness
   */
  private async initialize(): Promise<void> {
    try {
      // Start the job processing loops
      this.startJobProcessing();
      this.startAckProcessing();

      // Worker is ready to receive jobs
      this.isReady = true;
      this.sendMessage({
        type: WorkerMessageType.WORKER_READY,
        payload: { workerId: this.workerId },
      });

      this.log(`Worker ${this.workerId}: Initialized with worker-local queue`);
    } catch (error) {
      this.sendMessage({
        type: WorkerMessageType.WORKER_ERROR,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Set up message handling from main thread
   */
  private setupMessageHandling(): void {
    if (!parentPort) {
      throw new Error("Worker must be run in a worker thread");
    }

    parentPort.on("message", async (message: WorkerMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.sendMessage({
          type: WorkerMessageType.WORKER_ERROR,
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Handle worker termination
    parentPort.on('close', () => {
      process.exit(0);
    });
  }

  /**
   * Handle incoming messages from main thread
   */
  private async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case WorkerMessageType.PING:
        this.handlePing(message);
        break;

      case WorkerMessageType.EXECUTE_JOB:
        await this.handleExecuteJob(message);
        break;

      case WorkerMessageType.EXECUTE_BATCH_JOBS:
        await this.handleExecuteBatchJobs(message);
        break;

      case WorkerMessageType.FILL_QUEUE:
        await this.handleFillQueue(message);
        break;

      case WorkerMessageType.JOB_ACK:
        await this.handleJobAck(message);
        break;

      case WorkerMessageType.QUEUE_STATUS:
        this.handleQueueStatus(message);
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle ping message for health check
   */
  private handlePing(message: WorkerMessage): void {
    this.sendMessage({
      type: WorkerMessageType.PONG,
      id: message.id,
      payload: {
        workerId: this.workerId,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Handle job execution request
   */
  private async handleExecuteJob(message: WorkerMessage): Promise<void> {
    if (!this.isReady) {
      this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: "Worker is not ready to execute jobs",
        payload: { workerId: this.workerId },
      });
      return;
    }

    const { jobPayload, context } = message.payload;

    try {
      this.log(
        `Worker ${this.workerId}: Executing job ${context.jobId} with file ${jobPayload.jobFile}`,
      );
      const result = await this.jobExecutor.executeJob(
        jobPayload as JobPayload,
        context,
      );
      this.log(
        `Worker ${this.workerId}: Job ${context.jobId} completed successfully`,
      );

      this.sendMessage({
        type: WorkerMessageType.JOB_RESULT,
        id: message.id,
        payload: {
          workerId: this.workerId,
          result,
        },
      });
      this.log(
        `Worker ${this.workerId}: Job result sent for ${context.jobId}`,
      );
    } catch (error) {
      if (!this.silent) {
        console.error(
          `Worker ${this.workerId}: Job ${context.jobId} failed:`,
          error,
        );
      }
      this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
        payload: {
          workerId: this.workerId,
          errorDetails:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : { message: String(error) },
        },
      });
    }
  }

  /**
   * Handle batch job execution request (legacy support)
   */
  private async handleExecuteBatchJobs(message: WorkerMessage): Promise<void> {
    if (!this.isReady) {
      this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: "Worker is not ready to execute jobs",
        payload: { workerId: this.workerId },
      });
      return;
    }

    const { batchJobs } = message.payload as { batchJobs: BatchJobContext[] };
    const batchId = message.id || "unknown";
    const results: BatchJobResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    this.log(
      `Worker ${this.workerId}: Executing batch ${batchId} with ${batchJobs.length} jobs (legacy mode)`,
    );

    // Process each job in the batch sequentially
    for (const batchJob of batchJobs) {
      try {
        this.log(
          `Worker ${this.workerId}: Executing job ${batchJob.context.jobId} in batch ${batchId}`,
        );

        const result = await this.jobExecutor.executeJob(
          batchJob.jobPayload,
          batchJob.context,
        );

        results.push({
          jobId: batchJob.context.jobId,
          success: true,
          result,
        });

        successCount++;

        this.log(
          `Worker ${this.workerId}: Job ${batchJob.context.jobId} completed successfully in batch ${batchId}`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (!this.silent) {
          console.error(
            `Worker ${this.workerId}: Job ${batchJob.context.jobId} failed in batch ${batchId}:`,
            error,
          );
        }

        results.push({
          jobId: batchJob.context.jobId,
          success: false,
          error: errorMessage,
        });

        failureCount++;
      }
    }

    // Send batch result
    const batchResult: BatchExecutionResult = {
      batchId,
      results,
      totalJobs: batchJobs.length,
      successCount,
      failureCount,
    };

    this.sendMessage({
      type: WorkerMessageType.BATCH_RESULT,
      id: message.id,
      payload: {
        workerId: this.workerId,
        result: batchResult,
      },
    });

    this.log(
      `Worker ${this.workerId}: Batch ${batchId} completed - ${successCount} success, ${failureCount} failed`,
    );
  }

  /**
   * Handle fill queue message from orchestrator
   */
  private async handleFillQueue(message: WorkerMessage): Promise<void> {
    if (!this.isReady) {
      this.log(`Worker ${this.workerId}: Received fill queue request but not ready`);
      return;
    }

    const { jobs } = message.payload as FillQueuePayload;

    try {
      await this.localQueue.receiveJobs(jobs);
      this.log(`Worker ${this.workerId}: Received ${jobs.length} jobs in queue`);
    } catch (error) {
      this.log(`Worker ${this.workerId}: Error filling queue:`, error);
    }
  }

  /**
   * Handle job acknowledgment from orchestrator
   */
  private async handleJobAck(message: WorkerMessage): Promise<void> {
    const { jobId } = message.payload as JobAckPayload;

    try {
      await this.localQueue.acknowledgeCompletion(jobId);
      this.log(`Worker ${this.workerId}: Job ${jobId} acknowledged and removed`);
    } catch (error) {
      this.log(`Worker ${this.workerId}: Error acknowledging job ${jobId}:`, error);
    }
  }

  /**
   * Handle queue status request
   */
  private handleQueueStatus(message: WorkerMessage): void {
    const stats = this.localQueue.getStats();

    this.sendMessage({
      type: WorkerMessageType.QUEUE_STATUS,
      id: message.id,
      payload: {
        workerId: this.workerId,
        ...stats,
        needsMoreJobs: this.localQueue.needsMoreJobs(),
      },
    });
  }

  /**
   * Start the job executor process (continuous loop)
   */
  private startJobProcessing(): void {
    this.isProcessing = true;

    // Balanced job processing loop (every 10ms for good throughput without overwhelming the event loop)
    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing || !this.isReady) {
        return;
      }

      try {
        // Process multiple jobs per interval to maintain high throughput
        let jobsProcessed = 0;
        const maxJobsPerInterval = 50; // Process up to 50 jobs per interval for high performance

        while (jobsProcessed < maxJobsPerInterval) {
          const job = await this.localQueue.getNextJob();
          if (!job) {
            break; // No more jobs available
          }

          // Execute job independently
          this.executeJobFromQueue(job).catch(error => {
            this.log(`Worker ${this.workerId}: Error in job execution:`, error);
          });

          jobsProcessed++;
        }
      } catch (error) {
        this.log(`Worker ${this.workerId}: Error getting next job:`, error);
      }
    }, 1); // 1ms interval for maximum performance
  }

  /**
   * Start the ACK handler process (periodic result sending)
   */
  private startAckProcessing(): void {
    // Reasonable frequency ACK processing (every 50ms to batch results)
    this.ackInterval = setInterval(() => {
      const completedJobs = this.localQueue.getCompletedJobs();

      // Results are already sent via queue events, this is just for monitoring
      if (completedJobs.length > 0) {
        this.log(`Worker ${this.workerId}: ${completedJobs.length} jobs awaiting ACK`);
      }
    }, 50); // Increased to 50ms to reduce CPU overhead
  }

  /**
   * Execute a job from the local queue
   */
  private async executeJobFromQueue(job: BatchJobContext): Promise<void> {
    const startTime = Date.now();

    try {
      this.log(`Worker ${this.workerId}: Executing job ${job.jobId} from queue`);

      const result = await this.jobExecutor.executeJob(
        job.jobPayload,
        job.context,
      );

      await this.localQueue.markJobComplete(job.jobId, result);

      this.log(`Worker ${this.workerId}: Job ${job.jobId} completed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!this.silent) {
        console.error(`Worker ${this.workerId}: Job ${job.jobId} failed:`, error);
      }

      await this.localQueue.markJobFailed(job.jobId, errorMessage);
    }
  }

  /**
   * Stop job processing
   */
  public stopJobProcessing(): void {
    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    if (this.ackInterval) {
      clearInterval(this.ackInterval);
      this.ackInterval = undefined;
    }

    this.localQueue.clear();
  }

  /**
   * Send message to main thread
   */
  private sendMessage(message: WorkerMessage): void {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }
}

// Get silent mode from worker data
const isSilent = workerData?.silent || false;

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  if (!isSilent) {
    console.error('Worker: Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('Worker: Stack trace:', new Error().stack);
  }
  // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  if (!isSilent) {
    console.error('Worker: Uncaught Exception:', error);
    console.error('Worker: Stack trace:', error.stack);
  }
  // Don't exit the process, just log the error
});

// Handle process exit
process.on('exit', (code) => {
  if (!isSilent) {
    console.log(`Worker process exiting with code ${code}`);
    console.trace('Exit stack trace:');
  }
});

// Handle beforeExit
process.on('beforeExit', (code) => {
  if (!isSilent) {
    console.log(`Worker process about to exit with code ${code}`);
    console.trace('BeforeExit stack trace:');
  }
});

// Start the worker
const worker = new Worker();

// Keep the process alive
const keepAlive = setInterval(() => {
  // This interval keeps the process alive
}, 30000); // Every 30 seconds

// Handle SIGTERM
process.on('SIGTERM', () => {
  if (!isSilent) {
    console.log('Worker received SIGTERM, cleaning up...');
  }
  worker.stopJobProcessing();
  clearInterval(keepAlive);
  process.exit(0);
});

// Handle SIGINT
process.on('SIGINT', () => {
  if (!isSilent) {
    console.log('Worker received SIGINT, cleaning up...');
  }
  worker.stopJobProcessing();
  clearInterval(keepAlive);
  process.exit(0);
});
