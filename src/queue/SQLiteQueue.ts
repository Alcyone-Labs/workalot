import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import { QueueItem, JobStatus, JobPayload, JobResult, QueueConfig } from '../types/index.js';
import { IQueueBackend, QueueStats } from './IQueueBackend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Runtime detection for database client
let Database: any;
let isBun = false;

// Initialize database driver
async function initializeDatabase() {
  if (Database) return; // Already initialized

  try {
    // Try Bun's native SQLite first
    if (typeof (globalThis as any).Bun !== 'undefined') {
      Database = (await import('bun:sqlite' as any)).Database;
      isBun = true;
    } else {
      // Fall back to better-sqlite3 for Node.js
      Database = (await import('better-sqlite3')).default;
    }
  } catch {
    throw new Error('No SQLite driver available. Install better-sqlite3 for Node.js or use Bun runtime.');
  }
}

export interface SQLiteQueueConfig extends QueueConfig {
  /**
   * Database connection string or path
   * Examples:
   * - 'memory://' for in-memory database
   * - './data/queue.db' for file-based database
   */
  databaseUrl?: string;
  
  /**
   * Enable debug logging for database operations
   */
  debug?: boolean;
  
  /**
   * Custom migration directory path
   */
  migrationsPath?: string;
  
  /**
   * Auto-run migrations on initialization
   */
  autoMigrate?: boolean;
  
  /**
   * Enable WAL mode for better performance
   */
  enableWAL?: boolean;
}

/**
 * SQLite-based queue backend with high performance
 * Supports both Bun's native SQLite and better-sqlite3 for Node.js
 */
export class SQLiteQueue extends IQueueBackend {
  private db: any = null;
  protected declare config: Required<SQLiteQueueConfig>;
  private isInitialized = false;
  private isShuttingDown = false;

  constructor(config: SQLiteQueueConfig = {}) {
    super(config);

    this.config = {
      ...this.getConfig(),
      databaseUrl: config.databaseUrl || 'memory://',
      debug: config.debug || false,
      migrationsPath: config.migrationsPath || join(__dirname, 'migrations', 'sqlite'),
      autoMigrate: config.autoMigrate !== false, // Default to true
      enableWAL: config.enableWAL !== false, // Default to true
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize the database driver
      await initializeDatabase();

      if (this.config.debug) {
        console.log('Creating SQLite instance...');
      }

      // Handle memory:// URL format
      const dbPath = this.config.databaseUrl === 'memory://'
        ? (isBun ? ':memory:' : ':memory:')
        : this.config.databaseUrl;

      if (isBun) {
        this.db = new Database(dbPath, { 
          create: true,
          strict: true 
        });
      } else {
        this.db = new Database(dbPath);
      }

      if (this.config.debug) {
        console.log('SQLite instance created successfully');
      }

      // Enable WAL mode for better performance
      if (this.config.enableWAL && this.config.databaseUrl !== 'memory://') {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
        this.db.exec('PRAGMA cache_size = 1000;');
        this.db.exec('PRAGMA temp_store = memory;');
      }

      // Run migrations if enabled
      if (this.config.autoMigrate) {
        await this.runMigrations();
      }

      this.isInitialized = true;
      this.emit('ready');

      if (this.config.debug) {
        console.log('SQLite queue initialized successfully');
      }
    } catch (error) {
      console.error('Failed to initialize SQLite queue:', error);
      throw error;
    }
  }

  private async runMigrations(): Promise<void> {
    try {
      const migrationFile = join(this.config.migrationsPath, '001_initial_schema.sql');
      const migrationSQL = await readFile(migrationFile, 'utf-8');
      
      // Execute migration in a transaction
      if (isBun) {
        const transaction = this.db.transaction(() => {
          this.db.exec(migrationSQL);
        });
        transaction();
      } else {
        this.db.exec(migrationSQL);
      }

      if (this.config.debug) {
        console.log('SQLite migrations completed successfully');
      }
    } catch (error) {
      if (this.config.debug) {
        console.log('Migration may have already been applied:', error);
      }
      // Migrations might already be applied, which is fine
    }
  }

  private generateJobId(): string {
    return ulid();
  }

