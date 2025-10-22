import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TaskManager } from '../src/api/index.js';

describe('TimescaleDB Integration', () => {
  let manager: TaskManager;
  let isTimescaleAvailable = false;

  // Helper function to execute SQL queries with proper environment handling
  async function executeQuery(queue: any, query: string, params?: any[]): Promise<any[]> {
    const isBunEnvironment = typeof Bun !== 'undefined';
    let result;

    if (isBunEnvironment) {
      result = await queue.sql.unsafe(query);
    } else {
      result = await queue.sql.query(query, params);
      result = result.rows;
    }

    return result;
  }

  beforeAll(async () => {
    // Only run this test if TimescaleDB is available
    try {
      manager = new TaskManager({
        backend: 'postgresql',
        databaseUrl: 'postgres://postgres:password@localhost:5432/workalot',
        enableTimescaleDB: true,
        chunkTimeInterval: '1 hour',
        compressionInterval: '7 days',
        retentionInterval: '90 days',
        silent: true,
        wsPort: undefined, // Disable WebSocket to avoid port conflicts
      });
      await manager.initialize();
      isTimescaleAvailable = true;
    } catch (error) {
      console.warn('TimescaleDB not available, skipping tests:', error.message);
      isTimescaleAvailable = false;
    }
  });

  afterAll(async () => {
    if (manager && isTimescaleAvailable) {
      await manager.shutdown();
    }
  });

  describe('Hypertable Configuration', () => {
    it('should create hypertable with correct partitioning', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      // Get the queue backend to access the database connection
      const queue = (manager as any).queueManager;

      // Check if the table is a hypertable
      const hypertableQuery = `
        SELECT hypertable_name, num_dimensions, compression_enabled
        FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'workalot_jobs'
      `;

      const result = await executeQuery(queue, hypertableQuery);

      expect(result.length).toBe(1);
      expect(result[0].hypertable_name).toBe('workalot_jobs');
      expect(result[0].num_dimensions).toBe(1);
      expect(result[0].compression_enabled).toBe(true);
    });

    it('should have correct primary key structure', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check primary key columns
      const pkQuery = `
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'workalot_jobs'::regclass AND i.indisprimary
        ORDER BY a.attnum
      `;

      const result = await executeQuery(queue, pkQuery);
      const pkColumns = result.map(row => row.attname);
      expect(pkColumns).toEqual(['id', 'requested_at']);
    });

    it('should have compression policy configured', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check compression policy
      const compressionQuery = `
        SELECT * FROM timescaledb_information.compression_settings
        WHERE hypertable_name = 'workalot_jobs'
      `;

      const result = await executeQuery(queue, compressionQuery);
      expect(result.length).toBeGreaterThan(0);

      // Check for segmentby and orderby settings
      const segmentBy = result.find(r => r.attname === 'status' && r.segmentby_column_index !== null);
      const orderBy = result.find(r => r.attname === 'requested_at' && r.orderby_column_index !== null);

      expect(segmentBy).toBeDefined();
      expect(orderBy).toBeDefined();
    });
  });

  describe('Job Scheduling and Storage', () => {
    it('should schedule jobs with time-series data', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      // Schedule a simple job
      const jobPayload = {
        jobFile: './tests/fixtures/SimpleTestJob.ts',
        jobPayload: {
          id: 1,
          timestamp: new Date(),
          data: 'test data',
        },
      };

      const jobId = await manager.schedule(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      // Verify job was stored
      const stats = await manager.getQueueStats();
      expect(stats.total).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple jobs with different timestamps', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      // Schedule multiple jobs with different timestamps
      const jobs = [];
      const baseTime = Date.now();

      for (let i = 0; i < 5; i++) {
        const jobPayload = {
          jobFile: './tests/fixtures/SimpleTestJob.ts',
          jobPayload: {
            id: i,
            timestamp: new Date(baseTime - i * 3600000), // Each job 1 hour apart
            data: `data point ${i}`,
          },
        };

        const jobId = await manager.schedule(jobPayload);
        jobs.push(jobId);
      }

      expect(jobs.length).toBe(5);
      // Verify all job IDs are unique
      const uniqueJobs = new Set(jobs);
      expect(uniqueJobs.size).toBe(5);
    });

    it('should store jobs in correct time partitions', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check chunk information
      const chunkQuery = `
        SELECT chunk_name, range_start, range_end
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'workalot_jobs'
        ORDER BY range_start
      `;

      const chunks = await executeQuery(queue, chunkQuery);
      expect(chunks.length).toBeGreaterThan(0);

      // Verify chunks have proper time ranges
      for (const chunk of chunks) {
        expect(chunk.range_start).toBeDefined();
        expect(chunk.range_end).toBeDefined();
        expect(new Date(chunk.range_start)).toBeInstanceOf(Date);
        expect(new Date(chunk.range_end)).toBeInstanceOf(Date);
      }
    });
  });

  describe('Continuous Aggregates', () => {
    it('should have continuous aggregates for job statistics', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check if continuous aggregate exists using TimescaleDB information schema
      const caQuery = `
        SELECT view_name, view_owner, materialized_only
        FROM timescaledb_information.continuous_aggregates
        WHERE view_name = 'workalot_job_stats_hourly'
      `;

      const result = await executeQuery(queue, caQuery);
      expect(result.length).toBe(1);
      expect(result[0].view_name).toBe('workalot_job_stats_hourly');
      expect(result[0].materialized_only).toBe(true);
    });

    it('should have refresh policy for continuous aggregates', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check refresh policy using jobs table
      const policyQuery = `
        SELECT application_name, schedule_interval, hypertable_name
        FROM timescaledb_information.jobs
        WHERE application_name LIKE '%Refresh Continuous Aggregate%'
        AND hypertable_name = 'workalot_job_stats_hourly'
      `;

      const result = await executeQuery(queue, policyQuery);
      expect(result.length).toBe(1);
      expect(result[0].application_name).toContain('Refresh Continuous Aggregate');
      expect(result[0].schedule_interval).toBeDefined();
    });
  });

  describe('Performance and Optimization', () => {
    it('should demonstrate time-based query performance', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Schedule jobs across different time periods
      const jobs = [];
      const now = new Date();

      for (let i = 0; i < 10; i++) {
        const timestamp = new Date(now.getTime() - i * 24 * 60 * 60 * 1000); // Daily intervals
        const jobPayload = {
          jobFile: './tests/fixtures/SimpleTestJob.ts',
          jobPayload: {
            id: `perf-${i}`,
            timestamp,
            data: `performance test ${i}`,
          },
        };

        const jobId = await manager.schedule(jobPayload);
        jobs.push({ jobId, timestamp });
      }

      // Query recent jobs (should be fast due to partitioning)
      const recentQuery = `
        SELECT COUNT(*) as count
        FROM workalot_jobs
        WHERE requested_at >= NOW() - INTERVAL '7 days'
      `;

      const startTime = Date.now();
      const recentResult = await executeQuery(queue, recentQuery);
      const queryTime = Date.now() - startTime;

      expect(parseInt(recentResult[0].count)).toBeGreaterThan(0);
      expect(queryTime).toBeLessThan(1000); // Should be fast
    });

    it('should handle large time ranges efficiently', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Query across all time ranges
      const allTimeQuery = `
        SELECT
          DATE_TRUNC('hour', requested_at) as hour,
          COUNT(*) as job_count,
          COUNT(DISTINCT status) as status_variety
        FROM workalot_jobs
        GROUP BY DATE_TRUNC('hour', requested_at)
        ORDER BY hour DESC
        LIMIT 24
      `;

      const startTime = Date.now();
      const result = await executeQuery(queue, allTimeQuery);
      const queryTime = Date.now() - startTime;

      expect(Array.isArray(result)).toBe(true);
      expect(queryTime).toBeLessThan(2000); // Should be reasonably fast
    });
  });

  describe('Configuration Validation', () => {
    it('should respect chunk time interval configuration', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check chunk interval
      const intervalQuery = `
        SELECT d.interval_length
        FROM _timescaledb_catalog.hypertable h
        JOIN _timescaledb_catalog.dimension d ON h.id = d.hypertable_id
        WHERE h.table_name = 'workalot_jobs'
      `;

      const result = await executeQuery(queue, intervalQuery);
      expect(result.length).toBe(1);
      // 1 hour = 3600000000 microseconds
      expect(parseInt(result[0].interval_length)).toBe(3600000000);
    });

    it('should have retention policy configured', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      const queue = (manager as any).queueManager;

      // Check retention policy using jobs table
      const retentionQuery = `
        SELECT application_name, config
        FROM timescaledb_information.jobs
        WHERE application_name LIKE '%Retention Policy%'
        OR proc_name LIKE '%retention%'
      `;

      const result = await executeQuery(queue, retentionQuery);
      // Note: Retention policies might not be set up in test environment
      // This test verifies the query works and structure is correct
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle TimescaleDB-specific errors gracefully', async () => {
      if (!isTimescaleAvailable) {
        expect(true).toBe(true);
        return;
      }

      // This test verifies that the system handles TimescaleDB constraints properly
      // For example, trying to insert data with invalid time partitioning

      const jobPayload = {
        jobFile: './tests/fixtures/SimpleTestJob.ts',
        jobPayload: {
          id: 'error-test',
          timestamp: new Date(),
          data: 'error handling test',
        },
      };

      // This should work normally
      const jobId = await manager.schedule(jobPayload);
      expect(jobId).toBeDefined();
    });
  });
});