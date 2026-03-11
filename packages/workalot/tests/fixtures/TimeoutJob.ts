import { BaseJob } from "../../src/jobs/index.js";

export default class TimeoutJob extends BaseJob {
  async run(payload: { delay: number }) {
    await new Promise((resolve) => setTimeout(resolve, payload.delay));
    return this.createSuccessResult({ message: "Should not reach here" });
  }
}
