import { EventEmitter } from "node:events";
import { JobExecutionContext, JobResult, BatchJobContext } from "../types/index.js";

export interface QueueConfig {
  maxQueueSize: number;
  lowThreshold: number;
  ackTimeout: number;
  enabled: boolean;
}

export interface QueueStats {
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  totalProcessed: number;
  queueUtilization: number;
}

export interface JobWithResult {
  jobContext: BatchJobContext;
  result?: JobResult;
  error?: string;
  completedAt?: number;
}

/**
 * Worker-local job queue with ACK protocol for ultra-high throughput processing
 * Implements video game frame buffering pattern for job distribution
 */
export class WorkerLocalQueue extends EventEmitter {
  private pendingJobs: BatchJobContext[] = [];
  private processingJobs = new Map<string, JobWithResult>();
  private completedJobs = new Map<string, JobWithResult>();
  private totalProcessed = 0;
  private config: QueueConfig;

  constructor(config: Partial<QueueConfig> = {}) {
    super();
    this.config = {
      maxQueueSize: config.maxQueueSize || 500, // Much larger queue for high throughput
      lowThreshold: config.lowThreshold || 100, // Higher threshold for continuous flow
      ackTimeout: config.ackTimeout || 5000,
      enabled: config.enabled !== false,
    };
  }

  /**
   * Orchestrator fills queue asynchronously
   */
  async receiveJobs(jobs: BatchJobContext[]): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("Worker queue is disabled");
    }

    const availableSpace = this.config.maxQueueSize - this.pendingJobs.length;
    const jobsToAdd = jobs.slice(0, availableSpace);

    this.pendingJobs.push(...jobsToAdd);

    this.emit("jobs-received", {
      received: jobsToAdd.length,
      rejected: jobs.length - jobsToAdd.length,
      queueSize: this.pendingJobs.length,
    });

    return Promise.resolve();
  }

  /**
   * Worker processes jobs independently
   */
  async getNextJob(): Promise<BatchJobContext | null> {
    if (!this.config.enabled || this.pendingJobs.length === 0) {
      return null;
    }

    const job = this.pendingJobs.shift();
    if (!job) {
      return null;
    }

    // Move to processing
    this.processingJobs.set(job.jobId, {
      jobContext: job,
    });

    // Check if we need more jobs
    if (this.pendingJobs.length <= this.config.lowThreshold) {
      this.emit("request-more-jobs", {
        currentQueueSize: this.pendingJobs.length,
        threshold: this.config.lowThreshold,
        maxQueueSize: this.config.maxQueueSize,
      });
    }

    return job;
  }

  /**
   * Mark job as completed with result
   */
  async markJobComplete(jobId: string, result: JobResult): Promise<void> {
    const processingJob = this.processingJobs.get(jobId);
    if (!processingJob) {
      throw new Error(`Job ${jobId} not found in processing queue`);
    }

    // Move from processing to completed
    processingJob.result = result;
    processingJob.completedAt = Date.now();
    
    this.completedJobs.set(jobId, processingJob);
    this.processingJobs.delete(jobId);

    this.emit("job-completed", {
      jobId,
      result,
      processingTime: processingJob.completedAt - processingJob.jobContext.context.startTime,
    });

    return Promise.resolve();
  }

  /**
   * Mark job as failed with error
   */
  async markJobFailed(jobId: string, error: string): Promise<void> {
    const processingJob = this.processingJobs.get(jobId);
    if (!processingJob) {
      throw new Error(`Job ${jobId} not found in processing queue`);
    }

    // Move from processing to completed with error
    processingJob.error = error;
    processingJob.completedAt = Date.now();
    
    this.completedJobs.set(jobId, processingJob);
    this.processingJobs.delete(jobId);

    this.emit("job-failed", {
      jobId,
      error,
      processingTime: processingJob.completedAt - processingJob.jobContext.context.startTime,
    });

    return Promise.resolve();
  }

  /**
   * ACK protocol for safe job removal
   */
  async acknowledgeCompletion(jobId: string): Promise<void> {
    const completedJob = this.completedJobs.get(jobId);
    if (!completedJob) {
      throw new Error(`Job ${jobId} not found in completed queue`);
    }

    // Safe to remove from local storage
    this.completedJobs.delete(jobId);
    this.totalProcessed++;

    this.emit("job-acknowledged", {
      jobId,
      totalProcessed: this.totalProcessed,
    });

    return Promise.resolve();
  }

  /**
   * Get all completed jobs ready for result sending
   */
  getCompletedJobs(): JobWithResult[] {
    return Array.from(this.completedJobs.values());
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const totalCapacity = this.config.maxQueueSize;
    const currentUsage = this.pendingJobs.length + this.processingJobs.size;
    
    return {
      pendingJobs: this.pendingJobs.length,
      processingJobs: this.processingJobs.size,
      completedJobs: this.completedJobs.size,
      totalProcessed: this.totalProcessed,
      queueUtilization: totalCapacity > 0 ? (currentUsage / totalCapacity) * 100 : 0,
    };
  }

  /**
   * Check if queue needs more jobs
   */
  needsMoreJobs(): boolean {
    return this.pendingJobs.length <= this.config.lowThreshold;
  }

  /**
   * Get available space in queue
   */
  getAvailableSpace(): number {
    return Math.max(0, this.config.maxQueueSize - this.pendingJobs.length);
  }

  /**
   * Clear all queues (for shutdown)
   */
  clear(): void {
    this.pendingJobs = [];
    this.processingJobs.clear();
    this.completedJobs.clear();
  }

  /**
   * Update queue configuration
   */
  updateConfig(newConfig: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit("config-updated", this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): QueueConfig {
    return { ...this.config };
  }
}
