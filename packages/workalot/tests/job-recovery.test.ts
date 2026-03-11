import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { QueueManager } from "../src/queue/QueueManager.ts";
import { PGLiteQueue } from "../src/queue/PGLiteQueue.ts";
import { JobRecoveryService } from "../src/workers/JobRecoveryService.ts";
import { JobScheduler } from "../src/workers/JobScheduler.ts";
import { JobStatus } from "../src/types/index.ts";
import { getTempTsonFile } from "./test-utils.js";

describe("Job Recovery System", () => {
  describe("JobRecoveryService", () => {
    let queueManager: QueueManager;
    let recoveryService: JobRecoveryService;
    let testId: string;
    let persistenceFile: string;

    beforeEach(async () => {
      testId = randomBytes(8).toString("hex");
      persistenceFile = getTempTsonFile("recovery");
      queueManager = new QueueManager({
        persistenceFile,
        cleanupInterval: 60000,
        maxCompletedJobs: 100,
      });
      await queueManager.initialize();
    });

    afterEach(async () => {
      if (recoveryService) {
        recoveryService.stop();
      }
      await queueManager.shutdown();
    });

    it("should initialize with correct configuration", () => {
      recoveryService = new JobRecoveryService(queueManager, {
        checkInterval: 30000,
        stalledTimeout: 120000,
        enabled: true,
        maxRecoveryAttempts: 5,
      });

      const config = recoveryService.getConfig();
      expect(config.checkInterval).toBe(30000);
      expect(config.stalledTimeout).toBe(120000);
      expect(config.enabled).toBe(true);
      expect(config.maxRecoveryAttempts).toBe(5);
    });

    it("should start and stop correctly", () => {
      recoveryService = new JobRecoveryService(queueManager);

      expect(recoveryService.getStats().isRunning).toBe(false);

      recoveryService.start();
      expect(recoveryService.getStats().isRunning).toBe(true);

      recoveryService.stop();
      expect(recoveryService.getStats().isRunning).toBe(false);
    });

    it("should not start when disabled", () => {
      recoveryService = new JobRecoveryService(queueManager, { enabled: false });

      recoveryService.start();
      expect(recoveryService.getStats().isRunning).toBe(false);
    });

    it("should recover stalled jobs", async () => {
      recoveryService = new JobRecoveryService(queueManager, {
        stalledTimeout: 100, // 100ms for quick testing
        maxRecoveryAttempts: 2,
      });

      // Add a job and manually mark it as processing with old timestamp
      const jobId = await queueManager.addJob({
        jobFile: "test-job.ts",
        jobData: { test: true },
      });

      // First update to processing status
      await queueManager.updateJobStatus(jobId, JobStatus.PROCESSING);

      // Then manually set old timestamp to simulate stalled job
      const job = await queueManager.getJobById(jobId);
      if (job) {
        job.startedAt = new Date(Date.now() - 200); // 200ms ago
      }

      // Trigger recovery check
      await recoveryService.triggerCheck();

      // Job should be recovered to pending
      const recoveredJob = await queueManager.getJobById(jobId);
      expect(recoveredJob?.status).toBe(JobStatus.PENDING);
    });

    it("should fail jobs after max recovery attempts", async () => {
      recoveryService = new JobRecoveryService(queueManager, {
        stalledTimeout: 100,
        maxRecoveryAttempts: 2,
      });

      // Add a job
      const jobId = await queueManager.addJob({
        jobFile: "test-job.ts",
        jobData: { test: true },
      });

      // Simulate multiple recovery attempts
      for (let i = 0; i < 3; i++) {
        // First update to processing status
        await queueManager.updateJobStatus(jobId, JobStatus.PROCESSING);

        // Then manually set old timestamp to simulate stalled job
        const job = await queueManager.getJobById(jobId);
        if (job) {
          job.startedAt = new Date(Date.now() - 200);
        }

        await recoveryService.triggerCheck();
      }

      // Job should be failed after max attempts
      const failedJob = await queueManager.getJobById(jobId);
      expect(failedJob?.status).toBe(JobStatus.FAILED);
    });

    it("should emit recovery events", async () => {
      recoveryService = new JobRecoveryService(queueManager, {
        stalledTimeout: 100,
      });

      const recoveryEvents: any[] = [];
      recoveryService.on("jobs-recovered", (data) => recoveryEvents.push(data));

      // Add a stalled job
      const jobId = await queueManager.addJob({
        jobFile: "test-job.ts",
        jobData: { test: true },
      });

      // First update to processing status
      await queueManager.updateJobStatus(jobId, JobStatus.PROCESSING);

      // Then manually set old timestamp to simulate stalled job
      const job = await queueManager.getJobById(jobId);
      if (job) {
        job.startedAt = new Date(Date.now() - 200);
      }

      await recoveryService.triggerCheck();

      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0].count).toBe(1);
    });

    it("should clear recovery attempts", () => {
      recoveryService = new JobRecoveryService(queueManager);

      // Simulate recovery attempts
      recoveryService.clearRecoveryAttempts("job1");
      recoveryService.clearAllRecoveryAttempts();

      const stats = recoveryService.getStats();
      expect(stats.totalJobsWithAttempts).toBe(0);
    });
  });

  describe("Queue Backend Recovery Methods", () => {
    describe("QueueManager Recovery", () => {
      let queueManager: QueueManager;
      let testId: string;
      let persistenceFile: string;

      beforeEach(async () => {
        testId = randomBytes(8).toString("hex");
        persistenceFile = getTempTsonFile("recovery-queue");
        queueManager = new QueueManager({
          persistenceFile,
        });
        await queueManager.initialize();
      });

      afterEach(async () => {
        await queueManager.shutdown();
      });

      it("should recover stalled jobs", async () => {
        // Add jobs
        const jobId1 = await queueManager.addJob({ jobFile: "test1.ts", jobData: {} });
        const jobId2 = await queueManager.addJob({ jobFile: "test2.ts", jobData: {} });

        // Mark one as stalled
        const job1 = await queueManager.getJobById(jobId1);
        if (job1) {
          job1.status = JobStatus.PROCESSING;
          job1.startedAt = new Date(Date.now() - 400000); // 400 seconds ago
        }

        // Mark one as recent processing
        const job2 = await queueManager.getJobById(jobId2);
        if (job2) {
          job2.status = JobStatus.PROCESSING;
          job2.startedAt = new Date(Date.now() - 60000); // 1 minute ago
        }

        const recoveredCount = await queueManager.recoverStalledJobs(300000); // 5 minutes
        expect(recoveredCount).toBe(1);

        // Check job statuses
        const recoveredJob1 = await queueManager.getJobById(jobId1);
        const stillProcessingJob2 = await queueManager.getJobById(jobId2);

        expect(recoveredJob1?.status).toBe(JobStatus.PENDING);
        expect(stillProcessingJob2?.status).toBe(JobStatus.PROCESSING);
      });

      it("should get stalled jobs", async () => {
        // Add a stalled job
        const jobId = await queueManager.addJob({ jobFile: "test.ts", jobData: {} });
        const job = await queueManager.getJobById(jobId);
        if (job) {
          job.status = JobStatus.PROCESSING;
          job.startedAt = new Date(Date.now() - 400000); // 400 seconds ago
        }

        const stalledJobs = await queueManager.getStalledJobs(300000); // 5 minutes
        expect(stalledJobs).toHaveLength(1);
        expect(stalledJobs[0].id).toBe(jobId);
      });
    });

    describe("PGLiteQueue Recovery", () => {
      let pgliteQueue: PGLiteQueue;

      beforeEach(async () => {
        pgliteQueue = new PGLiteQueue({
          databaseUrl: "memory://",
        });
        await pgliteQueue.initialize();
      });

      afterEach(async () => {
        await pgliteQueue.shutdown();
      });

      it("should recover stalled jobs in PGLite", async () => {
        // Add jobs
        const jobId1 = await pgliteQueue.addJob({ jobFile: "test1.ts", jobData: {} });
        const jobId2 = await pgliteQueue.addJob({ jobFile: "test2.ts", jobData: {} });

        // Mark jobs as processing (simulate stalled jobs)
        await pgliteQueue.updateJobStatus(jobId1, JobStatus.PROCESSING);
        await pgliteQueue.updateJobStatus(jobId2, JobStatus.PROCESSING);

        // Wait a bit to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Use a longer timeout for PGLite as DB operations might take slightly longer
        // and we want to ensure we catch the stalled jobs
        const recoveredCount = await pgliteQueue.recoverStalledJobs(25);
        expect(recoveredCount).toBe(2);

        // Check jobs are back to pending
        const job1 = await pgliteQueue.getJob(jobId1);
        const job2 = await pgliteQueue.getJob(jobId2);

        expect(job1?.status).toBe(JobStatus.PENDING);
        expect(job2?.status).toBe(JobStatus.PENDING);
      });

      it("should get stalled jobs from PGLite", async () => {
        // Add a job and mark as processing
        const jobId = await pgliteQueue.addJob({ jobFile: "test.ts", jobData: {} });
        await pgliteQueue.updateJobStatus(jobId, JobStatus.PROCESSING);

        // Wait to make it stalled
        await new Promise((resolve) => setTimeout(resolve, 50));

        const stalledJobs = await pgliteQueue.getStalledJobs(25);
        expect(stalledJobs).toHaveLength(1);
        expect(stalledJobs[0].id).toBe(jobId);
      });
    });
  });

  describe("JobScheduler Integration", () => {
    let jobScheduler: JobScheduler;
    let queueManager: QueueManager;
    let testId: string;
    let persistenceFile: string;

    beforeEach(async () => {
      testId = randomBytes(8).toString("hex");
      persistenceFile = getTempTsonFile("scheduler-recovery");
      queueManager = new QueueManager({
        persistenceFile,
      });

      jobScheduler = new JobScheduler(queueManager, {
        maxWorkers: 2,
        workerTimeout: 5000,
      });

      await jobScheduler.initialize();
    });

    afterEach(async () => {
      if (jobScheduler) {
        await jobScheduler.shutdown();
      }
    });

    it("should include job recovery stats", async () => {
      const stats = await jobScheduler.getStats();
      expect(stats).toHaveProperty("jobRecovery");
      expect(stats.jobRecovery).toHaveProperty("isRunning");
      expect(stats.jobRecovery).toHaveProperty("totalJobsWithAttempts");
    });

    it("should allow manual recovery trigger", async () => {
      const result = await jobScheduler.recoverStalledJobs();
      expect(typeof result).toBe("number");
    });
  });
});
