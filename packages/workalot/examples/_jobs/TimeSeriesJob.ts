import { BaseJob } from "../../src/jobs/BaseJob.js";

/**
 * Example job for time-series processing
 */
export class TimeSeriesJob extends BaseJob {
  constructor() {
    super("TimeSeriesJob");
  }

  async run(
    payload: { id: number; timestamp: Date; data: any },
    context: any
  ): Promise<any> {
    // Validate required fields
    if (!payload.id || !payload.timestamp || !payload.data) {
      throw new Error("Missing required fields: id, timestamp, or data");
    }

    // Simulate time-series data processing
    const start = Date.now();

    // Process the data (simulate some work)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = {
      id: payload.id,
      timestamp: payload.timestamp,
      processed: true,
      processingTime: Date.now() - start,
      data: payload.data,
    };

    return this.createSuccessResult(result);
  }
}

export default TimeSeriesJob;
