import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import { QueueItem, JobStatus, JobPayload, JobResult, QueueConfig } from '../types/index.js';
import { IQueueBackend, QueueStats } from './IQueueBackend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dynamic import for PGLite
let PGlite: any;

// Initialize PGLite driver
async function initializePGLite() {
  if (PGlite) return; // Already initialized

  try {
    // @ts-ignore - Dynamic import for optional dependency
    const pgliteModule = await import('@electric-sql/pglite');
    PGlite = pgliteModule.PGlite;
  } catch (error) {
    throw new Error('PGLite is not installed. Install @electric-sql/pglite to use the PGLite backend.');
  }
}

/**
 * Single-threaded operation queue to prevent WebAssembly memory corruption
 * PGLite's WebAssembly module cannot handle concurrent operations safely
 */
class OperationQueue {
  private queue: Array<() => Promise<any>> = [];
  private isProcessing = false;

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const operation = this.queue.shift()!;
      try {
        await operation();
      } catch (error) {
        // Error is already handled in the operation wrapper
      }
    }

    this.isProcessing = false;
  }
}

export interface PGLiteQueueConfig extends QueueConfig {
  /**
   * Database connection string or path
   * Examples:
   * - 'memory://' for in-memory database
   * - 'idb://my-database' for IndexedDB (browser)
   * - './data/queue.db' for file-based database
   */
  databaseUrl?: string;
  
  /**
   * Maximum number of database connections in the pool
   */
  maxConnections?: number;
  
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
}

/**
 * PGLite-based queue backend with full PostgreSQL compatibility
 * Supports local development with PGLite and production with PostgreSQL/TimescaleDB
 */
export class PGLiteQueue extends IQueueBackend {
  private db: any | null = null;
  protected config: Required<PGLiteQueueConfig>;
  private isInitialized = false;
  private isShuttingDown = false;
  private notificationListeners = new Map<string, Set<Function>>();
  private operationQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private dbOperationQueue: OperationQueue;

