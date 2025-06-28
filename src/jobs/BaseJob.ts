import { ulid } from "ulidx";
import { IJob, JobExecutionContext } from "../types/index.js";

export abstract class BaseJob implements IJob {
  protected jobName: string;

  constructor(jobName?: string) {
    this.jobName = jobName || this.constructor.name;
  }

  abstract run(
    payload: Record<string, any>,
    context: JobExecutionContext,
  ): Promise<Record<string, any>>;

  getJobId(payload?: Record<string, any>): string | undefined {
    if (!payload) {
      return undefined;
    }
    // Generate monotonic, time-sortable ULID instead of SHA1 hash
    // This prevents collisions for recurring jobs and is much more performant
    return ulid();
  }

  protected validatePayload(
    payload: Record<string, any>,
    requiredFields: string[],
  ): void {
    for (const field of requiredFields) {
      if (!(field in payload)) {
        throw new Error(`Missing required field in payload: ${field}`);
      }
    }
  }

  protected createSuccessResult(
    data: Record<string, any>,
  ): Record<string, any> {
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  protected createErrorResult(
    message: string,
    details?: Record<string, any>,
  ): Record<string, any> {
    return {
      success: false,
      error: message,
      details,
      timestamp: new Date().toISOString(),
    };
  }
}
