import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TaskManager } from "../src/api/TaskManager.ts";
import { JobPayload } from "../src/types/index.ts";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");

describe("Stress Test", () => {
  let taskManager: TaskManager;

  beforeAll(async () => {
    taskManager = new TaskManager({
      maxThreads: 4,
      persistenceFile: `stress-test-queue-${Date.now()}.tson`,
    }, projectRoot);
    await taskManager.initialize();
  });

  afterAll(async () => {
    await taskManager.shutdown();
  });

  it("should handle a large volume of mixed jobs without losses", async () => {
    const totalJobs = 200;
    const jobs: JobPayload[] = [];

    for (let i = 0; i < totalJobs; i++) {
      if (i % 10 === 0) {
        // 10% failing jobs
        jobs.push({
          jobFile: "./tests/fixtures/FailingJob.ts",
          jobPayload: { index: i },
        });
      } else if (i % 5 === 0) {
        // 20% long-running jobs
        jobs.push({
          jobFile: "./tests/fixtures/LongRunningJob.ts",
          jobPayload: { index: i, duration: 100 + Math.random() * 50 },
        });
      } else {
        // 70% simple jobs
        jobs.push({
          jobFile: "./tests/fixtures/SimpleTestJob.ts",
          jobPayload: { index: i, operation: "add", values: [i, i + 1] },
        });
      }
    }

    for (const job of jobs) {
      try {
        await taskManager.schedule(job);
      } catch (error) {
        console.error(`Failed to schedule job: ${job.jobFile}`, error);
      }
    }

    await taskManager.whenIdle(30000); // Wait for all jobs to complete with a timeout

    const stats = await taskManager.getQueueStats();
    const completedJobs = await taskManager.getJobsByStatus("completed");
    const failedJobs = await taskManager.getJobsByStatus("failed");

    const expectedFulfilled = jobs.filter(
      (j) => j.jobFile !== "./tests/fixtures/FailingJob.ts",
    ).length;
    const expectedRejected = jobs.filter(
      (j) => j.jobFile === "./tests/fixtures/FailingJob.ts",
    ).length;

    expect(completedJobs.length).toBe(expectedFulfilled);
    expect(failedJobs.length).toBe(expectedRejected);
    expect(stats.total).toBe(totalJobs);
    expect(stats.completed).toBe(expectedFulfilled);
    expect(stats.failed).toBe(expectedRejected);
    expect(stats.pending).toBe(0);

    const isIdle = await taskManager.isIdle();
    expect(isIdle).toBe(true);
  }, 30000);
});
