import { EventEmitter } from "node:events";
import {
  QueueItem,
  JobStatus,
  JobPayload,
  JobResult,
  QueueConfig,
} from "../types/index.js";
import { IQueueBackend, QueueStats } from "./IQueueBackend.js";
import { ulid } from "ulidx";

// Conditional import for Bun's SQL
let SQL: any;
if (typeof globalThis.Bun !== "undefined") {
  // @ts-ignore
  SQL = (await import("bun")).SQL;
}

export interface PostgreSQLQueueConfig extends QueueConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  tableName?: string;
  enableNotifications?: boolean;
  cleanupInterval?: number;
  retentionDays?: number;
}

/**
 * PostgreSQL-backed queue implementation with LISTEN/NOTIFY and row-level locking
 * Using Bun's native SQL support
 */
export class PostgreSQLQueue extends IQueueBackend {
  private sql: any;
  private eventEmitter = new EventEmitter();
  private tableName: string;
  private enableNotifications: boolean;
  private cleanupInterval?: NodeJS.Timeout;
  private retentionDays: number;
  private isInitialized = false;
  private notificationConnection: any | null = null;
  private connectionString: string;

  constructor(config: PostgreSQLQueueConfig) {
    super(config);
    this.tableName = config.tableName || "workalot_jobs";
    this.enableNotifications = config.enableNotifications !== false;
    this.retentionDays = config.retentionDays || 30;

    // Build connection string for PostgreSQL
    this.connectionString =
      config.connectionString ||
      `postgres://${config.user || "postgres"}:${config.password || ""}@${config.host || "localhost"}:${config.port || 5432}/${config.database || "workalot"}`;

    // Initialize Bun SQL connection
    this.sql = new SQL(this.connectionString);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create table and indexes
      await this.createSchema();

      // Set up LISTEN/NOTIFY if enabled
      if (this.enableNotifications) {
        await this.setupNotifications();
      }

      // Start cleanup interval
      if (this.config.maxInMemoryAge && this.config.maxInMemoryAge > 0) {
        this.cleanupInterval = setInterval(() => {
          this.cleanup().catch((err) => {
            console.error("Error during cleanup:", err);
          });
        }, this.config.maxInMemoryAge);
      }

      this.isInitialized = true;
      console.log("PostgreSQLQueue initialized successfully");
    } catch (error) {
      console.error("Failed to initialize PostgreSQLQueue:", error);
      throw error;
    }
  }

  private async createSchema(): Promise<void> {
    // Create extension for UUID generation if not exists
    await this.sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    // Create jobs table
    await this.sql`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id VARCHAR(26) PRIMARY KEY,
        payload JSONB NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        worker_id INTEGER,
        result JSONB,
        error TEXT,
        requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        priority INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `;

    // Create indexes for performance
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status
      ON ${this.tableName}(status)
      WHERE status IN ('pending', 'processing');
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_worker_id
      ON ${this.tableName}(worker_id)
      WHERE worker_id IS NOT NULL;
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_priority_requested
      ON ${this.tableName}(priority DESC, requested_at ASC)
      WHERE status = 'pending';
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_completed_at
      ON ${this.tableName}(completed_at)
      WHERE status IN ('completed', 'failed');
    `;

    // Create trigger for updating last_updated timestamp
    await this.sql`
      CREATE OR REPLACE FUNCTION update_last_updated_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.last_updated = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `;

    await this.sql`
      DROP TRIGGER IF EXISTS update_${this.tableName}_last_updated ON ${this.tableName};
      CREATE TRIGGER update_${this.tableName}_last_updated
      BEFORE UPDATE ON ${this.tableName}
      FOR EACH ROW EXECUTE FUNCTION update_last_updated_column();
    `;

    // Create notification trigger if enabled
    if (this.enableNotifications) {
      await this.sql`
        CREATE OR REPLACE FUNCTION notify_job_change()
        RETURNS TRIGGER AS $$
        DECLARE
          payload TEXT;
        BEGIN
          payload = json_build_object(
            'operation', TG_OP,
            'id', COALESCE(NEW.id, OLD.id),
            'status', COALESCE(NEW.status, OLD.status)
          )::text;

          PERFORM pg_notify('job_updates', payload);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `;

await this.sql`
      DROP TRIGGER IF EXISTS ${this.tableName}_notify ON ${this.tableName};
      CREATE TRIGGER ${this.tableName}_notify
      AFTER INSERT OR UPDATE OR DELETE ON ${this.tableName}
      FOR EACH ROW EXECUTE FUNCTION notify_job_change();
    `;
    }
  }

  private async setupNotifications(): Promise<void> {
    // Create a separate connection for LISTEN
    this.notificationConnection = new SQL(this.connectionString);

    // Listen for job updates - using unsafe since LISTEN is not a standard query
    await this.notificationConnection.unsafe("LISTEN job_updates");

    // Poll for notifications (pg doesn't have built-in notification support)
    setInterval(async () => {
      try {
        // In PostgreSQL, we need to check for notifications differently
        // This is a simplified approach - in practice, you'd use a dedicated listener
        console.log("Polling for notifications...");
      } catch (err) {
        // Ignore errors in notification polling
      }
    }, 100); // Poll every 100ms
  }

  async addJob(jobPayload: JobPayload, customId?: string): Promise<string> {
    const id = customId || ulid();

    await this.sql`
      INSERT INTO ${this.sql(this.tableName)} (id, payload, status, requested_at) VALUES (${id}, ${JSON.stringify(jobPayload)}, ${JobStatus.PENDING}, NOW())
    `;

    // Notify about new job if notifications are enabled
    if (this.enableNotifications) {
      this.eventEmitter.emit("job-added", { id, payload: jobPayload });
    }

    return id;
  }

  async getJob(id: string): Promise<QueueItem | undefined> {
    const result = await this.sql`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.sql(this.tableName)}
      WHERE id = ${id}
    `;

    if (result.length === 0) {
      return undefined;
    }

    return this.mapRowToQueueItem(result[0]);
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    result?: JobResult,
    error?: Error,
    workerId?: number,
  ): Promise<boolean> {
    let rowsAffected = 0;

    switch (status) {
      case JobStatus.PROCESSING:
        const processing = await this.sql`
          UPDATE ${this.sql(this.tableName)}
          SET status = ${status}, worker_id = ${workerId}, started_at = NOW()
          WHERE id = ${id} AND status = 'pending'
          RETURNING id
        `;
        rowsAffected = processing.length;
        break;

      case JobStatus.COMPLETED:
        const completed = await this.sql`
          UPDATE ${this.sql(this.tableName)}
          SET status = ${status}, result = ${result ? JSON.stringify(result) : null}, completed_at = NOW()
          WHERE id = ${id}
          RETURNING id
        `;
        rowsAffected = completed.length;
        break;

      case JobStatus.FAILED:
        const failed = await this.sql`
          UPDATE ${this.sql(this.tableName)}
          SET status = ${status}, error = ${error?.message || null}, completed_at = NOW()
          WHERE id = ${id}
          RETURNING id
        `;
        rowsAffected = failed.length;
        break;

      default:
        const updated = await this.sql`
          UPDATE ${this.sql(this.tableName)}
          SET status = ${status}
          WHERE id = ${id}
          RETURNING id
        `;
        rowsAffected = updated.length;
    }

    return rowsAffected > 0;
  }

  async getNextPendingJob(): Promise<QueueItem | undefined> {
    let job: any = null;

    // Use FOR UPDATE SKIP LOCKED for atomic job fetching
    const rows = await this.sql`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.sql(this.tableName)}
      WHERE status = 'pending'
      ORDER BY priority DESC, requested_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    if (rows.length > 0) {
      job = rows[0];

      // Mark as processing
      await this.sql`
        UPDATE ${this.sql(this.tableName)}
        SET status = 'processing'
        WHERE id = ${job.id}
      `;
    }

    return job ? this.mapRowToQueueItem(job) : undefined;
  }

  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    const result = await this.sql`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.sql(this.tableName)}
      WHERE status = ${status}
      ORDER BY requested_at DESC
      LIMIT 1000
    `;

    return result.map((row: any) => this.mapRowToQueueItem(row));
  }

  async getStats(): Promise<QueueStats> {
    const result = await this.sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM ${this.sql(this.tableName)}
    `;

    const row = result[0];
    return {
      total: parseInt(row.total),
      pending: parseInt(row.pending),
      processing: parseInt(row.processing),
      completed: parseInt(row.completed),
      failed: parseInt(row.failed),
    };
  }

  async hasPendingJobs(): Promise<boolean> {
    const result = await this.sql`
      SELECT EXISTS (
        SELECT 1 FROM ${this.sql(this.tableName)}
        WHERE status = 'pending'
        LIMIT 1
      ) as has_pending
    `;

    return result[0].has_pending;
  }

  async hasProcessingJobs(): Promise<boolean> {
    const result = await this.sql`
      SELECT EXISTS (
        SELECT 1 FROM ${this.sql(this.tableName)}
        WHERE status = 'processing'
        LIMIT 1
      ) as has_processing
    `;

    return result[0].has_processing;
  }

  async isEmpty(): Promise<boolean> {
    const result = await this.sql`
      SELECT NOT EXISTS (
        SELECT 1 FROM ${this.sql(this.tableName)}
        WHERE status IN ('pending', 'processing')
        LIMIT 1
      ) as is_empty
    `;

    return result[0].is_empty;
  }

  async recoverStalledJobs(stalledTimeoutMs: number = 300000): Promise<number> {
    const result = await this.sql`
      UPDATE ${this.sql(this.tableName)}
      SET
        status = 'pending',
        worker_id = NULL,
        retry_count = retry_count + 1
      WHERE
        status = 'processing'
        AND last_updated < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
        AND retry_count < max_retries
      RETURNING id
    `;

    const rowCount = result.length;

    if (rowCount > 0 && this.enableNotifications) {
      this.eventEmitter.emit("jobs-recovered", {
        count: rowCount,
        jobIds: result.map((r: any) => r.id),
      });
    }

    return rowCount;
  }

  async getStalledJobs(
    stalledTimeoutMs: number = 300000,
  ): Promise<QueueItem[]> {
    const result = await this.sql`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.sql(this.tableName)}
      WHERE
        status = 'processing'
        AND last_updated < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
      ORDER BY last_updated ASC
    `;

    return result.map((row: any) => this.mapRowToQueueItem(row));
  }

  async cleanup(): Promise<number> {
    const rows = await this.sql`
      DELETE FROM ${this.sql(this.tableName)}
      WHERE
        status IN ('completed', 'failed')
        AND completed_at < NOW() - INTERVAL '${this.retentionDays} days'
      RETURNING id
    `;

    const rowCount = rows ? rows.length : 0;

    if (rowCount > 0) {
      console.log(`Cleaned up ${rowCount} old jobs`);
    }

    return rowCount;
  }

  async shutdown(): Promise<void> {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Close notification connection
    if (this.notificationConnection) {
      try {
        await this.notificationConnection.unsafe("UNLISTEN job_updates");
        // Bun SQL connections don't need explicit closing
        this.notificationConnection = null;
      } catch (err) {
        console.error("Error closing notification connection:", err);
      }
    }

    // Close main connection
    if (this.sql) {
      this.sql.close();
    }

    this.isInitialized = false;
    console.log("PostgreSQLQueue shutdown complete");
  }

  /**
   * Batch add jobs for better performance
   */
  async batchAddJobs(
    jobs: Array<{ payload: JobPayload; customId?: string }>,
  ): Promise<string[]> {
    const ids: string[] = [];

    for (const job of jobs) {
      const id = job.customId || ulid();
      ids.push(id);

      await this.sql`
        INSERT INTO ${this.sql(this.tableName)} (id, payload, status, requested_at)
        VALUES (${id}, ${JSON.stringify(job.payload)}, ${JobStatus.PENDING}, NOW())
      `;
    }

    return ids;
  }

  /**
   * Get jobs for a specific worker
   */
  async getJobsByWorker(workerId: number): Promise<QueueItem[]> {
    const rows = await this.sql`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.sql(this.tableName)}
      WHERE worker_id = ${workerId}
      ORDER BY last_updated DESC
      LIMIT 100
    `;

    return rows.map((row: any) => this.mapRowToQueueItem(row));
  }

  /**
   * Update job priority
   */
  async updateJobPriority(jobId: string, priority: number): Promise<boolean> {
    const rows = await this.sql`
      UPDATE ${this.sql(this.tableName)}
      SET priority = ${priority}
      WHERE id = ${jobId} AND status = 'pending'
      RETURNING id
    `;

    return rows && rows.length > 0;
  }

  /**
   * Subscribe to job events
   */
  onJobUpdate(callback: (event: any) => void): void {
    this.eventEmitter.on("job-update", callback);
  }

  /**
   * Unsubscribe from job events
   */
  offJobUpdate(callback: (event: any) => void): void {
    this.eventEmitter.off("job-update", callback);
  }

  private mapRowToQueueItem(row: any): QueueItem {
    return {
      id: row.id,
      jobPayload:
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      status: row.status as JobStatus,
      lastUpdated: new Date(row.last_updated),
      requestedAt: new Date(row.requested_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      result: row.result
        ? typeof row.result === "string"
          ? JSON.parse(row.result)
          : row.result
        : undefined,
      error: row.error ? new Error(row.error) : undefined,
      workerId: row.worker_id,
    };
  }
}
