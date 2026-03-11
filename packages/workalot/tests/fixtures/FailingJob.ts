import { BaseJob } from "../../src/jobs/BaseJob.js";

export class FailingJob extends BaseJob {
  // @ts-expect-error
  async run(payload) {
    const { message = "This job is designed to fail" } = payload;
    await new Promise((resolve) => setTimeout(resolve, 50));
    throw new Error(message);
  }
}
