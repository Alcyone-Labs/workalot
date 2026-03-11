import { BaseJob } from "../../src/jobs/BaseJob.js";

export class LongRunningJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const { duration = 100 } = payload;

    await new Promise((resolve) => setTimeout(resolve, duration));

    return this.createSuccessResult({
      message: `Completed after ${duration}ms`,
      workerId: -1,
    });
  }
}
