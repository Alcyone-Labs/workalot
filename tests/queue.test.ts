import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlink } from 'fs/promises';
import { QueueManager } from '../src/queue/index.js';
import { JobStatus, JobPayload } from '../src/types/index.js';

describe('Queue System', () => {
  let queueManager: QueueManager;
  let testPersistenceFile: string;

  beforeEach(async () => {
    // Use unique file name for each test to avoid conflicts
    testPersistenceFile = `test-queue-state-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;

    queueManager = new QueueManager({
      persistenceFile: testPersistenceFile,
      maxInMemoryAge: 1000, // 1 second for testing
      healthCheckInterval: 100 // 100ms for testing
    });
    await queueManager.initialize();
  });

  afterEach(async () => {
    await queueManager.shutdown();
    // Clean up test persistence file
    try {
      await unlink(testPersistenceFile);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe('QueueManager', () => {
    it('should add jobs to the queue', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId = await queueManager.addJob(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      const job = await queueManager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe(JobStatus.PENDING);
      expect(job?.jobPayload).toEqual(jobPayload);
    });

    it('should add jobs with custom ID', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const customId = 'custom-job-id';
      const jobId = await queueManager.addJob(jobPayload, customId);
      expect(jobId).toBe(customId);

      const job = await queueManager.getJob(customId);
      expect(job).toBeDefined();
      expect(job?.id).toBe(customId);
    });

    it('should reject duplicate job IDs', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const customId = 'duplicate-id';
      await queueManager.addJob(jobPayload, customId);

      await expect(queueManager.addJob(jobPayload, customId))
        .rejects.toThrow('Job with ID duplicate-id already exists in queue');
    });

    it('should update job status', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId = await queueManager.addJob(jobPayload);
      
      // Update to processing
      const updated = await queueManager.updateJobStatus(jobId, JobStatus.PROCESSING, undefined, undefined, 1);
      expect(updated).toBe(true);

      const job = await queueManager.getJob(jobId);
      expect(job?.status).toBe(JobStatus.PROCESSING);
      expect(job?.workerId).toBe(1);
      expect(job?.startedAt).toBeDefined();
    });

    it('should complete jobs with results', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId = await queueManager.addJob(jobPayload);
      
      const result = {
        results: { success: true, message: 'pong' },
        executionTime: 100,
        queueTime: 50
      };

      await queueManager.updateJobStatus(jobId, JobStatus.COMPLETED, result);

      const job = await queueManager.getJob(jobId);
      expect(job?.status).toBe(JobStatus.COMPLETED);
      expect(job?.result).toEqual(result);
      expect(job?.completedAt).toBeDefined();
    });

    it('should fail jobs with errors', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId = await queueManager.addJob(jobPayload);
      const error = new Error('Job failed');

      await queueManager.updateJobStatus(jobId, JobStatus.FAILED, undefined, error);

      const job = await queueManager.getJob(jobId);
      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.error).toEqual(error);
      expect(job?.completedAt).toBeDefined();
    });

    it('should get next pending job', async () => {
      const jobPayload1: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data1' }
      };

      const jobPayload2: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data2' }
      };

      const jobId1 = await queueManager.addJob(jobPayload1);
      const jobId2 = await queueManager.addJob(jobPayload2);

      const nextJob = await queueManager.getNextPendingJob();
      expect(nextJob).toBeDefined();
      expect(nextJob?.id).toBe(jobId1); // Should get the first one

      // Mark first as processing
      await queueManager.updateJobStatus(jobId1, JobStatus.PROCESSING);

      const nextJob2 = await queueManager.getNextPendingJob();
      expect(nextJob2?.id).toBe(jobId2); // Should get the second one
    });

    it('should get jobs by status', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId1 = await queueManager.addJob(jobPayload);
      const jobId2 = await queueManager.addJob(jobPayload);

      await queueManager.updateJobStatus(jobId1, JobStatus.PROCESSING);

      const pendingJobs = await queueManager.getJobsByStatus(JobStatus.PENDING);
      const processingJobs = await queueManager.getJobsByStatus(JobStatus.PROCESSING);

      expect(pendingJobs).toHaveLength(1);
      expect(pendingJobs[0].id).toBe(jobId2);

      expect(processingJobs).toHaveLength(1);
      expect(processingJobs[0].id).toBe(jobId1);
    });

    it('should get queue statistics', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId1 = await queueManager.addJob(jobPayload);
      const jobId2 = await queueManager.addJob(jobPayload);
      const jobId3 = await queueManager.addJob(jobPayload);

      await queueManager.updateJobStatus(jobId1, JobStatus.PROCESSING);
      await queueManager.updateJobStatus(jobId2, JobStatus.COMPLETED);

      const stats = await queueManager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.processing).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.oldestPending).toBeDefined();
    });

    it('should check if queue has pending jobs', async () => {
      expect(await queueManager.hasPendingJobs()).toBe(false);

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      await queueManager.addJob(jobPayload);
      expect(await queueManager.hasPendingJobs()).toBe(true);
    });

    it('should check if queue is empty', async () => {
      expect(await queueManager.isEmpty()).toBe(true);

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      await queueManager.addJob(jobPayload);
      expect(await queueManager.isEmpty()).toBe(false);
    });

    it('should clean up old completed jobs', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId = await queueManager.addJob(jobPayload);
      await queueManager.updateJobStatus(jobId, JobStatus.COMPLETED);

      // Manually set the lastUpdated time to be old enough for cleanup
      const job = await queueManager.getJob(jobId);
      if (job) {
        job.lastUpdated = new Date(Date.now() - 2000); // 2 seconds ago
      }

      const removedCount = await queueManager.cleanup();
      expect(removedCount).toBe(1);

      const jobAfterCleanup = await queueManager.getJob(jobId);
      expect(jobAfterCleanup).toBeUndefined();
    });

    it('should persist and load queue state', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };

      const jobId = await queueManager.addJob(jobPayload);
      await queueManager.saveToFile();

      // Create new queue manager and load state
      const newQueueManager = new QueueManager({
        persistenceFile: testPersistenceFile
      });

      const loadedCount = await newQueueManager.loadFromFile();
      expect(loadedCount).toBe(1);

      const job = await newQueueManager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.jobPayload).toEqual(jobPayload);

      await newQueueManager.shutdown();

      // Clean up the additional persistence file
      try {
        await unlink(testPersistenceFile);
      } catch (error) {
        // File might not exist, ignore
      }
    });
  });
});
