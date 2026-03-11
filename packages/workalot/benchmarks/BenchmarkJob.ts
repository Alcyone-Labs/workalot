import { BaseJob } from "../src/jobs/BaseJob.js";
import { JobExecutionContext } from "../src/types/index.js";

export interface BenchmarkJobPayload {
  taskType: string;
  cpuCycles: number;
  jobIndex: number;
}

/**
 * Configurable benchmark job that simulates CPU-intensive work
 */
export class BenchmarkJob extends BaseJob {
  constructor() {
    super("BenchmarkJob");
  }

  async run(
    payload: BenchmarkJobPayload,
    context: JobExecutionContext,
  ): Promise<Record<string, any>> {
    this.validatePayload(payload, ["taskType", "cpuCycles", "jobIndex"]);

    const startTime = Date.now();

    // Simulate CPU-intensive work
    await this.simulateCPUWork(payload.cpuCycles);

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    return this.createSuccessResult({
      taskType: payload.taskType,
      jobIndex: payload.jobIndex,
      cpuCycles: payload.cpuCycles,
      executionTime,
      jobId: context.jobId,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Simulate CPU-intensive work by performing mathematical operations
   */
  private async simulateCPUWork(cycles: number): Promise<void> {
    let result = 0;

    // Calculate yield interval based on cycles (yield every 10% of work, min 1000, max 50000)
    const yieldInterval = Math.max(1000, Math.min(50000, Math.floor(cycles * 0.1)));

    // Perform CPU-intensive calculations
    for (let i = 0; i < cycles; i++) {
      // Mix of operations to simulate realistic CPU load
      result += Math.sin(i) * Math.cos(i);
      result += Math.sqrt(i + 1);
      result += Math.log(i + 1);

      // Occasional async yield to prevent blocking
      if (i % yieldInterval === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Prevent optimization by using the result
    if (result === Number.NEGATIVE_INFINITY) {
      throw new Error("Unexpected calculation result");
    }
  }
}
