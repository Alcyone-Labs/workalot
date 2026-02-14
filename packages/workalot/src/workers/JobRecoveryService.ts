import { EventEmitter } from 'node:events';
import { IQueueBackend } from '../queue/IQueueBackend.js';
import { QueueItem, JobStatus } from '../types/index.js';

export interface JobRecoveryConfig {
  /**
   * How often to check for stalled jobs (in milliseconds)
   * Default: 60000 (1 minute)
   */
  checkInterval: number;

  /**
   * How long a job can be processing before it's considered stalled (in milliseconds)
   * Default: 300000 (5 minutes)
   */
  stalledTimeout: number;

  /**
   * Whether to enable automatic job recovery
   * Default: true
   */
  enabled: boolean;

  /**
   * Maximum number of times a job can be recovered before being marked as failed
   * Default: 3
   */
  maxRecoveryAttempts: number;
}

/**
 * Service that monitors and recovers stalled jobs
 * Runs in the background to ensure no jobs are lost due to worker crashes or timeouts
 */
export class JobRecoveryService extends EventEmitter {
  private config: Required<JobRecoveryConfig>;
  private queueBackend: IQueueBackend;
  private checkInterval?: NodeJS.Timeout;
  private isRunning = false;
  private isShuttingDown = false;
  private recoveryAttempts = new Map<string, number>();

  constructor(queueBackend: IQueueBackend, config: Partial<JobRecoveryConfig> = {}) {
    super();
    
    this.queueBackend = queueBackend;
    this.config = {
      checkInterval: config.checkInterval || 60000, // 1 minute
      stalledTimeout: config.stalledTimeout || 300000, // 5 minutes
      enabled: config.enabled !== false,
      maxRecoveryAttempts: config.maxRecoveryAttempts || 3,
    };
  }

  /**
   * Start the job recovery service
   */
  start(): void {
    if (!this.config.enabled || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.isShuttingDown = false;

    // Start periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAndRecoverStalledJobs().catch(error => {
        console.error('Error during stalled job recovery:', error);
        this.emit('recovery-error', error);
      });
    }, this.config.checkInterval);

    // Run initial check
    setTimeout(() => {
      this.checkAndRecoverStalledJobs().catch(error => {
        console.error('Error during initial stalled job recovery:', error);
        this.emit('recovery-error', error);
      });
    }, 1000); // Wait 1 second after start

    console.log(`Job recovery service started - checking every ${this.config.checkInterval}ms for jobs stalled longer than ${this.config.stalledTimeout}ms`);
    this.emit('started');
  }

  /**
   * Stop the job recovery service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isShuttingDown = true;
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    console.log('Job recovery service stopped');
    this.emit('stopped');
  }

  /**
   * Check for and recover stalled jobs
   */
  private async checkAndRecoverStalledJobs(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    try {
      // Get stalled jobs
      const stalledJobs = await this.queueBackend.getStalledJobs(this.config.stalledTimeout);
      
      if (stalledJobs.length === 0) {
        return;
      }

      console.log(`Found ${stalledJobs.length} stalled jobs`);
      this.emit('stalled-jobs-found', stalledJobs);

      // Process each stalled job
      const recoveredJobs: QueueItem[] = [];
      const failedJobs: QueueItem[] = [];

      for (const job of stalledJobs) {
        const attempts = this.recoveryAttempts.get(job.id) || 0;
        
        if (attempts >= this.config.maxRecoveryAttempts) {
          // Mark job as failed - too many recovery attempts
          try {
            await this.queueBackend.updateJobStatus(
              job.id,
              JobStatus.FAILED,
              undefined,
              new Error(`Job failed after ${attempts} recovery attempts - exceeded maximum retries`)
            );
            
            failedJobs.push(job);
            this.recoveryAttempts.delete(job.id);
            
            console.log(`Job ${job.id} marked as failed after ${attempts} recovery attempts`);
          } catch (error) {
            console.error(`Failed to mark job ${job.id} as failed:`, error);
          }
        } else {
          // Attempt to recover the job
          this.recoveryAttempts.set(job.id, attempts + 1);
          recoveredJobs.push(job);
        }
      }

      // Recover jobs that haven't exceeded max attempts
      if (recoveredJobs.length > 0) {
        const actualRecovered = await this.queueBackend.recoverStalledJobs(this.config.stalledTimeout);
        
        console.log(`Recovered ${actualRecovered} stalled jobs`);
        this.emit('jobs-recovered', {
          count: actualRecovered,
          jobs: recoveredJobs,
        });
      }

      // Emit failed jobs event
      if (failedJobs.length > 0) {
        this.emit('jobs-failed', {
          count: failedJobs.length,
          jobs: failedJobs,
        });
      }

    } catch (error) {
      console.error('Error checking for stalled jobs:', error);
      this.emit('recovery-error', error);
    }
  }

  /**
   * Manually trigger a check for stalled jobs
   */
  async triggerCheck(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Job recovery service is disabled');
    }

    await this.checkAndRecoverStalledJobs();
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<JobRecoveryConfig> {
    return { ...this.config };
  }

  /**
   * Get recovery statistics
   */
  getStats(): {
    isRunning: boolean;
    totalJobsWithAttempts: number;
    recoveryAttempts: Record<string, number>;
  } {
    return {
      isRunning: this.isRunning,
      totalJobsWithAttempts: this.recoveryAttempts.size,
      recoveryAttempts: Object.fromEntries(this.recoveryAttempts),
    };
  }

  /**
   * Clear recovery attempt history for a specific job
   */
  clearRecoveryAttempts(jobId: string): void {
    this.recoveryAttempts.delete(jobId);
  }

  /**
   * Clear all recovery attempt history
   */
  clearAllRecoveryAttempts(): void {
    this.recoveryAttempts.clear();
  }
}
