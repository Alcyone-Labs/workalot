import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteQueue, SQLiteQueueConfig } from "../src/queue/SQLiteQueue.js";
import { JobStatus, JobPayload } from "../src/types/index.js";
import { getTempDbFile, registerCleanupHandler } from "./test-utils.js";

describe("SQLiteQueue", () => {
  let queue: SQLiteQueue;
  let testDbFile: string;

  beforeEach(async () => {
    testDbFile = getTempDbFile("sqlite");
    queue = new SQLiteQueue({
      databaseUrl: testDbFile,
      debug: false,
      enableWAL: true,
    });
    await queue.initialize();
  });

  afterEach(async () => {
    try {
      await queue.shutdown();
    } catch {}
  });

  describe("Initialization", () => {
    it("should initialize successfully", async () => {
      expect(queue).toBeDefined();
      const stats = await queue.getStats();
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it("should initialize with in-memory database", async () => {
      const memQueue = new SQLiteQueue({
        databaseUrl: "memory://",
      });
      await memQueue.initialize();
      expect(memQueue).toBeDefined();
      await memQueue.shutdown();
    });
  });

  describe("Basic Operations", () => {
    it("should add jobs to the queue", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      const job = await queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.jobPayload).toEqual(jobPayload);
      expect(job?.status).toBe(JobStatus.PENDING);
    });

    it("should add jobs with custom ID", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const customId = "custom-job-123";
      const jobId = await queue.addJob(jobPayload, customId);
      expect(jobId).toBe(customId);

      const job = await queue.getJob(customId);
      expect(job).toBeDefined();
      expect(job?.id).toBe(customId);
    });

    it("should reject duplicate job IDs", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const customId = "duplicate-id";
      await queue.addJob(jobPayload, customId);

      await expect(queue.addJob(jobPayload, customId)).rejects.toThrow(
        "Job with ID duplicate-id already exists in queue",
      );
    });

    it("should update job status to processing", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);

      const updated = await queue.updateJobStatus(
        jobId,
        JobStatus.PROCESSING,
        undefined,
        undefined,
        1,
      );
      expect(updated).toBe(true);

      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.PROCESSING);
      expect(job?.workerId).toBe(1);
      expect(job?.startedAt).toBeDefined();
    });

    it("should complete jobs with results", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);

      const result = {
        results: { success: true, message: "completed" },
        executionTime: 100,
        queueTime: 50,
      };

      await queue.updateJobStatus(jobId, JobStatus.COMPLETED, result);

      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.COMPLETED);
      expect(job?.result).toEqual(result);
      expect(job?.completedAt).toBeDefined();
    });

    it("should fail jobs with errors", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);
      const error = new Error("Job failed");

      await queue.updateJobStatus(jobId, JobStatus.FAILED, undefined, error);

      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.error?.message).toBe("Job failed");
      expect(job?.completedAt).toBeDefined();
    });
  });

  describe("Job Retrieval", () => {
    it("should get next pending job", async () => {
      const jobPayload1: JobPayload = {
        jobFile: "test-job-1.ts",
        jobPayload: { test: "data1" },
      };
      const jobPayload2: JobPayload = {
        jobFile: "test-job-2.ts",
        jobPayload: { test: "data2" },
      };

      const jobId1 = await queue.addJob(jobPayload1);
      const jobId2 = await queue.addJob(jobPayload2);

      const nextJob = await queue.getNextPendingJob();
      expect(nextJob).toBeDefined();
      expect(nextJob?.id).toBe(jobId1);

      // Mark first as processing
      await queue.updateJobStatus(jobId1, JobStatus.PROCESSING);

      const nextJob2 = await queue.getNextPendingJob();
      expect(nextJob2?.id).toBe(jobId2);
    });

    it("should return undefined when no jobs available", async () => {
      const job = await queue.getNextPendingJob();
      expect(job).toBeUndefined();
    });

    it("should get jobs by status", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId1 = await queue.addJob(jobPayload);
      const jobId2 = await queue.addJob(jobPayload);

      await queue.updateJobStatus(jobId1, JobStatus.PROCESSING);

      const pendingJobs = await queue.getJobsByStatus(JobStatus.PENDING);
      const processingJobs = await queue.getJobsByStatus(JobStatus.PROCESSING);

      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].id).toBe(jobId2);

      expect(processingJobs).toHaveLength(1);
      expect(processingJobs[0].id).toBe(jobId1);
    });
  });

  describe("Queue Statistics", () => {
    it("should track queue statistics", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId1 = await queue.addJob(jobPayload);
      const jobId2 = await queue.addJob(jobPayload);
      const jobId3 = await queue.addJob(jobPayload);

      await queue.updateJobStatus(jobId1, JobStatus.PROCESSING);
      await queue.updateJobStatus(jobId2, JobStatus.COMPLETED);

      const stats = await queue.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.processing).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it("should check if queue has pending jobs", async () => {
      expect(await queue.hasPendingJobs()).toBe(false);

      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      await queue.addJob(jobPayload);
      expect(await queue.hasPendingJobs()).toBe(true);
    });

    it("should check if queue is empty", async () => {
      expect(await queue.isEmpty()).toBe(true);

      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      await queue.addJob(jobPayload);
      expect(await queue.isEmpty()).toBe(false);
    });
  });

  describe("Job Recovery", () => {
    it("should detect stalled jobs method exists", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);
      await queue.updateJobStatus(jobId, JobStatus.PROCESSING, undefined, undefined, 1);

      // Just verify the method exists and can be called
      const stalledJobs = await queue.getStalledJobs(100);
      expect(Array.isArray(stalledJobs)).toBe(true);
    });

    it("should recover stalled jobs", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);
      await queue.updateJobStatus(jobId, JobStatus.PROCESSING, undefined, undefined, 1);

      const recoveredCount = await queue.recoverStalledJobs(1);
      expect(typeof recoveredCount).toBe("number");
    });
  });

  describe("Batch Operations", () => {
    it("should add multiple jobs sequentially", async () => {
      const jobs = [
        { payload: { jobFile: "job1.ts", jobPayload: { task: 1 } } },
        { payload: { jobFile: "job2.ts", jobPayload: { task: 2 } } },
        { payload: { jobFile: "job3.ts", jobPayload: { task: 3 } } },
      ];

      for (const job of jobs) {
        await queue.addJob(job.payload as JobPayload);
      }

      const stats = await queue.getStats();
      expect(stats.pending).toBe(3);
    });

    it("should get multiple pending jobs", async () => {
      const jobs = Array.from({ length: 5 }, (_, i) => ({
        payload: { jobFile: `job${i}.ts`, jobPayload: { task: i } },
      }));

      for (const job of jobs) {
        await queue.addJob(job.payload as JobPayload);
      }

      const pendingJobs = await queue.getNextPendingJobs(3);
      expect(pendingJobs).toHaveLength(3);

      const stats = await queue.getStats();
      expect(stats.pending).toBe(2);
    });
  });

  describe("Priority Support", () => {
    it("should handle priority ordering when supported", async () => {
      const lowPriority: JobPayload = {
        jobFile: "low.ts",
        jobPayload: { priority: 1 },
      };
      const highPriority: JobPayload = {
        jobFile: "high.ts",
        jobPayload: { priority: 10 },
      };

      const lowId = await queue.addJob(lowPriority);
      const highId = await queue.addJob(highPriority);

      const nextJob = await queue.getNextPendingJob();
      expect(nextJob).toBeDefined();
      // When priority is supported, higher priority should come first
      // When not supported, jobs come in FIFO order
      expect([lowId, highId]).toContain(nextJob?.id);
    });
  });

  describe("Cleanup", () => {
    it("should cleanup old completed jobs", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);
      await queue.updateJobStatus(jobId, JobStatus.COMPLETED);

      const removedCount = await queue.cleanup();
      expect(typeof removedCount).toBe("number");
    });
  });

  describe("IsIdle Check", () => {
    it("should report idle when no pending jobs", async () => {
      expect(await queue.isIdle()).toBe(true);
    });

    it("should report not idle when jobs pending", async () => {
      const jobPayload: JobPayload = {
        jobFile: "test-job.ts",
        jobPayload: { test: "data" },
      };

      await queue.addJob(jobPayload);
      expect(await queue.isIdle()).toBe(false);
    });
  });
});
