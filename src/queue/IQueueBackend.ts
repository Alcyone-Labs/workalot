import { EventEmitter } from 'events';
import { QueueItem, JobStatus, JobPayload, JobResult, QueueConfig } from '../types/index.js';

/**
 * Queue statistics interface
 */
export interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  oldestPending?: Date;
}

/**
 * Abstract interface for queue backends
 * Allows swapping between in-memory, PostgreSQL, or other storage backends
 */
export abstract class IQueueBackend extends EventEmitter {
  protected config: Required<QueueConfig>;

  constructor(config: QueueConfig) {
    super();
    this.config = {
      maxInMemoryAge: config.maxInMemoryAge || 24 * 60 * 60 * 1000,
      maxThreads: config.maxThreads || Math.max(1, require('os').cpus().length - 2),
      persistenceFile: config.persistenceFile || 'queue-state.json',
      healthCheckInterval: config.healthCheckInterval || 5000
    };
  }

  /**
   * Initialize the queue backend
   */
  abstract initialize(): Promise<void>;

  /**
   * Add a new job to the queue
   */
  abstract addJob(jobPayload: JobPayload, customId?: string): Promise<string>;

  /**
   * Get a job by ID
   */
  abstract getJob(id: string): Promise<QueueItem | undefined>;

  /**
   * Update job status
   */
  abstract updateJobStatus(
    id: string,
    status: JobStatus,
    result?: JobResult,
    error?: Error,
    workerId?: number
  ): Promise<boolean>;

  /**
   * Get the next pending job
   */
  abstract getNextPendingJob(): Promise<QueueItem | undefined>;

  /**
   * Get all jobs with a specific status
   */
  abstract getJobsByStatus(status: JobStatus): Promise<QueueItem[]>;

  /**
   * Get queue statistics
   */
  abstract getStats(): Promise<QueueStats>;

  /**
   * Clean up old completed/failed jobs
   */
  abstract cleanup(): Promise<number>;

  /**
   * Check if queue has pending jobs
   */
  abstract hasPendingJobs(): Promise<boolean>;

  /**
   * Check if queue is empty
   */
  abstract isEmpty(): Promise<boolean>;

  /**
   * Graceful shutdown
   */
  abstract shutdown(): Promise<void>;

  /**
   * Get configuration
   */
  getConfig(): Required<QueueConfig> {
    return { ...this.config };
  }
}
