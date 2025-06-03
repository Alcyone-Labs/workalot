import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'path';
import { JobLoader, JobExecutor, JobRegistry, JobLoadError, JobValidationError, JobTimeoutError } from '../src/jobs/index.js';
import { JobPayload } from '../src/types/index.js';

describe('Job System', () => {
  let jobLoader: JobLoader;
  let jobExecutor: JobExecutor;
  let jobRegistry: JobRegistry;
  const projectRoot = resolve(process.cwd());

  beforeEach(() => {
    jobLoader = new JobLoader(projectRoot);
    jobExecutor = new JobExecutor(projectRoot, 1000); // 1 second timeout for tests
    jobRegistry = new JobRegistry(projectRoot);
  });

  describe('JobLoader', () => {
    it('should load a valid job file', async () => {
      const job = await jobLoader.loadJob('examples/PingJob.ts');
      expect(job).toBeDefined();
      expect(typeof job.getJobId).toBe('function');
      expect(typeof job.run).toBe('function');
    });

    it('should cache loaded jobs', async () => {
      await jobLoader.loadJob('examples/PingJob.ts');
      const stats = jobLoader.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys.length).toBe(1);
    });

    it('should throw JobLoadError for non-existent file', async () => {
      await expect(jobLoader.loadJob('non-existent-job.ts'))
        .rejects.toThrow(JobLoadError);
    });

    it('should get job ID from loaded job', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { test: 'data' }
      };
      
      const jobId = await jobLoader.getJobId(jobPayload);
      expect(typeof jobId).toBe('string');
      expect(jobId).toHaveLength(40); // SHA1 hash length
    });

    it('should execute job successfully', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'test' }
      };
      
      const result = await jobLoader.executeJob(jobPayload);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data.message).toBe('pong');
    });
  });

  describe('JobExecutor', () => {
    it('should execute job with timing information', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'test' }
      };

      const context = {
        jobId: 'test-job-id',
        startTime: Date.now(),
        queueTime: 50,
        timeout: 1000
      };

      const result = await jobExecutor.executeJob(jobPayload, context);
      
      expect(result).toBeDefined();
      expect(result.results.success).toBe(true);
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.queueTime).toBe(50);
    });

    it('should execute math job with complex payload', async () => {
      const jobPayload: JobPayload = {
        jobFile: 'examples/MathJob.ts',
        jobPayload: {
          operation: 'add',
          numbers: [1, 2, 3, 4, 5]
        }
      };

      const context = {
        jobId: 'math-job-id',
        startTime: Date.now(),
        queueTime: 25,
        timeout: 1000
      };

      const result = await jobExecutor.executeJob(jobPayload, context);
      
      expect(result.results.success).toBe(true);
      expect(result.results.data.result).toBe(15);
      expect(result.results.data.operation).toBe('add');
    });

    it('should handle job timeout', async () => {
      // Create a job payload with very short timeout
      const jobPayload: JobPayload = {
        jobFile: 'examples/MathJob.ts',
        jobPayload: {
          operation: 'add',
          numbers: [1, 2, 3]
        },
        jobTimeout: 1 // 1ms timeout - should timeout
      };

      const context = {
        jobId: 'timeout-job-id',
        startTime: Date.now(),
        queueTime: 0,
        timeout: 1
      };

      await expect(jobExecutor.executeJob(jobPayload, context))
        .rejects.toThrow(JobTimeoutError);
    });

    it('should validate job files', async () => {
      const isValid = await jobExecutor.validateJob('examples/PingJob.ts');
      expect(isValid).toBe(true);

      const isInvalid = await jobExecutor.validateJob('non-existent.ts');
      expect(isInvalid).toBe(false);
    });

    it('should preload jobs', async () => {
      await jobExecutor.preloadJob('examples/PingJob.ts');
      const stats = jobExecutor.getCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should clear cache', async () => {
      await jobExecutor.preloadJob('examples/PingJob.ts');
      jobExecutor.clearCache();
      const stats = jobExecutor.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('JobRegistry', () => {
    it('should discover jobs in examples directory', async () => {
      const jobs = await jobRegistry.discoverJobs('examples');
      expect(jobs.length).toBeGreaterThan(0);

      const pingJob = jobs.find(job => job.name === 'PingJob');
      expect(pingJob).toBeDefined();
      expect(pingJob?.isValid).toBe(true);

      const mathJob = jobs.find(job => job.name === 'MathJob');
      expect(mathJob).toBeDefined();
      expect(mathJob?.isValid).toBe(true);
    });

    it('should get job info for specific job', async () => {
      const jobInfo = await jobRegistry.getJobInfo('examples/PingJob.ts');
      expect(jobInfo).toBeDefined();
      expect(jobInfo?.name).toBe('PingJob');
      expect(jobInfo?.isValid).toBe(true);
    });

    it('should list all valid jobs', async () => {
      await jobRegistry.discoverJobs('examples');
      const jobs = jobRegistry.listJobs();
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.every(job => job.isValid)).toBe(true);
    });

    it('should refresh job information', async () => {
      const jobInfo1 = await jobRegistry.getJobInfo('examples/PingJob.ts');
      const jobInfo2 = await jobRegistry.refreshJob('examples/PingJob.ts');

      expect(jobInfo1?.name).toBe(jobInfo2?.name);
      expect(jobInfo2?.isValid).toBe(true);
    });

    it('should clear cache', async () => {
      await jobRegistry.discoverJobs('examples');
      expect(jobRegistry.listJobs().length).toBeGreaterThan(0);

      jobRegistry.clearCache();
      expect(jobRegistry.listJobs().length).toBe(0);
    });
  });
});
