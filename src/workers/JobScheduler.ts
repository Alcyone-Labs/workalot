import { EventEmitter } from "node:events";
import { WorkerManager } from "./WorkerManager.js";
import { WorkerManagerConfig } from "./WorkerManager.js";
import { QueueOrchestrator } from "./QueueOrchestrator.js";
import { IQueueBackend } from "../queue/index.js";
import { JobExecutor } from "../jobs/index.js";
import { JobRecoveryService } from "./JobRecoveryService.js";
import {
  JobStatus,
  JobPayload,
  JobResult,
  QueueConfig,
  BatchJobContext,
  BatchExecutionResult,
  JobSchedulingRequest,
  JobSchedulingRequest,
  BaseJobExecutionContext,
} from "../types/index.js";
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('workalot-scheduler');
const meter = metrics.getMeter('workalot-scheduler');

const queueDurationHistogram = meter.createHistogram('job_queue_duration_ms', {
  description: 'Time jobs spend in queue before processing',
  unit: 'ms',
});

const jobExecutionHistogram = meter.createHistogram('job_execution_duration_ms', {
  description: 'Time taken to execute a job',
  unit: 'ms',
});

/**
 * Events emitted by the JobScheduler
 */
export interface JobSchedulerEvents {
  "job-scheduled": (jobId: string) => void;
  "job-started": (jobId: string, workerId: number) => void;
  "job-completed": (jobId: string, result: JobResult) => void;
  "job-failed": (jobId: string, error: string) => void;
  "scheduler-idle": () => void;
  "scheduler-busy": () => void;
}

/**
 * Coordinates job scheduling between queue and workers
 */
export class JobScheduler extends EventEmitter {
  private workerManager: WorkerManager;
  private jobExecutor: JobExecutor;
  private jobRecoveryService: JobRecoveryService;
  private processingInterval?: NodeJS.Timeout;
  private isProcessing = false;
  private isShuttingDown = false;
  private batchSize: number = 100; // Larger batch size for high performance
  private useBatchProcessing: boolean = true; // Enable batch processing for better scaling
  private lastProcessingTime = 0;
  private readonly minProcessingInterval = 1; // Minimum 1ms between processing calls for higher throughput

constructor(
    private queueBackend: IQueueBackend,
    private config: QueueConfig,
    projectRoot: string = process.cwd(),
    workerManager?: WorkerManager,
  ) {
    super();

    // Set max listeners to prevent warnings during high-throughput operations
    // Allow for 2 listeners per job (completed + failed) plus some buffer
    this.setMaxListeners(10000);

    if (workerManager) {
      this.workerManager = workerManager;
    } else {
      // Create a queue orchestrator for the worker manager
      const workerManagerConfig: WorkerManagerConfig = {
        numWorkers: config.maxThreads,
        projectRoot: projectRoot,
        silent: config.silent,
      };

      // Create a queue orchestrator for the worker manager
      const queueOrchestrator = new QueueOrchestrator({
        workerQueueSize: 50,
        queueThreshold: 10,
        ackTimeout: 5000,
        enableWorkerQueues: true,
      });

      this.workerManager = new WorkerManager(queueOrchestrator, workerManagerConfig);
    }
    
    this.jobExecutor = new JobExecutor(projectRoot);

    // Initialize JobRecoveryService
    this.jobRecoveryService = new JobRecoveryService(this.queueBackend, {
      checkInterval: 60000, // Check every minute
      stalledTimeout: 300000, // 5 minutes
      enabled: config.jobRecoveryEnabled !== false, // Default to true unless explicitly disabled
      maxRecoveryAttempts: 3,
    });

    this.setupEventHandlers();
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    await this.workerManager.initialize();

    // Start job recovery service if enabled
    if (this.config.jobRecoveryEnabled !== false) {
      this.jobRecoveryService.start();
    }

    this.startProcessing();
    console.log("Job scheduler initialized");
  }

