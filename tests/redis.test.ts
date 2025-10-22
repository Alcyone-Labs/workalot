import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { RedisQueue } from "../src/queue/RedisQueue.js";
import { JobStatus, JobPayload } from "../src/types/index.js";

// Mock Redis for testing
// In a real environment, you'd use a test Redis instance or ioredis-mock
const REDIS_AVAILABLE = process.env.REDIS_URL || process.env.CI === "true";

describe.skipIf(!REDIS_AVAILABLE)("Redis Queue", () => {
  let queue: RedisQueue;
  const testKeyPrefix = `test-workalot-${Date.now()}`;

  beforeAll(async () => {
    // Skip if Redis is not available
    if (!REDIS_AVAILABLE) {
      console.log("Skipping Redis tests - Redis not available");
      return;
    }
  });

  beforeEach(async () => {
    queue = new RedisQueue({
      redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
      keyPrefix: testKeyPrefix,
      completedJobTTL: 60, // 1 minute for testing
      failedJobTTL: 120, // 2 minutes for testing
      debug: false,
    });

    await queue.initialize();
    await queue.clear(); // Clear any existing test data
  });

  afterEach(async () => {
    if (queue) {
      await queue.clear();
      await queue.shutdown();
    }
  });

  describe("Basic Operations", () => {
    it("should add jobs to the queue", async () => {
      const jobPayload: JobPayload = {
        jobFile: "examples/PingJob.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      const job = await queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe(JobStatus.PENDING);
      expect(job?.jobPayload).toEqual(jobPayload);
    });

    it("should update job status", async () => {
      const jobPayload: JobPayload = {
        jobFile: "examples/PingJob.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);

      // Update to processing
      await queue.updateJobStatus(
        jobId,
        JobStatus.PROCESSING,
        { workerId: 1, startedAt: Date.now() }
      );

      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.PROCESSING);
      expect(job?.workerId).toBe(1);
      expect(job?.startedAt).toBeDefined();
    });

    it("should complete jobs with results", async () => {
      const jobPayload: JobPayload = {
        jobFile: "examples/PingJob.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);

      // Mark as processing first
      await queue.updateJobStatus(
        jobId,
        JobStatus.PROCESSING,
        { workerId: 1, startedAt: Date.now() }
      );

      // Complete the job
      const results = { success: true, message: "Test completed" };
      await queue.updateJobStatus(
        jobId,
        JobStatus.COMPLETED,
        { results, executionTime: 100, queueTime: 50 }
      );

      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.COMPLETED);
      expect(job?.result?.results).toEqual(results);
      expect(job?.completedAt).toBeDefined();
    });

    it("should handle job failures", async () => {
      const jobPayload: JobPayload = {
        jobFile: "examples/PingJob.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await queue.addJob(jobPayload);

      // Mark as processing
      await queue.updateJobStatus(
        jobId,
        JobStatus.PROCESSING,
        { workerId: 1, startedAt: Date.now() }
      );

      // Fail the job
      const error = "Test error";
      await queue.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        { error }
      );

      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.error).toBe(error);
    });
  });

  describe("Atomic Job Claiming", () => {
    it("should atomically claim jobs with Lua script", async () => {
      const jobPayload: JobPayload = {
        jobFile: "examples/PingJob.ts",
        jobPayload: { test: "data" },
      };

      await queue.addJob(jobPayload);

      const job = await queue.getNextPendingJob();
      expect(job).toBeDefined();
      expect(job?.status).toBe(JobStatus.PROCESSING);
    });

    it("should prevent duplicate job claiming", async () => {
      // Add 5 jobs
      const jobIds = await Promise.all([
        queue.addJob({ jobFile: "test1.ts", jobPayload: {} }),
        queue.addJob({ jobFile: "test2.ts", jobPayload: {} }),
        queue.addJob({ jobFile: "test3.ts", jobPayload: {} }),
        queue.addJob({ jobFile: "test4.ts", jobPayload: {} }),
        queue.addJob({ jobFile: "test5.ts", jobPayload: {} }),
      ]);

      // Claim all jobs concurrently
      const [job1, job2, job3, job4, job5] = await Promise.all([
        queue.getNextPendingJob(),
        queue.getNextPendingJob(),
        queue.getNextPendingJob(),
        queue.getNextPendingJob(),
        queue.getNextPendingJob(),
      ]);

      // Collect claimed job IDs
      const claimedIds = [job1?.id, job2?.id, job3?.id, job4?.id, job5?.id].filter(Boolean);

      // Verify no duplicates
      const uniqueIds = new Set(claimedIds);
      expect(claimedIds.length).toBe(uniqueIds.size);
      expect(claimedIds.length).toBe(5);
    });

    it("should return undefined when no jobs available", async () => {
      const job = await queue.getNextPendingJob();
      expect(job).toBeUndefined();
    });
  });

  describe("Batch Operations", () => {
    it("should batch add jobs", async () => {
      const jobs = [
        { payload: { jobFile: "job1.ts", jobPayload: { task: 1 } } },
        { payload: { jobFile: "job2.ts", jobPayload: { task: 2 } } },
        { payload: { jobFile: "job3.ts", jobPayload: { task: 3 } } },
      ];

      const jobIds = await queue.batchAddJobs(jobs);
      expect(jobIds).toHaveLength(3);

      const stats = await queue.getStats();
      expect(stats.pending).toBe(3);
    });
  });

  describe("Queue Stats", () => {
    it("should track queue statistics", async () => {
      // Add jobs
      await queue.addJob({ jobFile: "test1.ts", jobPayload: {} });
      await queue.addJob({ jobFile: "test2.ts", jobPayload: {} });
      await queue.addJob({ jobFile: "test3.ts", jobPayload: {} });

      let stats = await queue.getStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(3);
      expect(stats.processing).toBe(0);

      // Claim one job
      await queue.getNextPendingJob();

      stats = await queue.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(1);
    });
  });

  describe("Stalled Job Recovery", () => {
    it("should detect stalled jobs", async () => {
      const jobId = await queue.addJob({ jobFile: "test.ts", jobPayload: {} });

      // Manually mark as stalled by setting old start time
      const redis = queue.getRedisClient();
      const oldTime = Date.now() - 400000; // 400 seconds ago
      await redis.hset(`${testKeyPrefix}:queue:processing`, jobId, `999:${oldTime}`);
      await redis.hset(`${testKeyPrefix}:jobs:${jobId}`, {
        status: JobStatus.PROCESSING,
        workerId: 999,
        startedAt: oldTime,
      });

      const stalledJobs = await queue.getStalledJobs(300000); // 5 minutes
      expect(stalledJobs.length).toBeGreaterThan(0);
    });

    it("should recover stalled jobs", async () => {
      const jobId = await queue.addJob({ jobFile: "test.ts", jobPayload: {} });

      // Manually mark as stalled
      const redis = queue.getRedisClient();
      const oldTime = Date.now() - 400000;
      await redis.hset(`${testKeyPrefix}:queue:processing`, jobId, `999:${oldTime}`);
      await redis.hset(`${testKeyPrefix}:jobs:${jobId}`, {
        status: JobStatus.PROCESSING,
        workerId: 999,
        startedAt: oldTime,
      });

      const recoveredCount = await queue.recoverStalledJobs(300000);
      expect(recoveredCount).toBeGreaterThan(0);

      // Job should be back in pending
      const job = await queue.getJob(jobId);
      expect(job?.status).toBe(JobStatus.PENDING);
    });
  });

  describe("Queue State Checks", () => {
    it("should check if queue has pending jobs", async () => {
      expect(await queue.hasPendingJobs()).toBe(false);

      await queue.addJob({ jobFile: "test.ts", jobPayload: {} });
      expect(await queue.hasPendingJobs()).toBe(true);
    });

    it("should check if queue is empty", async () => {
      expect(await queue.isEmpty()).toBe(true);

      await queue.addJob({ jobFile: "test.ts", jobPayload: {} });
      expect(await queue.isEmpty()).toBe(false);
    });
  });
});

