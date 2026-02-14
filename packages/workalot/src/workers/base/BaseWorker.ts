import { WebSocketClient } from "../../communication/WebSocketClient.js";
import { JobExecutor } from "../../jobs/index.js";
import { WorkerLocalQueue } from "../WorkerLocalQueue.js";
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
  JobExecutionContext,
  JobResult,
} from "../../types/index.js";
import { EventEmitter } from "node:events";

export interface BaseWorkerConfig {
  workerId: number;
  wsUrl?: string;
  projectRoot?: string;
  defaultTimeout?: number;
  silent?: boolean;
  maxQueueSize?: number;
  lowThreshold?: number;
  ackTimeout?: number;
  enableLocalQueue?: boolean;
  jobExecutor?: JobExecutor;
  processingInterval?: number;
  maxJobsPerInterval?: number;
}

/**
 * Base worker class for extensible worker behavior
 * Library users can extend this class to create custom workers
 */
export abstract class BaseWorker extends EventEmitter {
  protected config: Required<BaseWorkerConfig>;
  protected wsClient: WebSocketClient;
  protected jobExecutor: JobExecutor;
  protected localQueue?: WorkerLocalQueue;
  protected isReady = false;
  protected isProcessing = false;
  protected processingInterval?: NodeJS.Timeout;
  protected stats = {
    jobsProcessed: 0,
    jobsFailed: 0,
    totalProcessingTime: 0,
    averageProcessingTime: 0,
  };

  constructor(config: BaseWorkerConfig) {
    super();

    this.config = {
      workerId: config.workerId,
      wsUrl: config.wsUrl || "ws://localhost:8080/worker",
      projectRoot: config.projectRoot || process.cwd(),
      defaultTimeout: config.defaultTimeout || 30000,
      silent: config.silent || false,
      maxQueueSize: config.maxQueueSize || 50,
      lowThreshold: config.lowThreshold || 10,
      ackTimeout: config.ackTimeout || 5000,
      enableLocalQueue: config.enableLocalQueue !== false,
      jobExecutor: config.jobExecutor || null,
      processingInterval: config.processingInterval || 10,
      maxJobsPerInterval: config.maxJobsPerInterval || 50,
    } as Required<BaseWorkerConfig>;

    // Set up silent mode
    if (this.config.silent) {
      this.setupSilentMode();
    }

    // Initialize WebSocket client
    this.wsClient = new WebSocketClient({
      url: this.config.wsUrl,
      workerId: this.config.workerId,
      enableAutoReconnect: true,
      enableHeartbeat: true,
    });

    // Initialize job executor
    this.jobExecutor =
      this.config.jobExecutor ||
      new JobExecutor(this.config.projectRoot, this.config.defaultTimeout);

    // Initialize local queue if enabled
    if (this.config.enableLocalQueue) {
      this.localQueue = new WorkerLocalQueue({
        maxQueueSize: this.config.maxQueueSize,
        lowThreshold: this.config.lowThreshold,
        ackTimeout: this.config.ackTimeout,
        enabled: true,
      });
      this.setupQueueEventHandlers();
    }

    this.setupMessageHandlers();
  }

  /**
   * Initialize and start the worker
   */
  async initialize(): Promise<void> {
    try {
      // Call lifecycle hook
      await this.onBeforeInitialize();

      // Connect to WebSocket server
      await this.wsClient.connect();
      await this.wsClient.waitForConnection();

      // Start processing if local queue is enabled
      if (this.config.enableLocalQueue) {
        this.startJobProcessing();
      }

      this.isReady = true;

      // Call lifecycle hook
      await this.onAfterInitialize();

      this.log(`Worker ${this.config.workerId}: Initialized and ready`);
      this.emit("worker-ready", this.config.workerId);
    } catch (error) {
      this.emit("initialization-error", error);
      throw error;
    }
  }

  /**
   * Shutdown the worker
   */
  async shutdown(): Promise<void> {
    // Call lifecycle hook
    await this.onBeforeShutdown();

    this.isReady = false;
    this.stopJobProcessing();

    // Clear local queue
    if (this.localQueue) {
      this.localQueue.clear();
    }

    // Disconnect from WebSocket
    await this.wsClient.disconnect();

    // Call lifecycle hook
    await this.onAfterShutdown();

    this.emit("worker-shutdown", this.config.workerId);
  }

