import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RedisQueue } from "../src/queue/RedisQueue.js";
import { JobStatus, JobPayload } from "../src/types/index.js";

const REDIS_MOCK_AVAILABLE = process.env.REDIS_MOCK_AVAILABLE === "true";

describe("Redis Queue", () => {
  let queue: RedisQueue | null = null;
  const testKeyPrefix = `test-workalot-${Date.now()}`;

  beforeEach(async () => {
    if (!REDIS_MOCK_AVAILABLE) {
      console.log("Redis mock not available, skipping test");
      return;
    }

    const redisMock = (global as any).__REDIS_MOCK__;

    queue = new RedisQueue({
      redisClient: redisMock,
      keyPrefix: testKeyPrefix,
      completedJobTTL: 60,
      failedJobTTL: 120,
      debug: false,
    });

    await queue.initialize();
    await queue.clear();
  });

  afterEach(async () => {
    if (queue) {
      await queue.clear();
      await queue.shutdown();
      queue = null;
    }
  });

  it("should add jobs to the queue", async () => {
    if (!queue) return;

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
    if (!queue) return;

    const jobPayload: JobPayload = {
      jobFile: "examples/PingJob.ts",
      jobPayload: { test: "data" },
    };

    const jobId = await queue.addJob(jobPayload);

    await queue.updateJobStatus(jobId, JobStatus.PROCESSING, undefined, undefined, 1);

    const job = await queue.getJob(jobId);
    expect(job?.status).toBe(JobStatus.PROCESSING);
    expect(job?.workerId).toBe(1);
    expect(job?.startedAt).toBeDefined();
  });

  it("should complete jobs with results", async () => {
    if (!queue) return;

    const jobPayload: JobPayload = {
      jobFile: "examples/PingJob.ts",
      jobPayload: { test: "data" },
    };

    const jobId = await queue.addJob(jobPayload);

    await queue.updateJobStatus(jobId, JobStatus.PROCESSING, undefined, undefined, 1);

    const result = {
      results: { success: true, message: "Test completed" },
      executionTime: 100,
      queueTime: 50,
    };
    await queue.updateJobStatus(jobId, JobStatus.COMPLETED, result);

    const job = await queue.getJob(jobId);
    expect(job?.status).toBe(JobStatus.COMPLETED);
    expect(job?.result?.results).toEqual(result.results);
    expect(job?.completedAt).toBeDefined();
  });

  it("should handle job failures", async () => {
    if (!queue) return;

    const jobPayload: JobPayload = {
      jobFile: "examples/PingJob.ts",
      jobPayload: { test: "data" },
    };

    const jobId = await queue.addJob(jobPayload);

    await queue.updateJobStatus(jobId, JobStatus.PROCESSING, undefined, undefined, 1);

    const error = new Error("Test error");
    await queue.updateJobStatus(jobId, JobStatus.FAILED, undefined, error);

    const job = await queue.getJob(jobId);
    expect(job?.status).toBe(JobStatus.FAILED);
    expect(job?.error).toBe("Test error");
  });

  it("should atomically claim jobs with Lua script", async () => {
    if (!queue) return;

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
    if (!queue) return;

    const jobIds = await Promise.all([
      queue.addJob({ jobFile: "test1.ts", jobPayload: {} }),
      queue.addJob({ jobFile: "test2.ts", jobPayload: {} }),
      queue.addJob({ jobFile: "test3.ts", jobPayload: {} }),
      queue.addJob({ jobFile: "test4.ts", jobPayload: {} }),
      queue.addJob({ jobFile: "test5.ts", jobPayload: {} }),
    ]);

    const [job1, job2, job3, job4, job5] = await Promise.all([
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
    ]);

    const claimedIds = [job1?.id, job2?.id, job3?.id, job4?.id, job5?.id].filter(Boolean);

    const uniqueIds = new Set(claimedIds);
    expect(claimedIds.length).toBe(uniqueIds.size);
    expect(claimedIds.length).toBe(5);
  });

  it("should return undefined when no jobs available", async () => {
    if (!queue) return;

    const job = await queue.getNextPendingJob();
    expect(job).toBeUndefined();
  });

  it("should batch add jobs", async () => {
    if (!queue) return;

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

  it("should track queue statistics", async () => {
    if (!queue) return;

    await queue.addJob({ jobFile: "test1.ts", jobPayload: {} });
    await queue.addJob({ jobFile: "test2.ts", jobPayload: {} });
    await queue.addJob({ jobFile: "test3.ts", jobPayload: {} });

    let stats = await queue.getStats();
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(3);
    expect(stats.processing).toBe(0);

    await queue.getNextPendingJob();

    stats = await queue.getStats();
    expect(stats.pending).toBe(2);
    expect(stats.processing).toBe(1);
  });

  it("should detect stalled jobs", async () => {
    if (!queue) return;

    const jobId = await queue.addJob({ jobFile: "test.ts", jobPayload: {} });

    const redis = (queue as any).redis;
    const oldTime = Date.now() - 400000;
    await redis.hset(`${testKeyPrefix}:queue:processing`, jobId, `999:${oldTime}`);
    await redis.hset(`${testKeyPrefix}:jobs:${jobId}`, {
      status: JobStatus.PROCESSING,
      workerId: 999,
      startedAt: oldTime,
    });

    const stalledJobs = await queue.getStalledJobs(300000);
    expect(stalledJobs.length).toBeGreaterThan(0);
  });

  it("should recover stalled jobs", async () => {
    if (!queue) return;

    const jobId = await queue.addJob({ jobFile: "test.ts", jobPayload: {} });

    const redis = (queue as any).redis;
    const oldTime = Date.now() - 400000;
    await redis.hset(`${testKeyPrefix}:queue:processing`, jobId, `999:${oldTime}`);
    await redis.hset(`${testKeyPrefix}:jobs:${jobId}`, {
      status: JobStatus.PROCESSING,
      workerId: 999,
      startedAt: oldTime,
    });

    const recoveredCount = await queue.recoverStalledJobs(300000);
    expect(recoveredCount).toBeGreaterThan(0);

    const job = await queue.getJob(jobId);
    expect(job?.status).toBe(JobStatus.PENDING);
  });

  it("should check if queue has pending jobs", async () => {
    if (!queue) return;

    expect(await queue.hasPendingJobs()).toBe(false);

    await queue.addJob({ jobFile: "test.ts", jobPayload: {} });
    expect(await queue.hasPendingJobs()).toBe(true);
  });

  it("should check if queue is empty", async () => {
    if (!queue) return;

    expect(await queue.isEmpty()).toBe(true);

    await queue.addJob({ jobFile: "test.ts", jobPayload: {} });
    expect(await queue.isEmpty()).toBe(false);
  });
});
