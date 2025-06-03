import { pathToFileURL } from 'url';
import { resolve, extname } from 'path';
import { access, constants } from 'fs/promises';
import { IJob, JobPayload } from '../types/index.js';

/**
 * Error thrown when job loading fails
 */
export class JobLoadError extends Error {
  constructor(message: string, public readonly jobFile: string, public readonly cause?: Error) {
    super(message);
    this.name = 'JobLoadError';
  }
}

/**
 * Error thrown when job validation fails
 */
export class JobValidationError extends Error {
  constructor(message: string, public readonly jobFile: string) {
    super(message);
    this.name = 'JobValidationError';
  }
}

/**
 * Handles loading and validation of job files
 */
export class JobLoader {
  private jobCache = new Map<string, IJob>();
  private readonly projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Loads a job from a file path
   */
  async loadJob(jobFile: string): Promise<IJob> {
    const resolvedPath = resolve(this.projectRoot, jobFile);
    
    // Check cache first
    if (this.jobCache.has(resolvedPath)) {
      return this.jobCache.get(resolvedPath)!;
    }

    try {
      // Verify file exists and is accessible
      await access(resolvedPath, constants.R_OK);
    } catch (error) {
      throw new JobLoadError(
        `Job file not found or not readable: ${jobFile}`,
        jobFile,
        error as Error
      );
    }

    // Validate file extension
    const ext = extname(resolvedPath);
    if (!['.js', '.ts', '.mjs'].includes(ext)) {
      throw new JobLoadError(
        `Unsupported job file extension: ${ext}. Supported: .js, .ts, .mjs`,
        jobFile
      );
    }

    try {
      // Convert to file URL for dynamic import
      const fileUrl = pathToFileURL(resolvedPath).href;
      const module = await import(fileUrl);
      
      const job = this.extractJobFromModule(module, jobFile);
      this.validateJob(job, jobFile);
      
      // Cache the job instance
      this.jobCache.set(resolvedPath, job);
      
      return job;
    } catch (error) {
      if (error instanceof JobLoadError || error instanceof JobValidationError) {
        throw error;
      }
      throw new JobLoadError(
        `Failed to load job module: ${error instanceof Error ? error.message : String(error)}`,
        jobFile,
        error as Error
      );
    }
  }

  /**
   * Extracts job instance from loaded module
   */
  private extractJobFromModule(module: any, jobFile: string): IJob {
    // Try different export patterns
    let JobClass: any;

    // 1. Default export that's a class
    if (module.default && typeof module.default === 'function') {
      JobClass = module.default;
    }
    // 2. Named export that matches file name pattern
    else {
      const fileName = jobFile.split('/').pop()?.replace(/\.(js|ts|mjs)$/, '') || '';
      const possibleNames = [
        fileName,
        fileName.charAt(0).toUpperCase() + fileName.slice(1),
        fileName + 'Job',
        fileName.charAt(0).toUpperCase() + fileName.slice(1) + 'Job'
      ];

      for (const name of possibleNames) {
        if (module[name] && typeof module[name] === 'function') {
          JobClass = module[name];
          break;
        }
      }
    }

    if (!JobClass) {
      throw new JobLoadError(
        `No valid job class found in module. Expected default export or named export matching file name.`,
        jobFile
      );
    }

    // Instantiate the job
    try {
      return new JobClass();
    } catch (error) {
      throw new JobLoadError(
        `Failed to instantiate job class: ${error instanceof Error ? error.message : String(error)}`,
        jobFile,
        error as Error
      );
    }
  }

  /**
   * Validates that the job implements the required interface
   */
  private validateJob(job: any, jobFile: string): asserts job is IJob {
    if (!job || typeof job !== 'object') {
      throw new JobValidationError(
        'Job must be an object instance',
        jobFile
      );
    }

    if (typeof job.getJobId !== 'function') {
      throw new JobValidationError(
        'Job must implement getJobId() method',
        jobFile
      );
    }

    if (typeof job.run !== 'function') {
      throw new JobValidationError(
        'Job must implement run() method',
        jobFile
      );
    }
  }

  /**
   * Executes a job with the given payload
   */
  async executeJob(jobPayload: JobPayload): Promise<any> {
    const job = await this.loadJob(jobPayload.jobFile.toString());
    
    try {
      const result = await job.run(jobPayload.jobPayload);
      return result;
    } catch (error) {
      // Re-throw with additional context
      const enhancedError = new Error(
        `Job execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
      enhancedError.cause = error;
      throw enhancedError;
    }
  }

  /**
   * Gets job ID for a given payload
   */
  async getJobId(jobPayload: JobPayload): Promise<string | undefined> {
    const job = await this.loadJob(jobPayload.jobFile.toString());
    return job.getJobId(jobPayload.jobPayload);
  }

  /**
   * Clears the job cache
   */
  clearCache(): void {
    this.jobCache.clear();
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.jobCache.size,
      keys: Array.from(this.jobCache.keys())
    };
  }
}