  /**
   * Schedule a new job without waiting for completion
   */
  async schedule(jobPayload: JobPayload): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error("Scheduler is shutting down");
    }

    // Get job ID from the job itself
    let jobId: string | undefined;
    try {
      jobId = await this.jobExecutor.getJobId(jobPayload);
    } catch (error) {
      throw new Error(
        `Failed to get job ID: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Add job to queue
    const finalJobId = await this.queueBackend.addJob(jobPayload, jobId);
    this.emit("job-scheduled", finalJobId);

    // Trigger immediate processing if workers are available
    if (this.workerManager.hasAvailableWorkers()) {
      setTimeout(() => this.processJobs(), 0);
    }

    return finalJobId;
  }



  /**
   * Schedule a job and wait for it to complete
   */
  async executeJobAndWait(jobPayload: JobPayload): Promise<JobResult> {
    if (this.isShuttingDown) {
      throw new Error("Scheduler is shutting down");
    }

    const jobId = await this.schedule(jobPayload);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          // FIXED: Clean up event listeners on timeout to prevent memory leaks
          this.off("job-completed", onCompleted);
          this.off("job-failed", onFailed);
          reject(new Error(`Job ${jobId} timed out`));
        },
        (jobPayload.jobTimeout || 5000) + 1000,
      ); // Add 1 second buffer

      const onCompleted = (completedJobId: string, result: JobResult) => {
        if (completedJobId === jobId) {
          clearTimeout(timeout);
          this.off("job-completed", onCompleted);
          this.off("job-failed", onFailed);
          resolve(result);
        }
      };

      const onFailed = (failedJobId: string, error: string) => {
        if (failedJobId === jobId) {
          clearTimeout(timeout);
          this.off("job-completed", onCompleted);
          this.off("job-failed", onFailed);
          reject(new Error(error));
        }
      };

      this.on("job-completed", onCompleted);
      this.on("job-failed", onFailed);
    });
  }



  /**
   * Get scheduler statistics
   */
  async getStats(): Promise<{
    queue: any;
    workers: any;
    isProcessing: boolean;
    isShuttingDown: boolean;
    batchProcessing: {
      enabled: boolean;
    };
    jobRecovery: any;
  }> {
    return {
      queue: await this.queueBackend.getStats(),
      workers: this.workerManager.getWorkerStats(),
      isProcessing: this.isProcessing,
      isShuttingDown: this.isShuttingDown,
      batchProcessing: {
        enabled: this.useBatchProcessing,
      },
      jobRecovery: this.jobRecoveryService.getStats(),
    };
  }

  /**
   * Check if scheduler is idle (no pending jobs, no processing jobs, and workers available)
   */
  async isIdle(): Promise<boolean> {
    const hasPending = await this.queueBackend.hasPendingJobs();
    const hasProcessing = await this.queueBackend.hasProcessingJobs();
    const hasAvailableWorkers = this.workerManager.hasAvailableWorkers();

    return !hasPending && !hasProcessing && hasAvailableWorkers;
  }

  /**
   * Configure batch processing settings
   */
  setBatchConfig(batchSize: number, enabled: boolean = true): void {
    this.batchSize = Math.max(1, Math.min(100, batchSize)); // Clamp between 1-100
    this.useBatchProcessing = enabled;
    console.log(`Batch processing ${enabled ? 'enabled' : 'disabled'} with batch size: ${this.batchSize}`);
  }

  /**
   * Get current batch configuration
   */
  getBatchConfig(): { batchSize: number; enabled: boolean } {
    return {
      batchSize: this.batchSize,
      enabled: this.useBatchProcessing,
    };
  }



  /**
   * Manually trigger job recovery check
   */
  async recoverStalledJobs(): Promise<number> {
    await this.jobRecoveryService.triggerCheck();
    return 0; // The actual count is logged by the recovery service
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Stop job recovery service
    this.jobRecoveryService.stop();

    // Wait a brief moment for any in-flight job status updates to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    await this.workerManager.shutdown();

    // Clean up all event listeners to prevent memory leaks
    this.removeAllListeners();

    console.log("Job scheduler shut down");
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.workerManager.on("job-completed", (jobId: string, result: JobResult) => {
      console.log(`[JobScheduler] Received job-completed event for ${jobId}`);
      this.handleJobCompleted(jobId, result);
      // Clear recovery attempts for completed jobs
      this.jobRecoveryService.clearRecoveryAttempts(jobId);
      // Immediately try to process more jobs when a worker becomes available
      setTimeout(() => {
        this.processJobs();
      }, 0);
    });
    
    this.workerManager.on("job-failed", (jobId: string, error: string) => {
      console.log(`[JobScheduler] Received job-failed event for ${jobId} with error: ${error}`);
      this.handleJobFailed(jobId, error);
      // Clear recovery attempts for failed jobs
      this.jobRecoveryService.clearRecoveryAttempts(jobId);
      // Immediately try to process more jobs when a worker becomes available
      setTimeout(() => {
        this.processJobs();
      }, 0);
    });

    // Job recovery service event handlers
    this.jobRecoveryService.on("jobs-recovered", ({ count, jobs }) => {
      console.log(`Job recovery service recovered ${count} stalled jobs`);
      // Trigger job processing after recovery
      setTimeout(() => this.processJobs(), 100);
    });

    this.jobRecoveryService.on("jobs-failed", ({ count, jobs }) => {
      console.log(`Job recovery service marked ${count} jobs as failed after max recovery attempts`);
    });

    this.jobRecoveryService.on("recovery-error", (error) => {
      console.error("Job recovery service error:", error);
    });

    this.workerManager.on("batch-completed", (workerId, result) => {
      this.handleBatchCompleted(result);
      // Immediately try to process more jobs when a worker becomes available
      setTimeout(() => this.processJobs(), 0);
    });

    this.workerManager.on("all-workers-ready", () => {
      console.log("All workers ready, starting job processing");
      // Start processing immediately when workers are ready
      setTimeout(() => this.processJobs(), 0);
    });
  }

  /**
   * Start event-driven job processing
   */
  private startProcessing(): void {
    // Keep a minimal fallback timer for edge cases, but much less frequent
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, 100); // Fallback check every 100ms for better responsiveness

    // Start immediate processing
    setTimeout(() => this.processJobs(), 0);
  }

  /**
   * Process pending jobs
   */
  private async processJobs(): Promise<void> {
    return tracer.startActiveSpan('JobScheduler.processJobs', async (span) => {
      if (this.isProcessing || this.isShuttingDown) {
        span.addEvent('Skipping processing', { isProcessing: this.isProcessing, isShuttingDown: this.isShuttingDown });
        span.end();
        return;
      }

      // Throttle processing calls to prevent event loop overload
      const now = Date.now();
      if (now - this.lastProcessingTime < this.minProcessingInterval) {
        span.addEvent('Throttled');
        span.end();
        return;
      }
      this.lastProcessingTime = now;

      this.isProcessing = true;

      try {
        if (this.useBatchProcessing) {
          await this.processBatchJobs();
        } else {
          await this.processSingleJobs();
        }

        // Check if scheduler became idle
        if (await this.isIdle()) {
          this.emit("scheduler-idle");
        } else {
          this.emit("scheduler-busy");
        }
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        console.error("Error processing jobs:", error);
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      } finally {
        this.isProcessing = false;
        span.end();
      }
    });
  }

  /**
   * Process jobs using worker-local queues for ultra-high throughput
   */
  private async processBatchJobs(): Promise<void> {
    // Get jobs to distribute to worker queues
    const maxJobsToFetch = this.workerManager.getWorkerCount() * 200; // 200 jobs per worker queue for high throughput

    if (!this.queueBackend.getNextPendingJobs) {
      // Fallback to single job processing if batch method not available
      await this.processSingleJobs();
      return;
    }

    const pendingJobs = await this.queueBackend.getNextPendingJobs(maxJobsToFetch);
    if (!pendingJobs || pendingJobs.length === 0) {
      return; // No more pending jobs
    }

    // Prepare batch context for all jobs (but don't mark as PROCESSING yet)
    const batchJobs: BatchJobContext[] = [];
    for (const job of pendingJobs) {
      const queueTime = Date.now() - job.requestedAt.getTime();
      const context: BaseJobExecutionContext = {
        jobId: job.id,
        startTime: Date.now(),
        queueTime,
        timeout: job.jobPayload.jobTimeout || 10000,
      };

      batchJobs.push({
        jobId: job.id,
        jobPayload: job.jobPayload,
        context,
      });
    }

    // Execute jobs directly on workers
    try {
      const jobPayloads = batchJobs.map(job => job.jobPayload);
      const jobIds = batchJobs.map(job => job.jobId);
      
      await this.workerManager.executeBatchJobs(jobPayloads, jobIds);

      // Jobs are already marked as PROCESSING by getNextPendingJobs
      // Just emit job-started events
      for (const job of pendingJobs) {
        this.emit("job-started", job.id, -1); // Worker ID will be determined by WorkerManager
      }
    } catch (error) {
      console.error(`Error distributing jobs to workers:`, error);
      // Jobs remain in PENDING status since we didn't successfully distribute them
      // No need to handle job failures since they were never started
    }
  }

  /**
   * Process jobs one at a time (legacy mode)
   */
  private async processSingleJobs(): Promise<void> {
    let jobsStarted = 0;
    const maxJobsPerBatch = this.workerManager.getWorkerCount() * 10; // Start more jobs per batch

    while (this.workerManager.hasAvailableWorkers() && jobsStarted < maxJobsPerBatch) {
      const nextJob = await this.queueBackend.getNextPendingJob();
      if (!nextJob) {
        break; // No more pending jobs
      }

      try {
        // Start job execution without awaiting (concurrent execution)
        this.executeJob(nextJob.id, nextJob.jobPayload).catch(error => {
          console.error(`Error executing job ${nextJob.id}:`, error);
        });

        jobsStarted++;
      } catch (error) {
        console.error(`Failed to start job ${nextJob.id}:`, error);
        // Mark job as failed if we can't even start it
        await this.handleJobFailed(
          nextJob.id,
          error instanceof Error ? error.message : String(error),
        );
        break; // Stop processing if we can't start jobs
      }
    }
  }

  /**
   * Execute a specific job
   */
  private async executeJob(
    jobId: string,
    jobPayload: JobPayload,
  ): Promise<void> {
    const startTime = Date.now();
    
    // We already have a span from processJobs, but executeJob runs "concurrently" (fire and forget)
    // so we should start a new root span or link it.
    // However, since it's called from processSingleJobs which is awaited in processJobs, 
    // it effectively runs within that scope context *until the promise is created*.
    // Better to start a new span that represents the async execution.
    
    return tracer.startActiveSpan('JobScheduler.executeJob', async (span) => {
      span.setAttribute('job.id', jobId);
      
      try {
        // Note: Job status is already updated to 'processing' by the queue backend's getNextPendingJob()
        // Each backend handles atomic job claiming differently for optimal performance

        // Use current time for queue time calculation (avoid extra DB query)
        // Ideally we would get the requestedAt from the job object, but executeJob signature only has payload
        // We'll perform an estimation if needed or update signature in future. 
        // For now, let's just trace execution.
        
        const queueTime = 0; // Simplified
        const context: BaseJobExecutionContext = {
          jobId,
          startTime: Date.now(),
          queueTime,
          timeout: jobPayload.jobTimeout || 10000,
        };

        this.emit("job-started", jobId, -1); // Worker ID will be determined by WorkerManager

        // Execute job on worker with additional error handling
        try {
          const result = await this.workerManager.executeJob(jobPayload, jobId);
          // This will be handled by the event handler
          
          span.setStatus({ code: SpanStatusCode.OK });
          const duration = Date.now() - startTime;
          jobExecutionHistogram.record(duration, { status: 'success' });
          
        } catch (workerError) {
          // Handle specific worker errors
          if (workerError instanceof Error && workerError.message === "No available workers") {
            span.addEvent('Retry: No available workers');
            // Retry after a short delay if no workers are available
            setTimeout(() => {
              this.executeJob(jobId, jobPayload).catch(retryError => {
                console.error(`Retry failed for job ${jobId}:`, retryError);
              });
            }, 100); // Retry after 100ms
            
            span.end(); // End this attempt span
            return;
          }
          throw workerError;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        jobExecutionHistogram.record(duration, { status: 'failed' });
        
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        
        await this.handleJobFailed(
          jobId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        span.end();
      }
    });
  }

  /**
   * Execute a batch of jobs
   */
  private async executeBatchJobs(batchJobs: BatchJobContext[]): Promise<void> {
    try {
      // Extract job payloads for the worker manager
      const jobPayloads = batchJobs.map(batchJob => batchJob.jobPayload);
      
      // Execute batch on worker
      const result = await this.workerManager.executeBatchJobs(jobPayloads);

      // This will be handled by the batch event handler
    } catch (error) {
      // Handle batch failure
      for (const batchJob of batchJobs) {
        await this.handleJobFailed(
          batchJob.jobId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /**
   * Handle batch completion
   */
  private async handleBatchCompleted(result: BatchExecutionResult): Promise<void> {
    // Process each job result in the batch
    for (const jobResult of result.results) {
      if (jobResult.success && jobResult.result) {
        await this.handleJobCompleted(jobResult.jobId, jobResult.result);
      } else {
        await this.handleJobFailed(jobResult.jobId, jobResult.error || "Unknown batch job error");
      }
    }
  }

  /**
   * Handle job completion
   */
  private async handleJobCompleted(
    jobId: string,
    result: JobResult,
  ): Promise<void> {
    console.log(`[JobScheduler] Handling job completion for ${jobId}`);
    try {
      // Skip database operations if shutting down
      if (!this.isShuttingDown) {
        await this.queueBackend.updateJobStatus(
          jobId,
          JobStatus.COMPLETED,
          result,
        );

        // Process any scheduling requests from the job
        if (result.schedulingRequests && result.schedulingRequests.length > 0) {
          await this.processSchedulingRequests(result.schedulingRequests);
        }
      }

      this.emit("job-completed", jobId, result);
      console.log(`[JobScheduler] Emitted job-completed event for ${jobId}`);
      
      // Check if scheduler is now idle and emit event if so
      if (await this.isIdle()) {
        this.emit("scheduler-idle");
      }
    } catch (error) {
      // Don't log errors during shutdown as they're expected
      if (!this.isShuttingDown) {
        console.error(`Failed to update completed job ${jobId}:`, error);
      }
    }
  }

  /**
   * Handle job failure
   */
  private async handleJobFailed(
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    console.log(`[JobScheduler] Handling job failure for ${jobId} with error: ${errorMessage}`);
    try {
      // Skip database operations if shutting down
      if (!this.isShuttingDown) {
        const error = new Error(errorMessage);
        await this.queueBackend.updateJobStatus(
          jobId,
          JobStatus.FAILED,
          undefined,
          error,
        );
      }
      this.emit("job-failed", jobId, errorMessage);
      console.log(`[JobScheduler] Emitted job-failed event for ${jobId}`);
      
      // Check if scheduler is now idle and emit event if so
      if (await this.isIdle()) {
        this.emit("scheduler-idle");
      }
    } catch (error) {
      // Don't log errors during shutdown as they're expected
      if (!this.isShuttingDown) {
        console.error(`Failed to update failed job ${jobId}:`, error);
      }
    }
  }

  /**
   * Process scheduling requests from completed jobs
   */
  private async processSchedulingRequests(requests: JobSchedulingRequest[]): Promise<void> {
    for (const request of requests) {
      try {
        if (request.type === 'schedule' || request.type === 'scheduleAndWait') {
          // Both types are fire-and-forget scheduling since the original job has already completed
          // The requestId could be used for tracking if needed
          await this.schedule(request.jobPayload);
        }
      } catch (error) {
        console.error(`Failed to process scheduling request ${request.requestId}:`, error);
      }
    }
  }
}