  async addJob(jobPayload: JobPayload, customId?: string): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down, cannot add new jobs');
    }

    const id = customId || this.generateJobId();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO jobs (id, job_payload, status, requested_at)
        VALUES (?, ?, ?, datetime('now'))
      `);
      
      if (isBun) {
        stmt.run(id, JSON.stringify(jobPayload), JobStatus.PENDING);
      } else {
        stmt.run(id, JSON.stringify(jobPayload), JobStatus.PENDING);
      }

      return id;
    } catch (error: any) {
      if (error.message && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Job with ID ${id} already exists in queue`);
      }
      throw new Error(`Failed to add job: ${error.message || String(error)}`);
    }
  }

  async getJob(id: string): Promise<QueueItem | undefined> {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = isBun ? stmt.get(id) : stmt.get(id);

    if (!row) {
      return undefined;
    }

    return this.mapRowToQueueItem(row);
  }

  private mapRowToQueueItem(row: any): QueueItem {
    return {
      id: row.id,
      jobPayload: JSON.parse(row.job_payload),
      status: row.status as JobStatus,
      requestedAt: new Date(row.requested_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      lastUpdated: new Date(row.last_updated),
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error_message ? new Error(row.error_message) : undefined,
      workerId: row.worker_id,
    };
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    result?: JobResult,
    error?: Error,
    workerId?: number
  ): Promise<boolean> {
    try {
      let sql = 'UPDATE jobs SET status = ?, last_updated = datetime(\'now\')';
      const params: any[] = [status];

      if (status === JobStatus.PROCESSING) {
        sql += ', started_at = datetime(\'now\')';
        if (workerId !== undefined) {
          sql += ', worker_id = ?';
          params.push(workerId);
        }
      } else if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
        // Ensure started_at is set if not already (for CHECK constraint compliance)
        sql += ', started_at = COALESCE(started_at, datetime(\'now\')), completed_at = datetime(\'now\')';
        if (result) {
          sql += ', result = ?';
          params.push(JSON.stringify(result));
        }
        if (error) {
          sql += ', error_message = ?, error_stack = ?';
          params.push(error.message, error.stack || '');
        }
      }

      sql += ' WHERE id = ?';
      params.push(id);

      const stmt = this.db.prepare(sql);
      const result_info = isBun ? stmt.run(...params) : stmt.run(...params);
      
      return (result_info.changes || 0) > 0;
    } catch (error) {
      throw new Error(`Failed to update job status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getNextPendingJob(): Promise<QueueItem | undefined> {
    try {
      // Use a transaction to atomically claim the job
      const transaction = isBun ? this.db.transaction(() => {
        // Get the next pending job
        const selectStmt = this.db.prepare(`
          SELECT * FROM jobs 
          WHERE status = 'pending' 
            AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
          ORDER BY priority DESC, requested_at ASC 
          LIMIT 1
        `);
        
        const row = selectStmt.get();
        if (!row) {
          return undefined;
        }

        // Update it to processing
        const updateStmt = this.db.prepare(`
          UPDATE jobs 
          SET status = 'processing', started_at = datetime('now')
          WHERE id = ? AND status = 'pending'
        `);
        
        const updateResult = updateStmt.run(row.id);
        if (updateResult.changes === 0) {
          return undefined; // Job was claimed by another worker
        }

        return row;
      }) : () => {
        // For better-sqlite3, we need to handle this differently
        const selectStmt = this.db.prepare(`
          SELECT * FROM jobs 
          WHERE status = 'pending' 
            AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
          ORDER BY priority DESC, requested_at ASC 
          LIMIT 1
        `);
        
        const row = selectStmt.get();
        if (!row) {
          return undefined;
        }

        const updateStmt = this.db.prepare(`
          UPDATE jobs 
          SET status = 'processing', started_at = datetime('now')
          WHERE id = ? AND status = 'pending'
        `);
        
        const updateResult = updateStmt.run(row.id);
        if (updateResult.changes === 0) {
          return undefined;
        }

        return row;
      };

      const row = transaction();
      if (!row) {
        return undefined;
      }

      // Update the row to reflect the new status
      row.status = JobStatus.PROCESSING;
      row.started_at = new Date().toISOString();
      
      return this.mapRowToQueueItem(row);
    } catch (error) {
      throw new Error(`Failed to get next pending job: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY requested_at ASC');
    const rows = isBun ? stmt.all(status) : stmt.all(status);

    return rows.map((row: any) => this.mapRowToQueueItem(row));
  }

  async getStats(): Promise<QueueStats> {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        MIN(CASE WHEN status = 'pending' THEN requested_at ELSE NULL END) as oldest_pending
      FROM jobs
    `);

    const row = isBun ? stmt.get() : stmt.get();

    return {
      total: row.total || 0,
      pending: row.pending || 0,
      processing: row.processing || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
      oldestPending: row.oldest_pending ? new Date(row.oldest_pending) : undefined,
    };
  }

  async cleanup(): Promise<number> {
    const cutoffTime = new Date(Date.now() - this.config.maxInMemoryAge).toISOString();

    const stmt = this.db.prepare(`
      DELETE FROM jobs
      WHERE status IN ('completed', 'failed')
        AND completed_at < ?
    `);

    const result = isBun ? stmt.run(cutoffTime) : stmt.run(cutoffTime);
    return result.changes || 0;
  }

  async hasPendingJobs(): Promise<boolean> {
    const stmt = this.db.prepare('SELECT 1 FROM jobs WHERE status = ? LIMIT 1');
    const row = isBun ? stmt.get(JobStatus.PENDING) : stmt.get(JobStatus.PENDING);
    return !!row;
  }

  async hasProcessingJobs(): Promise<boolean> {
    const stmt = this.db.prepare('SELECT 1 FROM jobs WHERE status = ? LIMIT 1');
    const row = isBun ? stmt.get(JobStatus.PROCESSING) : stmt.get(JobStatus.PROCESSING);
    return !!row;
  }

  async isEmpty(): Promise<boolean> {
    const stmt = this.db.prepare('SELECT 1 FROM jobs LIMIT 1');
    const row = isBun ? stmt.get() : stmt.get();
    return !row;
  }

  async recoverStalledJobs(stalledTimeoutMs: number = 300000): Promise<number> {
    const stalledJobs = await this.getStalledJobs(stalledTimeoutMs);

    if (stalledJobs.length === 0) {
      return 0;
    }

    // Calculate the cutoff time in milliseconds since epoch
    const cutoffTime = Date.now() - stalledTimeoutMs;
    const cutoffDate = new Date(cutoffTime).toISOString();

    // Use a transaction to atomically recover all stalled jobs
    const transaction = isBun ? this.db.transaction(() => {
      const updateStmt = this.db.prepare(`
        UPDATE jobs
        SET status = 'pending', started_at = NULL, worker_id = NULL
        WHERE status = 'processing'
          AND started_at < ?
      `);

      const result = updateStmt.run(cutoffDate);
      return result.changes || 0;
    }) : () => {
      const updateStmt = this.db.prepare(`
        UPDATE jobs
        SET status = 'pending', started_at = NULL, worker_id = NULL
        WHERE status = 'processing'
          AND started_at < ?
      `);

      const result = updateStmt.run(cutoffDate);
      return result.changes || 0;
    };

    const recoveredCount = transaction();

    if (recoveredCount > 0) {
      console.log(`Recovered ${recoveredCount} stalled jobs`);
    }

    return recoveredCount;
  }

  async getStalledJobs(stalledTimeoutMs: number = 300000): Promise<QueueItem[]> {
    // Calculate the cutoff time in milliseconds since epoch
    const cutoffTime = Date.now() - stalledTimeoutMs;
    const cutoffDate = new Date(cutoffTime).toISOString();

    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'processing'
        AND started_at < ?
      ORDER BY started_at ASC
    `);

    const rows = isBun ? stmt.all(cutoffDate) : stmt.all(cutoffDate);
    return rows.map((row: any) => this.mapRowToQueueItem(row));
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.db) {
      try {
        if (isBun) {
          this.db.close();
        } else {
          this.db.close();
        }
      } catch (error) {
        if (this.config.debug) {
          console.error('Error closing SQLite database:', error);
        }
      }
      this.db = null;
    }

    this.isInitialized = false;
    this.emit('shutdown');
  }

  // Optional: Batch job processing for better performance
  async getNextPendingJobs(count: number): Promise<QueueItem[]> {
    try {
      const transaction = isBun ? this.db.transaction(() => {
        // Get multiple pending jobs
        const selectStmt = this.db.prepare(`
          SELECT * FROM jobs
          WHERE status = 'pending'
            AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
          ORDER BY priority DESC, requested_at ASC
          LIMIT ?
        `);

        const rows = selectStmt.all(count);
        if (rows.length === 0) {
          return [];
        }

        // Atomically update all selected jobs to processing status
        const updateStmt = this.db.prepare(`
          UPDATE jobs
          SET status = 'processing', started_at = datetime('now')
          WHERE id = ? AND status = 'pending'
        `);

        const claimedRows = [];
        for (const row of rows) {
          const updateResult = updateStmt.run(row.id);
          if (updateResult.changes > 0) {
            // Successfully claimed this job
            row.status = JobStatus.PROCESSING;
            row.started_at = new Date().toISOString();
            claimedRows.push(row);
          }
        }

        return claimedRows;
      }) : () => {
        const selectStmt = this.db.prepare(`
          SELECT * FROM jobs
          WHERE status = 'pending'
            AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
          ORDER BY priority DESC, requested_at ASC
          LIMIT ?
        `);

        const rows = selectStmt.all(count);
        if (rows.length === 0) {
          return [];
        }

        // Atomically update all selected jobs to processing status
        const updateStmt = this.db.prepare(`
          UPDATE jobs
          SET status = 'processing', started_at = datetime('now')
          WHERE id = ? AND status = 'pending'
        `);

        const claimedRows = [];
        for (const row of rows) {
          const updateResult = updateStmt.run(row.id);
          if (updateResult.changes > 0) {
            // Successfully claimed this job
            row.status = JobStatus.PROCESSING;
            row.started_at = new Date().toISOString();
            claimedRows.push(row);
          }
        }

        return claimedRows;
      };

      const rows = transaction();
      return rows.map((row: any) => this.mapRowToQueueItem(row));
    } catch (error) {
      throw new Error(`Failed to get next pending jobs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Optimized isIdle check for performance
  async isIdle(): Promise<boolean> {
    const stmt = this.db.prepare('SELECT 1 FROM jobs WHERE status IN (?, ?) LIMIT 1');
    const row = isBun ? stmt.get(JobStatus.PENDING, JobStatus.PROCESSING) : stmt.get(JobStatus.PENDING, JobStatus.PROCESSING);
    return !row;
  }
}
