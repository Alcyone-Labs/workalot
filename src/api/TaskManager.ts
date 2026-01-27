import { EventEmitter } from 'node:events';
import { IQueueBackend } from '../queue/IQueueBackend.js';
import { QueueFactory } from '../queue/QueueFactory.js';
import { JobScheduler } from '../workers/index.js';
import {
  JobPayload,
  JobResult,
  QueueConfig,
  WhenFreeCallback,
  JobStatus
} from '../types/index.js';

/**
 * Events emitted by the TaskManager
 */
export interface TaskManagerEvents {
  'ready': () => void;
  'job-scheduled': (jobId: string) => void;
  'job-completed': (jobId: string, result: JobResult) => void;
  'job-failed': (jobId: string, error: string) => void;
  'queue-empty': () => void;
  'queue-not-empty': () => void;
  'all-workers-busy': () => void;
  'workers-available': () => void;
}

/**
 * Main TaskManager class - the primary interface for the job queue system
 */
export class TaskManager extends EventEmitter {
  private queueManager: IQueueBackend;
  private jobScheduler: JobScheduler;
  private whenFreeCallbacks: Set<WhenFreeCallback> = new Set();
  private isInitialized = false;
  private isShuttingDown = false;

  constructor(config: QueueConfig = {}, projectRoot: string = process.cwd()) {
    super();

    // Use the queue factory to create the appropriate backend
    this.queueManager = QueueFactory.createAutoQueue(config);
    this.jobScheduler = new JobScheduler(this.queueManager, config, projectRoot);

    this.setupEventHandlers();
  }

