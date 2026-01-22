import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueueOrchestrator } from '../src/workers/QueueOrchestrator.js';
import { QueueManager } from '../src/queue/QueueManager.js';
import { getTempTsonFile } from './test-utils.js';

describe('QueueOrchestrator', () => {
  let orchestrator: QueueOrchestrator;
  let queueManager: QueueManager;
  let persistenceFile: string;

  beforeEach(async () => {
    persistenceFile = getTempTsonFile('orch');

    queueManager = new QueueManager({
      persistenceFile,
      maxInMemoryAge: 1000,
      healthCheckInterval: 100,
    });
    await queueManager.initialize();

    orchestrator = new QueueOrchestrator();
  });

  afterEach(async () => {
    try {
      orchestrator.stop();
    } catch { }
    try {
      await queueManager.shutdown();
    } catch { }
  });

  describe('Lifecycle', () => {
    it('should start and stop correctly', () => {
      orchestrator.start();
      orchestrator.stop();
    });

    it('should emit events on start and stop', async () => {
      let started = false;
      let stopped = false;

      orchestrator.on('orchestrator-started', () => { started = true; });
      orchestrator.on('orchestrator-stopped', () => { stopped = true; });

      orchestrator.start();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(started).toBe(true);

      orchestrator.stop();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(stopped).toBe(true);
    });
  });

  describe('Worker Registration', () => {
    it('should register workers', () => {
      orchestrator.start();
      orchestrator.registerWorker(1);
      orchestrator.registerWorker(2);

      const stats = orchestrator.getStats();
      expect(stats.totalWorkers).toBe(2);
    });

    it('should unregister workers', () => {
      orchestrator.start();
      orchestrator.registerWorker(1);
      orchestrator.unregisterWorker(1);

      const stats = orchestrator.getStats();
      expect(stats.totalWorkers).toBe(0);
    });

    it('should emit events on worker registration', () => {
      orchestrator.start();
      let workerRegistered = false;
      orchestrator.on('worker-registered', () => { workerRegistered = true; });
      orchestrator.registerWorker(1);
      expect(workerRegistered).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics', () => {
      orchestrator.start();
      const stats = orchestrator.getStats();

      expect(stats).toHaveProperty('totalWorkers');
      expect(stats).toHaveProperty('activeWorkers');
      expect(stats).toHaveProperty('totalPendingJobs');
      expect(stats).toHaveProperty('totalProcessingJobs');
      expect(stats).toHaveProperty('totalCompletedJobs');
    });

    it('should track workers correctly', () => {
      orchestrator.start();
      orchestrator.registerWorker(1);
      orchestrator.registerWorker(2);

      const stats = orchestrator.getStats();
      expect(stats.totalWorkers).toBe(2);
    });
  });

  describe('Job Distribution', () => {
    it('should handle job results', () => {
      orchestrator.start();
      orchestrator.registerWorker(1);

      let jobResult = false;
      orchestrator.on('job-result', () => { jobResult = true; });

      orchestrator.handleJobResult(1, {
        workerId: 1,
        jobId: 'test-job',
        result: { results: { success: true }, executionTime: 100, queueTime: 50 },
        processingTime: 100,
      });

      expect(jobResult).toBe(true);
    });

    it('should acknowledge jobs', () => {
      orchestrator.start();
      orchestrator.registerWorker(1);

      let jobAck = false;
      orchestrator.on('job-acknowledged', () => { jobAck = true; });

      orchestrator.acknowledgeJob(1, 'test-job', () => {});
      expect(jobAck).toBe(true);
    });
  });
});

describe('QueueOrchestrator Integration', () => {
  let queueManager: QueueManager;
  let persistenceFile: string;

  beforeEach(async () => {
    persistenceFile = getTempTsonFile('orch-int');
    queueManager = new QueueManager({
      persistenceFile,
      maxInMemoryAge: 1000,
      healthCheckInterval: 100,
    });
    await queueManager.initialize();
  });

  afterEach(async () => {
    try {
      await queueManager.shutdown();
    } catch { }
  });

  it('should handle multiple workers registering and unregistering', () => {
    const orchestrator = new QueueOrchestrator();

    orchestrator.start();
    orchestrator.registerWorker(1);
    orchestrator.registerWorker(2);
    orchestrator.registerWorker(3);
    orchestrator.registerWorker(4);

    expect(orchestrator.getStats().totalWorkers).toBe(4);

    orchestrator.unregisterWorker(1);
    orchestrator.unregisterWorker(2);

    expect(orchestrator.getStats().totalWorkers).toBe(2);
    orchestrator.stop();
  });

  it('should track completed jobs correctly', () => {
    const orchestrator = new QueueOrchestrator();

    orchestrator.start();
    orchestrator.registerWorker(1);

    const initialStats = orchestrator.getStats();
    expect(initialStats.totalCompletedJobs).toBe(0);

    orchestrator.handleJobResult(1, {
      workerId: 1,
      jobId: 'job-1',
      result: { results: { success: true }, executionTime: 100, queueTime: 50 },
      processingTime: 100,
    });

    const afterResultStats = orchestrator.getStats();
    expect(afterResultStats.totalCompletedJobs).toBe(1);
    orchestrator.stop();
  });
});
