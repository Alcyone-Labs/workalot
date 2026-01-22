import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGLiteQueue } from "../src/queue/PGLiteQueue.ts";
import { TaskManager } from "../src/api/TaskManager.ts";
import { JobStatus } from "../src/types/index.ts";
import { resolve } from "path";

const projectRoot = resolve(process.cwd());

describe("PGLite Integration", () => {
  let pgliteQueue: PGLiteQueue;

  beforeEach(async () => {
    // Create an in-memory PGLite queue for testing
    pgliteQueue = new PGLiteQueue({
      databaseUrl: "memory://",
      autoMigrate: true,
      debug: false,
    });
    await pgliteQueue.initialize();
  });

  afterEach(async () => {
    if (pgliteQueue) {
      await pgliteQueue.shutdown();
    }
  });

  describe("PGLiteQueue Basic Operations", () => {
    it("should initialize successfully", async () => {
      expect(pgliteQueue).toBeDefined();

      // Verify we can add a job - this confirms initialization
      const jobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };
      const jobId = await pgliteQueue.addJob(jobPayload);
      expect(jobId).toBeDefined();
    });

    it("should add and retrieve jobs", async () => {
      const jobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await pgliteQueue.addJob(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      const retrievedJob = await pgliteQueue.getJob(jobId);
      expect(retrievedJob).toBeDefined();
      expect(retrievedJob!.id).toBe(jobId);
      expect(retrievedJob!.jobPayload).toEqual(jobPayload);
      expect(retrievedJob!.status).toBe(JobStatus.PENDING);
    });

    it("should get jobs by status", async () => {
      const jobPayload1 = {
        jobFile: "test-job-1.ts",
        jobPayload: { test: "data1" },
      };
      const jobPayload2 = {
        jobFile: "test-job-2.ts",
        jobPayload: { test: "data2" },
      };

      const jobId1 = await pgliteQueue.addJob(jobPayload1);
      const jobId2 = await pgliteQueue.addJob(jobPayload2);

      const pendingJobs = await pgliteQueue.getJobsByStatus(JobStatus.PENDING);
      expect(pendingJobs).toHaveLength(2);
      expect(pendingJobs.map((j) => j.id)).toContain(jobId1);
      expect(pendingJobs.map((j) => j.id)).toContain(jobId2);

      const completedJobs = await pgliteQueue.getJobsByStatus(JobStatus.COMPLETED);
      expect(completedJobs).toHaveLength(0);
    });

    it("should update job status", async () => {
      const jobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await pgliteQueue.addJob(jobPayload);

      // Update to processing
      const updated = await pgliteQueue.updateJobStatus(
        jobId,
        JobStatus.PROCESSING,
        undefined,
        undefined,
        1,
      );
      expect(updated).toBe(true);

      const job = await pgliteQueue.getJob(jobId);
      expect(job!.status).toBe(JobStatus.PROCESSING);
      expect(job!.workerId).toBe(1);
      expect(job!.startedAt).toBeDefined();

      // Update to completed
      const result = {
        results: { success: true, data: "result" },
        executionTime: 100,
        queueTime: 50,
      };
      await pgliteQueue.updateJobStatus(jobId, JobStatus.COMPLETED, result);

      const completedJob = await pgliteQueue.getJob(jobId);
      expect(completedJob!.status).toBe(JobStatus.COMPLETED);
      expect(completedJob!.result).toEqual(result);
      expect(completedJob!.completedAt).toBeDefined();
    });

    it("should get next pending job with row locking", async () => {
      const jobPayload1 = {
        jobFile: "test-job-1.ts",
        jobPayload: { priority: 1 },
      };
      const jobPayload2 = {
        jobFile: "test-job-2.ts",
        jobPayload: { priority: 2 },
      };

      await pgliteQueue.addJob(jobPayload1);
      await pgliteQueue.addJob(jobPayload2);

      const nextJob = await pgliteQueue.getNextPendingJob();
      expect(nextJob).toBeDefined();
      expect(nextJob!.status).toBe(JobStatus.PROCESSING);
      expect(nextJob!.startedAt).toBeDefined();

      // The job should now be marked as processing
      const job = await pgliteQueue.getJob(nextJob!.id);
      expect(job!.status).toBe(JobStatus.PROCESSING);
    });

    it("should handle queue statistics correctly", async () => {
      // Add some jobs
      await pgliteQueue.addJob({ jobFile: "job1.ts", jobPayload: {} });
      await pgliteQueue.addJob({ jobFile: "job2.ts", jobPayload: {} });

      // Process one job
      const nextJob = await pgliteQueue.getNextPendingJob();
      if (nextJob) {
        await pgliteQueue.updateJobStatus(nextJob.id, JobStatus.COMPLETED, {
          results: { success: true },
          executionTime: 100,
          queueTime: 50,
        });
      }

      // Verify queue operations work
      const jobCount = await pgliteQueue.hasPendingJobs();
      expect(jobCount).toBe(true);
    });

    it("should check for pending jobs and empty state", async () => {
      expect(await pgliteQueue.isEmpty()).toBe(true);
      expect(await pgliteQueue.hasPendingJobs()).toBe(false);

      await pgliteQueue.addJob({ jobFile: "job.ts", jobPayload: {} });

      expect(await pgliteQueue.isEmpty()).toBe(false);
      expect(await pgliteQueue.hasPendingJobs()).toBe(true);
    });
  });

  describe("TaskManager with PGLite Backend", () => {
    let taskManager: TaskManager;

    beforeEach(async () => {
      taskManager = new TaskManager(
        {
          backend: "pglite",
          databaseUrl: "memory://",
          maxThreads: 2,
        },
        projectRoot,
      );
      await taskManager.initialize();
    });

    afterEach(async () => {
      if (taskManager) {
        await taskManager.shutdown();
      }
    });

    it("should initialize TaskManager with PGLite backend", async () => {
      const status = await taskManager.getStatus();
      expect(status.isInitialized).toBe(true);
      expect(status.queue).toBeDefined();
    });

    it("should schedule and execute jobs using PGLite backend", async () => {
      const jobId = await taskManager.schedule({
        jobFile: "./tests/fixtures/SimpleTestJob.ts",
        jobPayload: { operation: "add", values: [1, 2] },
      });

      expect(jobId).toBeDefined();

      // Wait a bit for job processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = await taskManager.getQueueStats();
      expect(stats.total).toBeGreaterThan(0);
    });

    it("should handle job status queries with PGLite backend", async () => {
      await taskManager.schedule({
        jobFile: "./tests/fixtures/SimpleTestJob.ts",
        jobPayload: { operation: "add", values: [5, 10] },
      });

      // Wait for job to complete
      await taskManager.whenIdle(5000);

      const completedJobs = await taskManager.getJobsByStatus("completed");
      expect(completedJobs.length).toBeGreaterThan(0);

      const failedJobs = await taskManager.getJobsByStatus("failed");
      expect(Array.isArray(failedJobs)).toBe(true);
    });
  });

  describe("PGLite Advanced Features", () => {
    it("should support scheduled jobs", async () => {
      const futureDate = new Date(Date.now() + 1000); // 1 second in the future
      const jobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { scheduled: true },
      };

      const jobId = await pgliteQueue.scheduleJob(jobPayload, futureDate);
      expect(jobId).toBeDefined();

      // Job should not be available immediately
      const nextJob = await pgliteQueue.getNextPendingJob();
      expect(nextJob).toBeUndefined();

      // Check scheduled jobs
      const scheduledJobs = await pgliteQueue.getScheduledJobs();
      expect(scheduledJobs).toHaveLength(1);
      expect(scheduledJobs[0].id).toBe(jobId);
    });

    it("should provide detailed job information", async () => {
      const jobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { detailed: true },
      };

      const jobId = await pgliteQueue.addJob(jobPayload);
      const jobDetails = await pgliteQueue.getJobDetails(jobId);

      expect(jobDetails).toBeDefined();
      expect(jobDetails.id).toBe(jobId);
      expect(jobDetails.retryCount).toBe(0);
      expect(jobDetails.maxRetries).toBe(0);
      expect(jobDetails.priority).toBe(0);
    });

    it("should support raw database queries", async () => {
      const result = await pgliteQueue.query("SELECT NOW() as current_time");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].current_time).toBeDefined();
    });

    it("should support database transactions", async () => {
      // Test that transactions work with the correct table name
      const result = await pgliteQueue.transaction(async (db) => {
        const insertResult = await db.query(
          "INSERT INTO workalot_jobs (id, job_payload, status) VALUES ($1, $2, $3) RETURNING id",
          ["test-tx-job", '{"test": true}', "pending"],
        );
        return insertResult.rows[0].id;
      });

      expect(result).toBe("test-tx-job");

      const job = await pgliteQueue.getJob("test-tx-job");
      expect(job).toBeDefined();
      expect(job!.id).toBe("test-tx-job");
    });
  });
});
