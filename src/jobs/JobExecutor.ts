import { JobLoader, JobLoadError, JobValidationError } from './JobLoader.js';
import { JobPayload, JobResult } from '../types/index.js';

/**
 * Error thrown when job execution times out
 */
export class JobTimeoutError extends Error {
  constructor(timeout: number, jobFile: string) {
    super(`Job execution timed out after ${timeout}ms: ${jobFile}`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * Error thrown when job execution fails
 */
export class JobExecutionError extends Error {
  constructor(message: string, public readonly jobFile: string, public readonly cause?: Error) {
    super(message);
    this.name = 'JobExecutionError';
  }
}

/**
 * Execution context for a job
 */
export interface JobExecutionContext {
  jobId: string;
  startTime: number;
  queueTime: number;
  timeout: number;
}

/**
 * Handles job execution with timeout and error handling
 */
export class JobExecutor {
  private readonly jobLoader: JobLoader;
  private readonly defaultTimeout: number;

  constructor(projectRoot?: string, defaultTimeout: number = 5000) {
    this.jobLoader = new JobLoader(projectRoot);
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Executes a job with timeout and comprehensive error handling
   */
  async executeJob(
    jobPayload: JobPayload,
    context: JobExecutionContext
  ): Promise<JobResult> {
    const { jobFile, jobPayload: payload, jobTimeout } = jobPayload;
    const timeout = jobTimeout || this.defaultTimeout;
    const startTime = Date.now();

    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new JobTimeoutError(timeout, jobFile.toString()));
        }, timeout);
      });

      // Execute the job with timeout
      const executionPromise = this.jobLoader.executeJob(jobPayload);
      
      const result = await Promise.race([executionPromise, timeoutPromise]);
      const executionTime = Date.now() - startTime;

      return {
        results: result,
        executionTime,
        queueTime: context.queueTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Handle different types of errors
      if (error instanceof JobTimeoutError) {
        throw error;
      }

      if (error instanceof JobLoadError || error instanceof JobValidationError) {
        throw new JobExecutionError(
          `Job loading failed: ${error.message}`,
          jobFile.toString(),
          error
        );
      }

      // Generic execution error
      throw new JobExecutionError(
        `Job execution failed: ${error instanceof Error ? error.message : String(error)}`,
        jobFile.toString(),
        error as Error
      );
    }
  }

  /**
   * Gets job ID for a given payload
   */
  async getJobId(jobPayload: JobPayload): Promise<string | undefined> {
    try {
      return await this.jobLoader.getJobId(jobPayload);
    } catch (error) {
      if (error instanceof JobLoadError || error instanceof JobValidationError) {
        throw new JobExecutionError(
          `Failed to get job ID: ${error.message}`,
          jobPayload.jobFile.toString(),
          error
        );
      }
      throw error;
    }
  }

  /**
   * Validates that a job can be loaded without executing it
   */
  async validateJob(jobFile: string): Promise<boolean> {
    try {
      await this.jobLoader.loadJob(jobFile);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Preloads a job into cache
   */
  async preloadJob(jobFile: string): Promise<void> {
    await this.jobLoader.loadJob(jobFile);
  }

  /**
   * Clears the job cache
   */
  clearCache(): void {
    this.jobLoader.clearCache();
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return this.jobLoader.getCacheStats();
  }
}
