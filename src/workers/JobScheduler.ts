import { EventEmitter } from 'events';
import { WorkerManager } from './WorkerManager.js';
import { IQueueBackend } from '../queue/index.js';
import { JobExecutor } from '../jobs/index.js';
import { JobStatus, JobPayload, JobResult, QueueConfig } from '../types/index.js';

/**
 * Events emitted by the JobScheduler
 */
export interface JobSchedulerEvents {
  'job-scheduled': (jobId: string) => void;
  'job-started': (jobId: string, workerId: number) => void;
  'job-completed': (jobId: string, result: JobResult) => void;
  'job-failed': (jobId: string, error: string) => void;
  'scheduler-idle': () => void;
  'scheduler-busy': () => void;
}

/**
 * Coordinates job scheduling between queue and workers
 */
export class JobScheduler extends EventEmitter {
  private workerManager: WorkerManager;
  private jobExecutor: JobExecutor;
  private processingInterval?: NodeJS.Timeout;
  private isProcessing = false;
  private isShuttingDown = false;

  constructor(
    private queueBackend: IQueueBackend,
    config: QueueConfig,
    projectRoot: string = process.cwd()
  ) {
    super();
    
    this.workerManager = new WorkerManager(config, projectRoot);
    this.jobExecutor = new JobExecutor(projectRoot);
    
    this.setupEventHandlers();
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    await this.workerManager.initialize();
    this.startProcessing();
    console.log('Job scheduler initialized');
  }

  /**
   * Schedule a new job
   */
  async scheduleJob(jobPayload: JobPayload): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Scheduler is shutting down');
    }

    // Get job ID from the job itself
    let jobId: string | undefined;
    try {
      jobId = await this.jobExecutor.getJobId(jobPayload);
    } catch (error) {
      throw new Error(`Failed to get job ID: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Add job to queue
    const finalJobId = await this.queueBackend.addJob(jobPayload, jobId);
    this.emit('job-scheduled', finalJobId);
    
    // Trigger immediate processing if workers are available
    if (this.workerManager.hasAvailableWorkers()) {
      setImmediate(() => this.processJobs());
    }

    return finalJobId;
  }

  /**
   * Execute a job immediately and return a promise
   */
  async executeJobNow(jobPayload: JobPayload): Promise<JobResult> {
    if (this.isShuttingDown) {
      throw new Error('Scheduler is shutting down');
    }

    const jobId = await this.scheduleJob(jobPayload);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Job ${jobId} timed out`));
      }, (jobPayload.jobTimeout || 5000) + 1000); // Add 1 second buffer

      const onCompleted = (completedJobId: string, result: JobResult) => {
        if (completedJobId === jobId) {
          clearTimeout(timeout);
          this.off('job-completed', onCompleted);
          this.off('job-failed', onFailed);
          resolve(result);
        }
      };

      const onFailed = (failedJobId: string, error: string) => {
        if (failedJobId === jobId) {
          clearTimeout(timeout);
          this.off('job-completed', onCompleted);
          this.off('job-failed', onFailed);
          reject(new Error(error));
        }
      };

      this.on('job-completed', onCompleted);
      this.on('job-failed', onFailed);
    });
  }

  /**
   * Get scheduler statistics
   */
  async getStats(): Promise<{
    queue: any;
    workers: any;
    isProcessing: boolean;
  }> {
    return {
      queue: await this.queueBackend.getStats(),
      workers: this.workerManager.getWorkerStats(),
      isProcessing: this.isProcessing
    };
  }

  /**
   * Check if scheduler is idle (no pending jobs and workers available)
   */
  async isIdle(): Promise<boolean> {
    const hasPending = await this.queueBackend.hasPendingJobs();
    const hasAvailableWorkers = this.workerManager.hasAvailableWorkers();
    return !hasPending && hasAvailableWorkers;
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    await this.workerManager.shutdown();
    console.log('Job scheduler shut down');
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.workerManager.on('job-completed', (workerId, jobId, result) => {
      this.handleJobCompleted(jobId, result);
    });

    this.workerManager.on('job-failed', (workerId, jobId, error) => {
      this.handleJobFailed(jobId, error);
    });

    this.workerManager.on('all-workers-ready', () => {
      console.log('All workers ready, starting job processing');
    });
  }

  /**
   * Start periodic job processing
   */
  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, 100); // Check every 100ms
  }

  /**
   * Process pending jobs
   */
  private async processJobs(): Promise<void> {
    if (this.isProcessing || this.isShuttingDown) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.workerManager.hasAvailableWorkers()) {
        const nextJob = await this.queueBackend.getNextPendingJob();
        if (!nextJob) {
          break; // No more pending jobs
        }

        await this.executeJob(nextJob.id, nextJob.jobPayload);
      }

      // Check if scheduler became idle
      if (await this.isIdle()) {
        this.emit('scheduler-idle');
      } else {
        this.emit('scheduler-busy');
      }
    } catch (error) {
      console.error('Error processing jobs:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute a specific job
   */
  private async executeJob(jobId: string, jobPayload: JobPayload): Promise<void> {
    try {
      // Update job status to processing
      await this.queueBackend.updateJobStatus(jobId, JobStatus.PROCESSING);

      // Get job from queue to calculate queue time
      const queueItem = await this.queueBackend.getJob(jobId);
      if (!queueItem) {
        throw new Error(`Job ${jobId} not found in queue`);
      }

      const queueTime = Date.now() - queueItem.requestedAt.getTime();
      const context = {
        jobId,
        startTime: Date.now(),
        queueTime,
        timeout: jobPayload.jobTimeout || 5000
      };

      this.emit('job-started', jobId, -1); // Worker ID will be determined by WorkerManager

      // Execute job on worker
      const result = await this.workerManager.executeJob(jobPayload, context);
      
      // This will be handled by the event handler
    } catch (error) {
      await this.handleJobFailed(jobId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle job completion
   */
  private async handleJobCompleted(jobId: string, result: JobResult): Promise<void> {
    try {
      await this.queueBackend.updateJobStatus(jobId, JobStatus.COMPLETED, result);
      this.emit('job-completed', jobId, result);
    } catch (error) {
      console.error(`Failed to update completed job ${jobId}:`, error);
    }
  }

  /**
   * Handle job failure
   */
  private async handleJobFailed(jobId: string, errorMessage: string): Promise<void> {
    try {
      const error = new Error(errorMessage);
      await this.queueBackend.updateJobStatus(jobId, JobStatus.FAILED, undefined, error);
      this.emit('job-failed', jobId, errorMessage);
    } catch (error) {
      console.error(`Failed to update failed job ${jobId}:`, error);
    }
  }
}