  /**
   * Set up message handlers
   */
  protected setupMessageHandlers(): void {
    // Handle fill queue messages
    this.wsClient.on(
      `message:${WorkerMessageType.FILL_QUEUE}`,
      async (message) => {
        await this.handleFillQueue(message);
      },
    );

    // Handle direct job execution (non-queue mode)
    this.wsClient.on(
      `message:${WorkerMessageType.EXECUTE_JOB}`,
      async (message) => {
        await this.handleDirectJobExecution(message);
      },
    );

    // Handle batch job execution
    this.wsClient.on(
      `message:${WorkerMessageType.EXECUTE_BATCH_JOBS}`,
      async (message) => {
        await this.handleBatchJobExecution(message);
      },
    );

    // Handle job acknowledgment
    this.wsClient.on(
      `message:${WorkerMessageType.JOB_ACK}`,
      async (message) => {
        await this.handleJobAck(message);
      },
    );

    // Handle queue status request
    this.wsClient.on(
      `message:${WorkerMessageType.QUEUE_STATUS}`,
      async (message) => {
        await this.handleQueueStatusRequest(message);
      },
    );

    // Handle custom messages
    this.wsClient.on("message", async (message) => {
      await this.onCustomMessage(message);
    });

    // Handle connection events
    this.wsClient.on("connected", () => {
      this.onConnected();
    });

    this.wsClient.on("disconnected", () => {
      this.onDisconnected();
    });

    this.wsClient.on("error", (error) => {
      this.onConnectionError(error);
    });
  }

  /**
   * Set up queue event handlers
   */
  protected setupQueueEventHandlers(): void {
    if (!this.localQueue) return;

    // Request more jobs when queue is low
    this.localQueue.on("request-more-jobs", (data) => {
      this.requestMoreJobs(data.maxQueueSize - data.currentQueueSize);
    });

    // Handle job completion
    this.localQueue.on("job-completed", async (data) => {
      await this.reportJobCompletion(
        data.jobId,
        data.result,
        data.processingTime,
      );
    });

    // Handle job failure
    this.localQueue.on("job-failed", async (data) => {
      await this.reportJobFailure(data.jobId, data.error, data.processingTime);
    });
  }

  /**
   * Start job processing loop
   */
  protected startJobProcessing(): void {
    if (!this.config.enableLocalQueue || !this.localQueue) {
      return;
    }

    this.isProcessing = true;

    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing || !this.isReady) {
        return;
      }

