import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlink } from 'fs/promises';
import { JobScheduler } from '../src/workers/index.ts';
import { QueueManager } from '../src/queue/index.ts';
import { JobPayload, QueueConfig } from '../src/types/index.ts';

describe('Worker System', () => {
  let queueManager: QueueManager;
  let jobScheduler: JobScheduler;
  let testPersistenceFile: string;

  const config: QueueConfig = {
    maxThreads: 2, // Use only 2 threads for testing
    maxInMemoryAge: 1000,
    healthCheckInterval: 100
  };

  beforeEach(async () => {
    testPersistenceFile = `test-workers-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.tson`;
    
    const configWithFile = {
      ...config,
      persistenceFile: testPersistenceFile
    };

    queueManager = new QueueManager(configWithFile);
    await queueManager.initialize();

    jobScheduler = new JobScheduler(queueManager, configWithFile);
  });

  afterEach(async () => {
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

  

  describe('JobScheduler', () => {
    it('should initialize and schedule jobs', async () => {
      await jobScheduler.initialize();

      const jobPayload: JobPayload = {
        jobFile: './tests/fixtures/SimpleTestJob.ts',
        jobPayload: { message: 'scheduler test' }
      };

      const jobId = await jobScheduler.schedule(jobPayload);
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
        jobFile: './tests/fixtures/SimpleTestJob.ts',
        jobPayload: { message: 'immediate test' }
      };

      const result = await jobScheduler.executeJobAndWait(jobPayload);
      
      expect(result).toBeDefined();
      expect(result.results.success).toBe(true);
      expect(result.results.data.message).toBe('pong');
    });

    it('should handle multiple concurrent jobs', async () => {
      await jobScheduler.initialize();

      const promises = [];
      for (let i = 0; i < 3; i++) {
        const jobPayload: JobPayload = {
          jobFile: './tests/fixtures/SimpleTestJob.ts',
          jobPayload: {
            operation: 'multiply',
            numbers: [2, 3, 4],
            jobIndex: i // Make each job unique
          }
        };
        promises.push(jobScheduler.executeJobAndWait(jobPayload));
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
        jobFile: './tests/fixtures/SimpleTestJob.ts',
        jobPayload: { message: 'event test' }
      };

      await jobScheduler.executeJobAndWait(jobPayload);

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
        jobFile: './tests/fixtures/SimpleTestJob.ts',
        jobPayload: { message: 'idle test' }
      };

      // Schedule a job and check it's not idle
      const resultPromise = jobScheduler.executeJobAndWait(jobPayload);
      
      // Should become idle again after job completes
      await resultPromise;
      
      // Wait for scheduler to report idle state
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(async () => {
          const isIdle = await jobScheduler.isIdle();
          const stats = await jobScheduler.getStats();
          console.log(`Scheduler idle check after timeout: ${isIdle}`);
          console.log(`Scheduler stats:`, stats);
          reject(new Error(`Scheduler did not become idle within timeout. Current idle state: ${isIdle}`));
        }, 1000);
        
        const onIdle = async () => {
          clearTimeout(timeout);
          resolve(true);
        };
        
        jobScheduler.on("scheduler-idle", onIdle);
        
        // Also check periodically in case the event was missed
        const checkInterval = setInterval(async () => {
          const isIdle = await jobScheduler.isIdle();
          const stats = await jobScheduler.getStats();
          console.log(`Scheduler idle check: ${isIdle}`);
          console.log(`Scheduler stats:`, stats);
          if (isIdle) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            jobScheduler.off("scheduler-idle", onIdle);
            resolve(true);
          }
        }, 50);
      });
      
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
