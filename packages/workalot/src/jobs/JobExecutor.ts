import { JobLoader, JobLoadError, JobValidationError } from "./JobLoader.js";
import { JobPayload, JobResult, JobExecutionContext, JobSchedulingRequest, BaseJobExecutionContext } from "../types/index.js";
import { ulid } from "ulidx";

/**
 * Error thrown when job execution times out
 */
export class JobTimeoutError extends Error {
  constructor(timeout: number, jobFile: string) {
    super(`Job execution timed out after ${timeout}ms: ${jobFile}`);
    this.name = "JobTimeoutError";
  }
}

/**
 * Error thrown when job execution fails
 */
export class JobExecutionError extends Error {
  constructor(
    message: string,
    public readonly jobFile: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "JobExecutionError";
  }
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
    context: BaseJobExecutionContext,
  ): Promise<JobResult> {

    const { jobFile, jobPayload: payload, jobTimeout } = jobPayload;
    const timeout = jobTimeout || this.defaultTimeout;
    const startTime = Date.now();

    // Create enhanced context with scheduling capabilities
    const enhancedContext = this.createEnhancedContext(context);

    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new JobTimeoutError(timeout, jobFile.toString()));
        }, timeout);
      });

      // Execute the job with timeout
      const executionPromise = this.jobLoader.executeJob(jobPayload, enhancedContext);

      const result = await Promise.race([executionPromise, timeoutPromise]);
      const executionTime = Date.now() - startTime;

      return {
        results: result,
        executionTime,
        queueTime: context.queueTime,
        // Include any scheduling requests made by the job
        schedulingRequests: enhancedContext._schedulingRequests,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Handle different types of errors
      if (error instanceof JobTimeoutError) {
        throw error;
      }

      if (
        error instanceof JobLoadError ||
        error instanceof JobValidationError
      ) {
        throw new JobExecutionError(
          `Job loading failed: ${error.message}`,
          jobFile.toString(),
          error,
        );
      }

      // Generic execution error
      throw new JobExecutionError(
        `Job execution failed: ${error instanceof Error ? error.message : String(error)}`,
        jobFile.toString(),
        error as Error,
      );
    }
  }

  /**
   * Create enhanced context with scheduling capabilities
   */
  private createEnhancedContext(baseContext: BaseJobExecutionContext): JobExecutionContext {
    const schedulingRequests: JobSchedulingRequest[] = [];

    return {
      ...baseContext,
      _schedulingRequests: schedulingRequests,

      // scheduleAndWait - accumulates request and returns promise that resolves to request ID
      scheduleAndWait: async (jobPayload: JobPayload): Promise<string> => {
        const requestId = ulid();
        schedulingRequests.push({
          type: 'scheduleAndWait',
          jobPayload,
          requestId,
        });
        return requestId;
      },

      // schedule - accumulates request and returns request ID immediately
      schedule: (jobPayload: JobPayload): string => {
        const requestId = ulid();
        schedulingRequests.push({
          type: 'schedule',
          jobPayload,
          requestId,
        });
        return requestId;
      },


    };
  }

  /**
   * Gets job ID for a given payload
   */
  async getJobId(jobPayload: JobPayload): Promise<string | undefined> {
    try {
      return await this.jobLoader.getJobId(jobPayload);
    } catch (error) {
      if (
        error instanceof JobLoadError ||
        error instanceof JobValidationError
      ) {
        throw new JobExecutionError(
          `Failed to get job ID: ${error.message}`,
          jobPayload.jobFile.toString(),
          error,
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
