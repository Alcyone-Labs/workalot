import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlink } from 'fs/promises';
import { WorkerManager, JobScheduler } from '../src/workers/index.js';
import { QueueManager } from '../src/queue/index.js';
import { JobPayload, QueueConfig } from '../src/types/index.js';

describe('Worker System', () => {
  let workerManager: WorkerManager;
  let queueManager: QueueManager;
  let jobScheduler: JobScheduler;
  let testPersistenceFile: string;

  const config: QueueConfig = {
    maxThreads: 2, // Use only 2 threads for testing
    maxInMemoryAge: 1000,
    healthCheckInterval: 100
  };

  beforeEach(async () => {
    testPersistenceFile = `test-workers-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
    
    const configWithFile = {
      ...config,
      persistenceFile: testPersistenceFile
    };

    queueManager = new QueueManager(configWithFile);
    await queueManager.initialize();

    workerManager = new WorkerManager(configWithFile);
    jobScheduler = new JobScheduler(queueManager, configWithFile);
  });

  afterEach(async () => {
    if (workerManager) {
      await workerManager.shutdown();
    }
    if (jobScheduler) {
      await jobScheduler.shutdown();
    }
    if (queueManager) {
      await queueManager.shutdown();
    }

    // Clean up test persistence file
    try {
      await unlink(testPersistenceFile);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe('WorkerManager', () => {
    it('should initialize workers', async () => {
      await workerManager.initialize();
      
      const stats = workerManager.getWorkerStats();
      expect(stats.total).toBe(2);
      expect(stats.ready).toBe(2);
      expect(stats.busy).toBe(0);
      expect(stats.available).toBe(2);
    });

    it('should have available workers after initialization', async () => {
      await workerManager.initialize();
      expect(workerManager.hasAvailableWorkers()).toBe(true);
    });

    it('should execute a simple job', async () => {
      await workerManager.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'test' }
      };

      const context = {
        jobId: 'test-job-1',
        startTime: Date.now(),
        queueTime: 50,
        timeout: 5000
      };

      const result = await workerManager.executeJob(jobPayload, context);
      
      expect(result).toBeDefined();
      expect(result.results.success).toBe(true);
      expect(result.results.data.message).toBe('pong');
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.queueTime).toBe(50);
    });

    it('should execute multiple jobs concurrently', async () => {
      await workerManager.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/MathJob.ts',
        jobPayload: {
          operation: 'add',
          numbers: [1, 2, 3, 4, 5]
        }
      };

      const promises = [];
      for (let i = 0; i < 3; i++) {
        const context = {
          jobId: `test-job-${i}`,
          startTime: Date.now(),
          queueTime: 25,
          timeout: 5000
        };
        promises.push(workerManager.executeJob(jobPayload, context));
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.results.success).toBe(true);
        expect(result.results.data.result).toBe(15);
      }
    });

    it('should handle job errors', async () => {
      await workerManager.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/MathJob.ts',
        jobPayload: {
          operation: 'invalid',
          numbers: [1, 2, 3]
        }
      };

      const context = {
        jobId: 'test-error-job',
        startTime: Date.now(),
        queueTime: 0,
        timeout: 5000
      };

      await expect(workerManager.executeJob(jobPayload, context))
        .rejects.toThrow();
    });

    it('should handle job timeout', async () => {
      await workerManager.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/MathJob.ts',
        jobPayload: {
          operation: 'add',
          numbers: [1, 2, 3]
        },
        jobTimeout: 1 // Very short timeout
      };

      const context = {
        jobId: 'test-timeout-job',
        startTime: Date.now(),
        queueTime: 0,
        timeout: 1
      };

      await expect(workerManager.executeJob(jobPayload, context))
        .rejects.toThrow('timed out');
    });
  });

  describe('JobScheduler', () => {
    it('should initialize and schedule jobs', async () => {
      await jobScheduler.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'scheduler test' }
      };

      const jobId = await jobScheduler.scheduleJob(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      // Wait a bit for job to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      const stats = await jobScheduler.getStats();
      expect(stats.queue.total).toBeGreaterThan(0);
    });

    it('should execute job immediately', async () => {
      await jobScheduler.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'immediate test' }
      };

      const result = await jobScheduler.executeJobNow(jobPayload);
      
      expect(result).toBeDefined();
      expect(result.results.success).toBe(true);
      expect(result.results.data.message).toBe('pong');
    });

    it('should handle multiple concurrent jobs', async () => {
      await jobScheduler.initialize();

      const jobPayload: JobPayload = {
        jobFile: 'examples/MathJob.ts',
        jobPayload: {
          operation: 'multiply',
          numbers: [2, 3, 4]
        }
      };

      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(jobScheduler.executeJobNow(jobPayload));
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.results.success).toBe(true);
        expect(result.results.data.result).toBe(24);
      }
    });

    it('should emit events for job lifecycle', async () => {
      await jobScheduler.initialize();

      const events: string[] = [];
      
      jobScheduler.on('job-scheduled', () => events.push('scheduled'));
      jobScheduler.on('job-started', () => events.push('started'));
      jobScheduler.on('job-completed', () => events.push('completed'));

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'event test' }
      };

      await jobScheduler.executeJobNow(jobPayload);

      // Wait for events to be emitted
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events).toContain('scheduled');
      expect(events).toContain('completed');
    });

    it('should report idle state correctly', async () => {
      await jobScheduler.initialize();

      // Initially should be idle
      expect(await jobScheduler.isIdle()).toBe(true);

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'idle test' }
      };

      // Schedule a job and check it's not idle
      const resultPromise = jobScheduler.executeJobNow(jobPayload);
      
      // Should become idle again after job completes
      await resultPromise;
      
      // Wait a bit for processing to complete
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(await jobScheduler.isIdle()).toBe(true);
    });

    it('should get comprehensive stats', async () => {
      await jobScheduler.initialize();

      const stats = await jobScheduler.getStats();
      
      expect(stats).toHaveProperty('queue');
      expect(stats).toHaveProperty('workers');
      expect(stats).toHaveProperty('isProcessing');
      
      expect(stats.workers.total).toBe(2);
      expect(stats.workers.ready).toBe(2);
      expect(stats.workers.available).toBe(2);
    });
  });
});
