import { writeFile, readFile, access, constants } from 'fs/promises';
import { ulid } from 'ulidx';
import {
  QueueItem,
  JobStatus,
  JobPayload,
  JobResult,
  QueueConfig
} from '../types/index.js';
import { IQueueBackend, QueueStats } from './IQueueBackend.js';

/**
 * Events emitted by the QueueManager
 */
export interface QueueManagerEvents {
  'item-added': (item: QueueItem) => void;
  'item-updated': (item: QueueItem) => void;
  'item-completed': (item: QueueItem) => void;
  'item-failed': (item: QueueItem) => void;
  'queue-empty': () => void;
  'queue-not-empty': () => void;
}

/**
 * In-memory queue manager with JSON persistence
 */
export class QueueManager extends IQueueBackend {
  private queue = new Map<string, QueueItem>();
  private cleanupInterval?: NodeJS.Timeout;
  private persistenceTimeout?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(config: QueueConfig = {}) {
    super(config);
    this.setupCleanupInterval();
    this.setupGracefulShutdown();
  }

  /**
   * Initialize the queue backend
   */
  async initialize(): Promise<void> {
    await this.loadFromFile();
  }

  /**
   * Adds a new job to the queue
   */
  async addJob(jobPayload: JobPayload, customId?: string): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down, cannot add new jobs');
    }

    const id = customId || ulid();
    const now = new Date();

    // Check for duplicate ID
    if (this.queue.has(id)) {
      throw new Error(`Job with ID ${id} already exists in queue`);
    }

    const queueItem: QueueItem = {
      id,
      jobPayload,
      status: JobStatus.PENDING,
      lastUpdated: now,
      requestedAt: now
    };

    this.queue.set(id, queueItem);
    this.emit('item-added', queueItem);

    // Check if queue was empty before
    if (this.queue.size === 1) {
      this.emit('queue-not-empty');
    }

    // Schedule persistence
    this.schedulePersistence();

    return id;
  }

  /**
   * Gets a job by ID
   */
  async getJob(id: string): Promise<QueueItem | undefined> {
    return this.queue.get(id);
  }

  /**
   * Updates job status
   */
  async updateJobStatus(
    id: string,
    status: JobStatus,
    result?: JobResult,
    error?: Error,
    workerId?: number
  ): Promise<boolean> {
    const item = this.queue.get(id);
    if (!item) {
      return false;
    }

    const now = new Date();
    item.status = status;
    item.lastUpdated = now;

    if (workerId !== undefined) {
      item.workerId = workerId;
    }

    switch (status) {
      case JobStatus.PROCESSING:
        item.startedAt = now;
        break;
      case JobStatus.COMPLETED:
        item.completedAt = now;
        item.result = result;
        this.emit('item-completed', item);
        break;
      case JobStatus.FAILED:
        item.completedAt = now;
        item.error = error;
        this.emit('item-failed', item);
        break;
    }

    this.emit('item-updated', item);
    this.schedulePersistence();

    return true;
  }

  /**
   * Gets the next pending job
   */
  async getNextPendingJob(): Promise<QueueItem | undefined> {
    for (const item of this.queue.values()) {
      if (item.status === JobStatus.PENDING) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * Gets all jobs with a specific status
   */
  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    return Array.from(this.queue.values()).filter(item => item.status === status);
  }

  /**
   * Gets queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const stats = {
      total: this.queue.size,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      oldestPending: undefined as Date | undefined
    };

    let oldestPendingTime: number | undefined;

    for (const item of this.queue.values()) {
      switch (item.status) {
        case JobStatus.PENDING:
          stats.pending++;
          if (!oldestPendingTime || item.requestedAt.getTime() < oldestPendingTime) {
            oldestPendingTime = item.requestedAt.getTime();
            stats.oldestPending = item.requestedAt;
          }
          break;
        case JobStatus.PROCESSING:
          stats.processing++;
          break;
        case JobStatus.COMPLETED:
          stats.completed++;
          break;
        case JobStatus.FAILED:
          stats.failed++;
          break;
      }
    }

    return stats;
  }

  /**
   * Removes completed/failed jobs older than maxInMemoryAge
   */
  async cleanup(): Promise<number> {
    const cutoffTime = Date.now() - this.config.maxInMemoryAge;
    let removedCount = 0;

    for (const [id, item] of this.queue.entries()) {
      if (
        (item.status === JobStatus.COMPLETED || item.status === JobStatus.FAILED) &&
        item.lastUpdated.getTime() < cutoffTime
      ) {
        this.queue.delete(id);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.schedulePersistence();
      
      // Check if queue became empty
      if (this.queue.size === 0) {
        this.emit('queue-empty');
      }
    }

    return removedCount;
  }

  /**
   * Checks if queue has any pending jobs
   */
  async hasPendingJobs(): Promise<boolean> {
    const pendingJobs = await this.getJobsByStatus(JobStatus.PENDING);
    return pendingJobs.length > 0;
  }

  /**
   * Checks if queue is empty
   */
  async isEmpty(): Promise<boolean> {
    return this.queue.size === 0;
  }

  /**
   * Loads queue state from persistence file
   */
  async loadFromFile(): Promise<number> {
    try {
      await access(this.config.persistenceFile, constants.R_OK);
      const data = await readFile(this.config.persistenceFile, 'utf-8');
      const items: QueueItem[] = JSON.parse(data);

      let loadedCount = 0;
      for (const item of items) {
        // Convert date strings back to Date objects
        item.lastUpdated = new Date(item.lastUpdated);
        item.requestedAt = new Date(item.requestedAt);
        if (item.startedAt) item.startedAt = new Date(item.startedAt);
        if (item.completedAt) item.completedAt = new Date(item.completedAt);

        this.queue.set(item.id, item);
        loadedCount++;
      }

      console.log(`Loaded ${loadedCount} jobs from ${this.config.persistenceFile}`);
      return loadedCount;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.log(`No persistence file found at ${this.config.persistenceFile}, starting with empty queue`);
        return 0;
      }
      throw new Error(`Failed to load queue state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Saves queue state to persistence file
   */
  async saveToFile(): Promise<void> {
    try {
      const items = Array.from(this.queue.values());
      const data = JSON.stringify(items, null, 2);
      await writeFile(this.config.persistenceFile, data, 'utf-8');
    } catch (error) {
      console.error(`Failed to save queue state: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Graceful shutdown - saves state and cleans up
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.persistenceTimeout) {
      clearTimeout(this.persistenceTimeout);
    }

    await this.saveToFile();
    console.log(`Queue state saved to ${this.config.persistenceFile}`);
  }

  /**
   * Sets up periodic cleanup of old completed/failed jobs
   */
  private setupCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      const removed = await this.cleanup();
      if (removed > 0) {
        console.log(`Cleaned up ${removed} old jobs from memory`);
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Sets up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    // Only set up handlers if not in test environment
    if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
      const shutdownHandler = async () => {
        console.log('Shutting down queue manager...');
        await this.shutdown();
        process.exit(0);
      };

      process.on('SIGINT', shutdownHandler);
      process.on('SIGTERM', shutdownHandler);
      process.on('beforeExit', () => {
        if (!this.isShuttingDown) {
          this.saveToFile().catch(console.error);
        }
      });
    }
  }

  /**
   * Schedules persistence to avoid too frequent writes
   */
  private schedulePersistence(): void {
    if (this.persistenceTimeout) {
      clearTimeout(this.persistenceTimeout);
    }

    this.persistenceTimeout = setTimeout(() => {
      this.saveToFile().catch(console.error);
    }, 1000); // Debounce writes by 1 second
  }
}
