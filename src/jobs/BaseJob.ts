import { createHash } from 'crypto';
import { IJob } from '../types/index.js';

/**
 * Base job class that provides common functionality for all jobs
 */
export abstract class BaseJob implements IJob {
  protected jobName: string;

  constructor(jobName?: string) {
    this.jobName = jobName || this.constructor.name;
  }

  /**
   * Default implementation generates a SHA1 hash of job name + payload
   * Override this method for custom ID generation
   */
  getJobId(payload?: Record<string, any>): string | undefined {
    if (!payload) {
      return undefined;
    }

    const content = this.jobName + JSON.stringify(payload);
    return createHash('sha1').update(content).digest('hex');
  }

  /**
   * Abstract method that must be implemented by concrete job classes
   */
  abstract run(payload: Record<string, any>): Promise<Record<string, any>> | Record<string, any>;

  /**
   * Helper method to validate required payload fields
   */
  protected validatePayload(payload: Record<string, any>, requiredFields: string[]): void {
    for (const field of requiredFields) {
      if (!(field in payload)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  /**
   * Helper method to create a standardized error response
   */
  protected createErrorResult(message: string, details?: any): Record<string, any> {
    return {
      success: false,
      error: message,
      details,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Helper method to create a standardized success response
   */
  protected createSuccessResult(data: any): Record<string, any> {
    return {
      success: true,
      data,
      timestamp: new Date().toISOString()
    };
  }
}