      await this.processJobBatch();
    }, this.config.processingInterval);

    this.emit("processing-started");
  }

  /**
   * Process a batch of jobs
   */
  protected async processJobBatch(): Promise<void> {
    if (!this.localQueue) return;

    let jobsProcessed = 0;

    while (jobsProcessed < this.config.maxJobsPerInterval) {
      const job = await this.localQueue.getNextJob();
      if (!job) {
        break; // No more jobs available
      }

      // Call lifecycle hook for job selection
      const shouldProcess = await this.beforeJobExecution(job);
      if (!shouldProcess) {
        // Skip this job for now - it will remain in the processing queue
        // until explicitly marked as complete or failed
        continue;
      }

      // Execute job asynchronously
      this.executeJob(job).catch((error) => {
        this.log(
          `Worker ${this.config.workerId}: Error executing job ${job.jobId}:`,
          error,
        );
      });

      jobsProcessed++;
    }
  }

  /**
   * Execute a single job
   */
  protected async executeJob(job: BatchJobContext): Promise<void> {
    const startTime = Date.now();

    try {
      this.log(`Worker ${this.config.workerId}: Executing job ${job.jobId}`);

      // Call lifecycle hook for custom execution
      const result = await this.onExecuteJob(job);

      const processingTime = Date.now() - startTime;

      // Update stats
      this.stats.jobsProcessed++;
      this.stats.totalProcessingTime += processingTime;
      this.stats.averageProcessingTime =
        this.stats.totalProcessingTime / this.stats.jobsProcessed;

      // Mark job as complete
      if (this.localQueue) {
        await this.localQueue.markJobComplete(job.jobId, result);
      } else {
        await this.reportJobCompletion(job.jobId, result, processingTime);
      }

      // Call lifecycle hook
      await this.afterJobExecution(job, result, processingTime);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const processingTime = Date.now() - startTime;

      // Update stats
      this.stats.jobsFailed++;

      this.log(
        `Worker ${this.config.workerId}: Job ${job.jobId} failed:`,
        error,
      );

      // Mark job as failed
      if (this.localQueue) {
        await this.localQueue.markJobFailed(job.jobId, errorMessage);
      } else {
        await this.reportJobFailure(job.jobId, errorMessage, processingTime);
      }

      // Call lifecycle hook
      await this.onJobExecutionError(job, error as Error, processingTime);
    }
  }

  /**
   * Default job execution implementation
   */
  protected async onExecuteJob(job: BatchJobContext): Promise<any> {
    // Default implementation uses JobExecutor
    return await this.jobExecutor.executeJob(job.jobPayload, job.context);
  }

  /**
   * Stop job processing
   */
  protected stopJobProcessing(): void {
    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    this.emit("processing-stopped");
  }

  /**
   * Handle fill queue message
   */
  protected async handleFillQueue(message: WorkerMessage): Promise<void> {
    if (!this.isReady || !this.localQueue) {
      return;
    }

    const { jobs } = message.payload as FillQueuePayload;

    try {
      // Call lifecycle hook
      const filteredJobs = await this.beforeQueueFill(jobs);

      await this.localQueue.receiveJobs(filteredJobs);

      this.log(
        `Worker ${this.config.workerId}: Received ${filteredJobs.length} jobs`,
      );

      // Call lifecycle hook
      await this.afterQueueFill(filteredJobs);
    } catch (error) {
      this.log(`Worker ${this.config.workerId}: Error filling queue:`, error);
      this.emit("queue-fill-error", error);
    }
  }

  /**
   * Handle direct job execution (non-queue mode)
   */
  protected async handleDirectJobExecution(
    message: WorkerMessage,
  ): Promise<void> {
    if (!this.isReady) {
      await this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: "Worker is not ready",
        payload: { workerId: this.config.workerId },
      });
      return;
    }

    const { jobPayload, context } = message.payload;

    try {
      const result = await this.jobExecutor.executeJob(
        jobPayload as JobPayload,
        context,
      );

      await this.sendMessage({
        type: WorkerMessageType.JOB_RESULT,
        id: message.id,
        payload: {
          workerId: this.config.workerId,
          result,
        },
      });
    } catch (error) {
      await this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
        payload: {
          workerId: this.config.workerId,
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
   * Handle batch job execution
   */
  protected async handleBatchJobExecution(
    message: WorkerMessage,
  ): Promise<void> {
    if (!this.isReady) {
      await this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: "Worker is not ready",
        payload: { workerId: this.config.workerId },
      });
      return;
    }

    const { batchJobs } = message.payload as { batchJobs: BatchJobContext[] };
    const results: BatchJobResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const job of batchJobs) {
      try {
        const result = await this.jobExecutor.executeJob(
          job.jobPayload,
          job.context,
        );

        results.push({
          jobId: job.context.jobId,
          success: true,
          result,
        });

        successCount++;
      } catch (error) {
        results.push({
          jobId: job.context.jobId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        failureCount++;
      }
    }

    const batchResult: BatchExecutionResult = {
      batchId: message.id || "unknown",
      results,
      totalJobs: batchJobs.length,
      successCount,
      failureCount,
    };

    await this.sendMessage({
      type: WorkerMessageType.BATCH_RESULT,
      id: message.id,
      payload: {
        workerId: this.config.workerId,
        result: batchResult,
      },
    });
  }

  /**
   * Handle job acknowledgment
   */
  protected async handleJobAck(message: WorkerMessage): Promise<void> {
    const { jobId } = message.payload as JobAckPayload;

    if (this.localQueue) {
      await this.localQueue.acknowledgeCompletion(jobId);
    }

    // Call lifecycle hook
    this.onJobAcknowledged(jobId);

    this.log(`Worker ${this.config.workerId}: Job ${jobId} acknowledged`);
  }

  /**
   * Handle queue status request
   */
  protected async handleQueueStatusRequest(
    message: WorkerMessage,
  ): Promise<void> {
    const status = this.getQueueStatus();

    await this.sendMessage({
      type: WorkerMessageType.QUEUE_STATUS,
      id: message.id,
      payload: {
        workerId: this.config.workerId,
        ...status,
      },
    });
  }

  /**
   * Request more jobs from the orchestrator
   */
  protected async requestMoreJobs(count: number): Promise<void> {
    const currentQueueSize = this.localQueue?.getStats().pendingJobs || 0;

    await this.sendMessage({
      type: WorkerMessageType.REQUEST_JOBS,
      payload: {
        workerId: this.config.workerId,
        requestedCount: count,
        currentQueueSize,
      } as RequestJobsPayload,
    });

    this.emit("jobs-requested", { count, currentQueueSize });
  }

  /**
   * Report job completion
   */
  protected async reportJobCompletion(
    jobId: string,
    result: any,
    processingTime: number,
  ): Promise<void> {
    await this.sendMessage({
      type: WorkerMessageType.QUEUE_RESULT,
      payload: {
        jobId,
        workerId: this.config.workerId,
        result,
        processingTime,
      } as QueueResultPayload,
    });

    this.emit("job-completed", { jobId, result, processingTime });
  }

  /**
   * Report job failure
   */
  protected async reportJobFailure(
    jobId: string,
    error: string,
    processingTime: number,
  ): Promise<void> {
    await this.sendMessage({
      type: WorkerMessageType.QUEUE_RESULT,
      payload: {
        jobId,
        workerId: this.config.workerId,
        error,
        processingTime,
      } as QueueResultPayload,
    });

    this.emit("job-failed", { jobId, error, processingTime });
  }

  /**
   * Send a message via WebSocket
   */
  protected async sendMessage(message: WorkerMessage): Promise<void> {
    await this.wsClient.send(message);
  }

  /**
   * Get queue status
   */
  protected getQueueStatus(): any {
    if (this.localQueue) {
      return {
        ...this.localQueue.getStats(),
        needsMoreJobs: this.localQueue.needsMoreJobs(),
      };
    }

    return {
      pendingJobs: 0,
      processingJobs: 0,
      completedJobs: this.stats.jobsProcessed,
      failedJobs: this.stats.jobsFailed,
      totalProcessed: this.stats.jobsProcessed,
      averageProcessingTime: this.stats.averageProcessingTime,
      needsMoreJobs: false,
    };
  }

  /**
   * Set up silent mode
   */
  protected setupSilentMode(): void {
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.error = noop;
    console.debug = noop;
    console.trace = noop;
  }

  /**
   * Conditional logging
   */
  protected log(...args: any[]): void {
    if (!this.config.silent) {
      console.log(...args);
    }
  }

  /**
   * Get worker statistics
   */
  getStats(): any {
    return {
      ...this.stats,
      queueStats: this.localQueue?.getStats(),
      connectionStats: this.wsClient.getStats(),
    };
  }

  // ============================================
  // Lifecycle hooks for subclasses to override
  // ============================================

  /**
   * Called before worker initialization
   */
  protected async onBeforeInitialize(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called after worker initialization
   */
  protected async onAfterInitialize(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called before worker shutdown
   */
  protected async onBeforeShutdown(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called after worker shutdown
   */
  protected async onAfterShutdown(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when connected to the orchestrator
   */
  protected onConnected(): void {
    // Override in subclass
  }

  /**
   * Called when disconnected from the orchestrator
   */
  protected onDisconnected(): void {
    // Override in subclass
  }

  /**
   * Called on connection error
   */
  protected onConnectionError(error: Error): void {
    // Override in subclass
  }

  /**
   * Called before job execution
   * Return false to skip this job
   */
  protected async beforeJobExecution(job: BatchJobContext): Promise<boolean> {
    // Override in subclass
    return true;
  }

  /**
   * Called after job execution
   */
  protected async afterJobExecution(
    job: BatchJobContext,
    result: any,
    processingTime: number,
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when job execution fails
   */
  protected async onJobExecutionError(
    job: BatchJobContext,
    error: Error,
    processingTime: number,
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Called before filling the queue
   * Can filter or transform jobs
   */
  protected async beforeQueueFill(
    jobs: BatchJobContext[],
  ): Promise<BatchJobContext[]> {
    // Override in subclass
    return jobs;
  }

  /**
   * Called after filling the queue
   */
  protected async afterQueueFill(jobs: BatchJobContext[]): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when a job is acknowledged
   */
  protected onJobAcknowledged(jobId: string): void {
    // Override in subclass
  }

  /**
   * Called for custom message handling
   */
  protected async onCustomMessage(message: WorkerMessage): Promise<void> {
    // Override in subclass
  }
}
