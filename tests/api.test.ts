import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlink } from 'fs/promises';
import { 
  TaskManager,
  TaskManagerSingleton,
  initializeTaskManager,
  scheduleNow,
  whenFree,
  removeWhenFreeCallback,
  scheduleJob,
  getStatus,
  isIdle,
  shutdown,
  isInitialized
} from '../src/api/index.js';
import { JobPayload } from '../src/types/index.js';

describe('API Layer', () => {
  let testPersistenceFile: string;

  beforeEach(async () => {
    testPersistenceFile = `test-api-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
    
    // Reset singleton for clean tests
    TaskManagerSingleton.reset();
  });

  afterEach(async () => {
    try {
      await shutdown();
    } catch (error) {
      // Ignore shutdown errors in tests
    }

    // Clean up test persistence file
    try {
      await unlink(testPersistenceFile);
    } catch (error) {
      // File might not exist, ignore
    }
  });

  describe('TaskManager Class', () => {
    let taskManager: TaskManager;

    beforeEach(async () => {
      taskManager = new TaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2,
        maxInMemoryAge: 1000,
        healthCheckInterval: 100
      });
      await taskManager.initialize();
    });

    afterEach(async () => {
      if (taskManager) {
        await taskManager.shutdown();
      }
    });

    it('should initialize successfully', async () => {
      const status = await taskManager.getStatus();
      expect(status.isInitialized).toBe(true);
      expect(status.isShuttingDown).toBe(false);
    });

    it('should execute jobs with scheduleNow', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'test' }
      };

      const result = await taskManager.scheduleNow(jobPayload);
      
      expect(result).toBeDefined();
      expect(result.results.success).toBe(true);
      expect(result.results.data.message).toBe('pong');
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should handle whenFree callbacks', async () => {
      let callbackCalled = false;
      
      taskManager.whenFree(() => {
        callbackCalled = true;
      });

      // Initially should be idle, so callback should be called immediately
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(callbackCalled).toBe(true);
    });

    it('should handle whenFree callbacks after job completion', async () => {
      const callbacks: string[] = [];
      
      taskManager.whenFree(() => {
        callbacks.push('callback1');
      });

      taskManager.whenFree(() => {
        callbacks.push('callback2');
      });

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'test' }
      };

      await taskManager.scheduleNow(jobPayload);

      // Wait for callbacks to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(callbacks).toContain('callback1');
      expect(callbacks).toContain('callback2');
    });

    it('should remove whenFree callbacks', async () => {
      let callbackCalled = false;
      
      const callback = () => {
        callbackCalled = true;
      };

      taskManager.whenFree(callback);
      const removed = taskManager.removeWhenFreeCallback(callback);
      
      expect(removed).toBe(true);
      
      // Wait a bit to ensure callback isn't called
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(callbackCalled).toBe(false);
    });

    it('should schedule jobs without waiting', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'fire and forget' }
      };

      const jobId = await taskManager.scheduleJob(jobPayload);
      
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
    });

    it('should provide status information', async () => {
      const status = await taskManager.getStatus();
      
      expect(status).toHaveProperty('isInitialized');
      expect(status).toHaveProperty('isShuttingDown');
      expect(status).toHaveProperty('queue');
      expect(status).toHaveProperty('workers');
      expect(status).toHaveProperty('scheduler');
      
      expect(status.isInitialized).toBe(true);
      expect(status.workers.total).toBeGreaterThan(0);
    });

    it('should report idle state correctly', async () => {
      expect(await taskManager.isIdle()).toBe(true);
    });

    it('should provide queue and worker statistics', async () => {
      const queueStats = await taskManager.getQueueStats();
      const workerStats = await taskManager.getWorkerStats();
      
      expect(queueStats).toHaveProperty('total');
      expect(queueStats).toHaveProperty('pending');
      expect(queueStats).toHaveProperty('completed');
      
      expect(workerStats).toHaveProperty('total');
      expect(workerStats).toHaveProperty('ready');
      expect(workerStats).toHaveProperty('available');
    });
  });

  describe('Singleton API Functions', () => {
    it('should initialize the singleton', async () => {
      expect(isInitialized()).toBe(false);
      
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2,
        maxInMemoryAge: 1000,
        healthCheckInterval: 100
      });
      
      expect(isInitialized()).toBe(true);
    });

    it('should execute jobs with scheduleNow function', async () => {
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2
      });

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'singleton test' }
      };

      const result = await scheduleNow(jobPayload);
      
      expect(result).toBeDefined();
      expect(result.results.success).toBe(true);
      expect(result.results.data.message).toBe('pong');
    });

    it('should handle whenFree function', async () => {
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2
      });

      let callbackCalled = false;
      
      whenFree(() => {
        callbackCalled = true;
      });

      // Wait for callback to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(callbackCalled).toBe(true);
    });

    it('should schedule jobs without waiting using function', async () => {
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2
      });

      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'function test' }
      };

      const jobId = await scheduleJob(jobPayload);
      
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
    });

    it('should provide status through functions', async () => {
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2
      });

      const status = await getStatus();
      
      expect(status.isInitialized).toBe(true);
      expect(status.workers.total).toBeGreaterThan(0);
      
      expect(await isIdle()).toBe(true);
    });

    it('should handle multiple whenFree callbacks', async () => {
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2
      });

      const callbacks: number[] = [];
      
      whenFree(() => callbacks.push(1));
      whenFree(() => callbacks.push(2));
      whenFree(() => callbacks.push(3));

      // Wait for callbacks to be processed
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(callbacks).toContain(1);
      expect(callbacks).toContain(2);
      expect(callbacks).toContain(3);
      expect(callbacks).toHaveLength(3);
    });

    it('should remove whenFree callbacks using function', async () => {
      await initializeTaskManager({
        persistenceFile: testPersistenceFile,
        maxThreads: 2
      });

      let callbackCalled = false;
      
      const callback = () => {
        callbackCalled = true;
      };

      whenFree(callback);
      const removed = removeWhenFreeCallback(callback);
      
      expect(removed).toBe(true);
      
      // Wait to ensure callback isn't called
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(callbackCalled).toBe(false);
    });

    it('should throw error when using functions before initialization', async () => {
      expect(() => {
        whenFree(() => {});
      }).toThrow('TaskManager must be initialized');

      await expect(scheduleNow({
        jobFile: 'examples/PingJob.ts',
        jobPayload: {}
      })).rejects.toThrow('TaskManager must be initialized');
    });
  });
});