  /**
   * Initialize the task manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.queueManager.initialize();
      await this.jobScheduler.initialize();
      
      this.isInitialized = true;
      this.emit('ready');
      
      console.log('TaskManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize TaskManager:', error);
      throw error;
    }
  }

  /**
   * Schedule a job and wait for it to complete
   * This is the main API method as described in the documentation
   */
  async scheduleAndWait(jobPayload: JobPayload): Promise<JobResult> {
    this.ensureInitialized();

    if (this.isShuttingDown) {
      throw new Error('TaskManager is shutting down');
    }

    try {
      const result = await this.jobScheduler.executeJobAndWait(jobPayload);
      return result;
    } catch (error) {
      throw new Error(`Job execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }



  /**
   * Register a callback to be called when the queue becomes free (no pending jobs)
   * This is the second main API method as described in the documentation
   */
  whenFree(callback: WhenFreeCallback): void {
    this.ensureInitialized();

    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }

    this.whenFreeCallbacks.add(callback);

    // If queue is already free, call the callback immediately
    this.checkAndCallWhenFreeCallbacks();
  }

  /**
   * Remove a whenFree callback
   */
  removeWhenFreeCallback(callback: WhenFreeCallback): boolean {
    return this.whenFreeCallbacks.delete(callback);
  }

  /**
   * Get the current status of the task manager
   */
  async getStatus(): Promise<{
    isInitialized: boolean;
    isShuttingDown: boolean;
    queue: any;
    workers: any;
    scheduler: any;
  }> {
    const stats = this.isInitialized ? await this.jobScheduler.getStats() : null;
    
    return {
      isInitialized: this.isInitialized,
      isShuttingDown: this.isShuttingDown,
      queue: stats?.queue || null,
      workers: stats?.workers || null,
      scheduler: stats ? { isProcessing: stats.isProcessing } : null
    };
  }

  /**
   * Check if the task manager is currently idle (no pending jobs and workers available)
   */
  async isIdle(): Promise<boolean> {
    if (!this.isInitialized) {
      return false;
    }

    return await this.jobScheduler.isIdle();
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<any> {
    this.ensureInitialized();
    return await this.queueManager.getStats();
  }

  /**
   * Get worker statistics
   */
  async getWorkerStats(): Promise<any> {
    this.ensureInitialized();
    const stats = await this.jobScheduler.getStats();
    return stats.workers;
  }

  /**
   * Wait for the task manager to become idle (no pending jobs and workers available)
   * @param timeoutMs - Optional timeout in milliseconds (default: no timeout)
   * @returns Promise that resolves when idle or rejects on timeout
   */
  async whenIdle(timeoutMs?: number): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;

      // Set up timeout if specified
      if (timeoutMs && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timeout waiting for idle state after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      // Check if already idle
      this.isIdle().then(idle => {
        if (idle) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve();
          return;
        }

        // Set up callback to be called when idle
        const callback = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve();
        };

        this.whenFree(callback);
      }).catch(error => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Get jobs by their status
   * @param status - The job status to filter by
   * @returns Promise that resolves to an array of jobs with the specified status
   */
  async getJobsByStatus(status: string): Promise<any[]> {
    this.ensureInitialized();

    // Convert string status to JobStatus enum
    let jobStatus: JobStatus;
    switch (status.toLowerCase()) {
      case 'pending':
        jobStatus = JobStatus.PENDING;
        break;
      case 'processing':
        jobStatus = JobStatus.PROCESSING;
        break;
      case 'completed':
        jobStatus = JobStatus.COMPLETED;
        break;
      case 'failed':
        jobStatus = JobStatus.FAILED;
        break;
      case 'cancelled':
        jobStatus = JobStatus.CANCELLED;
        break;
      default:
        throw new Error(`Invalid job status: ${status}. Valid statuses are: pending, processing, completed, failed, cancelled`);
    }

    return await this.queueManager.getJobsByStatus(jobStatus);
  }

  /**
   * Schedule a job without waiting for completion (fire and forget)
   */
  async schedule(jobPayload: JobPayload): Promise<string> {
    this.ensureInitialized();

    if (this.isShuttingDown) {
      throw new Error('TaskManager is shutting down');
    }

    return await this.jobScheduler.schedule(jobPayload);
  }



  /**
   * Graceful shutdown of the task manager
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      // Clear all whenFree callbacks
      this.whenFreeCallbacks.clear();

      // Shutdown components
      await this.jobScheduler.shutdown();
      await this.queueManager.shutdown();

      console.log('TaskManager shut down successfully');
    } catch (error) {
      console.error('Error during TaskManager shutdown:', error);
      throw error;
    }
  }

  /**
   * Set up event handlers for internal components
   */
  private setupEventHandlers(): void {
    // Queue events
    this.queueManager.on('queue-empty', () => {
      this.emit('queue-empty');
      this.checkAndCallWhenFreeCallbacks();
    });

    this.queueManager.on('queue-not-empty', () => {
      this.emit('queue-not-empty');
    });

    // Job scheduler events
    this.jobScheduler.on('job-scheduled', (jobId: string) => {
      this.emit('job-scheduled', jobId);
    });

    this.jobScheduler.on('job-completed', (jobId: string, result: JobResult) => {
      this.emit('job-completed', jobId, result);
      this.checkAndCallWhenFreeCallbacks();
    });

    this.jobScheduler.on('job-failed', (jobId: string, error: string) => {
      this.emit('job-failed', jobId, error);
      this.checkAndCallWhenFreeCallbacks();
    });

    this.jobScheduler.on('scheduler-idle', () => {
      this.checkAndCallWhenFreeCallbacks();
    });

    this.jobScheduler.on('scheduler-busy', () => {
      // Could emit workers-busy event if needed
    });
  }

  /**
   * Check if queue is free and call whenFree callbacks
   */
  private async checkAndCallWhenFreeCallbacks(): Promise<void> {
    if (this.whenFreeCallbacks.size === 0 || !this.isInitialized) {
      return;
    }

    try {
      const isIdle = await this.isIdle();
      if (isIdle) {
        // Call all callbacks and then clear them
        const callbacks = Array.from(this.whenFreeCallbacks);
        this.whenFreeCallbacks.clear();

        for (const callback of callbacks) {
          try {
            callback();
          } catch (error) {
            console.error('Error in whenFree callback:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error checking idle state:', error);
    }
  }

  /**
   * Ensure the task manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('TaskManager must be initialized before use. Call initialize() first.');
    }
  }
}