  constructor(config: PGLiteQueueConfig = {}) {
    super(config);

    this.config = {
      ...this.getConfig(),
      databaseUrl: config.databaseUrl || 'memory://',
      maxConnections: config.maxConnections || 10,
      debug: config.debug || false,
      migrationsPath: config.migrationsPath || join(__dirname, 'migrations', 'pg'),
      autoMigrate: config.autoMigrate !== false, // Default to true
    };

    // Initialize operation queue to serialize all database operations
    // This prevents WebAssembly memory corruption by ensuring single-threaded access
    this.dbOperationQueue = new OperationQueue();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize PGLite driver
    await initializePGLite();

    await this.dbOperationQueue.execute(async () => {
      try {
        if (this.config.debug) {
          console.log('Creating PGLite instance with debug mode enabled...');
        }
        this.db = await PGlite.create({
          dataDir: this.config.databaseUrl,
          debug: this.config.debug ? 1 : 0,
          relaxedDurability: false, // Enforce stricter durability
        });
        if (this.config.debug) {
          console.log('PGLite instance created successfully');
        }

        // Run migrations if enabled
        if (this.config.autoMigrate) {
          await this.runMigrationsInternal();
        }

        // Set up notification listeners
        await this.setupNotificationsInternal();

        this.isInitialized = true;
        console.log(`PGLiteQueue initialized with database: ${this.config.databaseUrl}`);
      } catch (error) {
        throw new Error(`Failed to initialize PGLiteQueue: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async addJob(jobPayload: JobPayload, customId?: string): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down, cannot add new jobs');
    }

    const id = customId || this.generateJobId();

    return this.executeQueued(async () => {
      try {
        await this.db!.query(`
          INSERT INTO jobs (id, job_payload, status, requested_at)
          VALUES ($1, $2, $3, NOW())
        `, [id, jobPayload, JobStatus.PENDING]);

        return id;
      } catch (error) {
        if (error instanceof Error && error.message.includes('duplicate key')) {
          throw new Error(`Job with ID ${id} already exists in queue`);
        }
        throw new Error(`Failed to add job: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async getJob(id: string): Promise<QueueItem | undefined> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`
          SELECT id, job_payload, status, requested_at, started_at, completed_at,
                 last_updated, worker_id, result, error_message, error_stack
          FROM jobs 
          WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
          return undefined;
        }

        return this.mapRowToQueueItem(result.rows[0]);
      } catch (error) {
        throw new Error(`Failed to get job: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    result?: JobResult,
    error?: Error,
    workerId?: number
  ): Promise<boolean> {
    return this.executeQueued(async () => {
      const updateFields: string[] = ['status = $2', 'last_updated = NOW()'];
      const params: any[] = [id, status];
      let paramIndex = 3;

      if (status === JobStatus.PROCESSING && workerId !== undefined) {
        updateFields.push(`worker_id = $${paramIndex++}`);
        updateFields.push(`started_at = NOW()`);
        params.push(workerId);
      }

      if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
        updateFields.push(`completed_at = NOW()`);

        if (result !== undefined) {
          updateFields.push(`result = $${paramIndex++}`);
          params.push(JSON.stringify(result));
        }

        if (error) {
          updateFields.push(`error_message = $${paramIndex++}`);
          updateFields.push(`error_stack = $${paramIndex++}`);
          params.push(error.message);
          params.push(error.stack || '');
        }
      }

      const query = `UPDATE jobs SET ${updateFields.join(', ')} WHERE id = $1`;
      if (this.config.debug) {
        console.log(`[PGLite DEBUG] Executing updateJobStatus query for job ${id}:`, query);
        console.log(`[PGLite DEBUG] Parameters:`, params);
      }

      try {
        const updateResult = await this.executeWithRetry(
          () => this.db!.query(query, params),
          `updateJobStatus for job ${id}`
        );

        if (this.config.debug) {
          console.log(`[PGLite DEBUG] Update result for job ${id}:`, updateResult);
        }

        return ((updateResult as any).affectedRows || 0) > 0;
      } catch (error) {
        console.error(`[PGLite ERROR] Failed to update job ${id} status:`, error);
        console.error(`[PGLite ERROR] Query was:`, query);
        console.error(`[PGLite ERROR] Parameters were:`, params);
        console.error(`[PGLite ERROR] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
        throw new Error(`Failed to update job status: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async getNextPendingJob(): Promise<QueueItem | undefined> {
    return this.executeQueued(async () => {
      try {
        // Use the stored function for atomic job claiming with row locking
        const result = await this.db!.query(`
          SELECT * FROM get_next_pending_job($1)
        `, [null]); // We'll add worker ID support later

        if (result.rows.length === 0) {
          return undefined;
        }

        const row = result.rows[0] as any;
        return {
          id: row.id,
          jobPayload: typeof row.job_payload === 'string' ? JSON.parse(row.job_payload) : row.job_payload,
          status: row.status as JobStatus,
          requestedAt: new Date(row.requested_at),
          startedAt: new Date(), // Just started
          lastUpdated: new Date(),
          workerId: undefined, // Will be set by the caller
        };
      } catch (error) {
        throw new Error(`Failed to get next pending job: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Get multiple pending jobs for batch processing
   */
  async getNextPendingJobs(count: number): Promise<QueueItem[]> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        // Use a more efficient batch query to reduce database operations
        const result = await this.executeWithRetry(
          () => this.db!.query(`
            UPDATE jobs
            SET status = 'processing', started_at = NOW(), last_updated = NOW()
            WHERE id IN (
              SELECT id FROM jobs
              WHERE status = 'pending'
                AND (scheduled_for IS NULL OR scheduled_for <= NOW())
              ORDER BY priority DESC, requested_at ASC
              LIMIT $1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, job_payload, status, requested_at, started_at,
                     completed_at, last_updated, worker_id, result,
                     error_message, error_stack
          `, [count]),
          `getNextPendingJobs batch of ${count}`
        );

        return (result as any).rows.map((row: any) => this.mapRowToQueueItem(row));
      } catch (error) {
        throw new Error(`Failed to get next pending jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`
          SELECT id, job_payload, status, requested_at, started_at, completed_at,
                 last_updated, worker_id, result, error_message, error_stack
          FROM jobs 
          WHERE status = $1
          ORDER BY requested_at ASC
        `, [status]);

        return (result as any).rows.map((row: any) => this.mapRowToQueueItem(row));
      } catch (error) {
        throw new Error(`Failed to get jobs by status: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async getStats(): Promise<QueueStats> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query('SELECT * FROM job_stats');
        const stats = result.rows[0] as any;

        return {
          total: parseInt(stats.total) || 0,
          pending: parseInt(stats.pending) || 0,
          processing: parseInt(stats.processing) || 0,
          completed: parseInt(stats.completed) || 0,
          failed: parseInt(stats.failed) || 0,
          oldestPending: stats.oldest_pending ? new Date(stats.oldest_pending) : undefined,
        };
      } catch (error) {
        throw new Error(`Failed to get queue stats: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async cleanup(): Promise<number> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const maxAgeHours = Math.floor(this.config.maxInMemoryAge / (1000 * 60 * 60));
        const result = await this.db!.query(`SELECT cleanup_old_jobs($1)`, [maxAgeHours]);
        return parseInt((result.rows[0] as any).cleanup_old_jobs) || 0;
      } catch (error) {
        console.error(`Failed to cleanup old jobs: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      }
    });
  }

  async hasPendingJobs(): Promise<boolean> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`
          SELECT EXISTS(SELECT 1 FROM jobs WHERE status = $1) as has_pending
        `, [JobStatus.PENDING]);

        return (result.rows[0] as any).has_pending;
      } catch (error) {
        throw new Error(`Failed to check for pending jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async hasProcessingJobs(): Promise<boolean> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`
          SELECT EXISTS(SELECT 1 FROM jobs WHERE status = $1) as has_processing
        `, [JobStatus.PROCESSING]);

        return (result.rows[0] as any).has_processing;
      } catch (error) {
        throw new Error(`Failed to check for processing jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async isEmpty(): Promise<boolean> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`SELECT EXISTS(SELECT 1 FROM jobs) as has_jobs`);
        return !(result.rows[0] as any).has_jobs;
      } catch (error) {
        throw new Error(`Failed to check if queue is empty: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async recoverStalledJobs(stalledTimeoutMs: number = 300000): Promise<number> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        // Use milliseconds for more precise timeout handling
        const result = await this.db!.query(`
          UPDATE jobs
          SET status = 'pending', started_at = NULL, worker_id = NULL
          WHERE status = 'processing'
            AND started_at < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
          RETURNING id
        `);

        const recoveredCount = result.rows.length;

        if (recoveredCount > 0) {
          console.log(`Recovered ${recoveredCount} stalled jobs`);
        }

        return recoveredCount;
      } catch (error) {
        throw new Error(`Failed to recover stalled jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async getStalledJobs(stalledTimeoutMs: number = 300000): Promise<QueueItem[]> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        // Use milliseconds for more precise timeout handling
        const result = await this.db!.query(`
          SELECT * FROM jobs
          WHERE status = 'processing'
            AND started_at < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
          ORDER BY started_at ASC
        `);

        return (result as any).rows.map((row: any) => ({
          id: row.id,
          jobPayload: typeof row.job_payload === 'string' ? JSON.parse(row.job_payload) : row.job_payload,
          status: row.status as JobStatus,
          requestedAt: new Date(row.requested_at),
          startedAt: row.started_at ? new Date(row.started_at) : undefined,
          completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
          lastUpdated: new Date(row.last_updated),
          workerId: row.worker_id,
          result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : undefined,
          error: row.error_message ? new Error(row.error_message) : undefined,
        }));
      } catch (error) {
        throw new Error(`Failed to get stalled jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.db) {
      try {
        // Clean up notification listeners
        for (const [channel, listeners] of this.notificationListeners) {
          for (const listener of listeners) {
            await this.db.unlisten(channel, listener as any);
          }
        }
        this.notificationListeners.clear();

        await this.db.close();
        this.db = null;
        console.log('PGLiteQueue shut down successfully');
      } catch (error) {
        console.error(`Error during PGLiteQueue shutdown: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.isInitialized = false;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.db) {
      // During shutdown, provide a more informative error message
      if (this.isShuttingDown) {
        throw new Error('PGLiteQueue is shutting down. Cannot perform database operations.');
      }
      throw new Error('PGLiteQueue not initialized. Call initialize() first.');
    }
  }

  /**
   * Execute a database operation through the serialized queue to prevent WebAssembly memory corruption
   */
  private async executeQueued<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureInitialized();
    return this.dbOperationQueue.execute(operation);
  }

  private generateJobId(): string {
    // Use ULID for monotonic, time-sortable IDs
    return ulid();
  }

  private mapRowToQueueItem(row: any): QueueItem {
    return {
      id: row.id,
      jobPayload: typeof row.job_payload === 'string' ? JSON.parse(row.job_payload) : row.job_payload,
      status: row.status as JobStatus,
      requestedAt: new Date(row.requested_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      lastUpdated: new Date(row.last_updated),
      workerId: row.worker_id,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : undefined,
      error: row.error_message ? new Error(row.error_message) : undefined,
    };
  }

  private async runMigrations(): Promise<void> {
    return this.executeQueued(() => this.runMigrationsInternal());
  }

  private async setupNotifications(): Promise<void> {
    return this.executeQueued(() => this.setupNotificationsInternal());
  }

  private async runMigrationsInternal(): Promise<void> {
    try {
      // Check if migrations table exists
      const tableExists = await this.db!.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'schema_migrations'
        ) as exists
      `);

      let currentVersion = 0;
      if ((tableExists.rows[0] as any).exists) {
        const versionResult = await this.db!.query(`
          SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations
        `);
        currentVersion = parseInt((versionResult.rows[0] as any).version) || 0;
      }

      // Load and run migration files
      const migrationFiles = ['001_initial_schema.sql']; // Add more as needed

      for (const filename of migrationFiles) {
        const versionMatch = filename.match(/^(\d+)_/);
        if (!versionMatch) continue;

        const version = parseInt(versionMatch[1]);
        if (version <= currentVersion) continue;

        console.log(`Running migration ${filename}...`);

        try {
          const migrationPath = join(this.config.migrationsPath, filename);
          const migrationSql = await readFile(migrationPath, 'utf-8');
          await this.db!.exec(migrationSql);
          console.log(`Migration ${filename} completed successfully`);
        } catch (error) {
          throw new Error(`Migration ${filename} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      throw new Error(`Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async setupNotificationsInternal(): Promise<void> {
    try {
      // Listen for job status changes
      await this.db!.listen('job_status_changed', (payload: string) => {
        try {
          const data = JSON.parse(payload);
          this.emit('job-status-changed', data);
        } catch (error) {
          console.error('Failed to parse job status change notification:', error);
        }
      });

      // Listen for new jobs
      await this.db!.listen('job_added', (payload: string) => {
        try {
          const data = JSON.parse(payload);
          this.emit('item-added', data);
          this.emit('queue-not-empty');
        } catch (error) {
          console.error('Failed to parse job added notification:', error);
        }
      });

      console.log('Database notifications set up successfully');
    } catch (error) {
      console.warn(`Failed to set up database notifications: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw here as notifications are not critical for basic functionality
    }
  }

  /**
   * Get database connection for advanced operations
   * Use with caution - prefer using the queue methods when possible
   */
  getDatabase(): any | null {
    return this.db;
  }

  /**
   * Execute raw SQL query - for advanced use cases
   */
  async query(sql: string, params?: any[]): Promise<any> {
    return this.executeQueued(async () => {
      this.ensureInitialized();
      return await this.db!.query(sql, params);
    });
  }

  /**
   * Execute multiple SQL statements in a transaction
   */
  async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    return this.executeQueued(async () => {
      this.ensureInitialized();
      return await this.db!.transaction(callback);
    });
  }

  /**
   * Get detailed job information including execution history
   */
  async getJobDetails(id: string): Promise<any> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`
          SELECT
            id, job_payload, status, requested_at, started_at, completed_at,
            last_updated, worker_id, result, error_message, error_stack,
            retry_count, max_retries, timeout_ms, priority, scheduled_for,
            created_by, tags
          FROM jobs
          WHERE id = $1
        `, [id]);

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0] as any;
        return {
          ...this.mapRowToQueueItem(row),
          retryCount: row.retry_count,
          maxRetries: row.max_retries,
          timeoutMs: row.timeout_ms,
          priority: row.priority,
          scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : undefined,
          createdBy: row.created_by,
          tags: row.tags,
        };
      } catch (error) {
        throw new Error(`Failed to get job details: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Schedule a job for future execution
   */
  async scheduleJob(jobPayload: JobPayload, scheduledFor: Date, customId?: string): Promise<string> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      if (this.isShuttingDown) {
        throw new Error('Queue is shutting down, cannot add new jobs');
      }

      const id = customId || this.generateJobId();

      try {
        await this.db!.query(`
          INSERT INTO jobs (id, job_payload, status, requested_at, scheduled_for)
          VALUES ($1, $2, $3, NOW(), $4)
        `, [id, jobPayload, JobStatus.PENDING, scheduledFor]);

        return id;
      } catch (error) {
        if (error instanceof Error && error.message.includes('duplicate key')) {
          throw new Error(`Job with ID ${id} already exists in queue`);
        }
        throw new Error(`Failed to schedule job: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Get jobs scheduled for future execution
   */
  async getScheduledJobs(): Promise<QueueItem[]> {
    return this.executeQueued(async () => {
      this.ensureInitialized();

      try {
        const result = await this.db!.query(`
          SELECT id, job_payload, status, requested_at, started_at, completed_at,
                 last_updated, worker_id, result, error_message, error_stack
          FROM jobs
          WHERE status = $1 AND scheduled_for > NOW()
          ORDER BY scheduled_for ASC
        `, [JobStatus.PENDING]);

        return (result as any).rows.map((row: any) => this.mapRowToQueueItem(row));
      } catch (error) {
        throw new Error(`Failed to get scheduled jobs: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Execute database operation with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add small delay between attempts to reduce contention
        if (attempt > 0) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000); // Exponential backoff, max 1s
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        if (this.isRetryableError(lastError) && attempt < maxRetries) {
          if (this.config.debug) {
            console.warn(`${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`);
          }
          continue;
        }

        // Non-retryable error or max retries reached
        break;
      }
    }

    throw new Error(`${operationName} failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Check if an error is retryable (memory access issues, connection problems, etc.)
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('out of bounds memory access') ||
      message.includes('memory access') ||
      message.includes('connection') ||
      message.includes('busy') ||
      message.includes('locked') ||
      message.includes('timeout')
    );
  }

  /**
   * Queue database operations to prevent concurrent access issues
   */
  private async queueOperation<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.operationQueue.push(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processOperationQueue();
    });
  }

  /**
   * Process queued database operations sequentially
   */
  private async processOperationQueue(): Promise<void> {
    if (this.isProcessingQueue || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          // Error handling is done in the queued operation
          console.error('Queued operation failed:', error);
        }
      }
    }

    this.isProcessingQueue = false;
  }
}
