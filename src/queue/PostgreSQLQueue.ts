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

// Conditional import for Bun's SQL or Node.js postgres
let SQL: any;
let isBunEnvironment = false;
if (typeof globalThis.Bun !== "undefined") {
  // @ts-ignore
  SQL = (await import("bun")).SQL;
  isBunEnvironment = true;
} else {
  // For Node.js environment, use postgres package
  const postgresModule = await import("postgres");
  SQL = postgresModule.default;
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
  enableTimescaleDB?: boolean;
  chunkTimeInterval?: string; // e.g., '1 hour', '1 day'
  compressionInterval?: string; // e.g., '7 days'
  retentionInterval?: string; // e.g., '90 days'
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
  private enableTimescaleDB: boolean;
  private chunkTimeInterval: string;
  private compressionInterval: string;
  private retentionInterval: string;

  constructor(config: PostgreSQLQueueConfig) {
    super(config);
    this.tableName = config.tableName || "workalot_jobs";
    this.enableNotifications = config.enableNotifications !== false;
    this.retentionDays = config.retentionDays || 30;
    this.enableTimescaleDB = config.enableTimescaleDB || false;
    this.chunkTimeInterval = config.chunkTimeInterval || "1 hour";
    this.compressionInterval = config.compressionInterval || "7 days";
    this.retentionInterval = config.retentionInterval || "90 days";

    // Build connection string for PostgreSQL
    this.connectionString =
      config.connectionString ||
      `postgres://${config.user || "postgres"}:${config.password || ""}@${
        config.host || "localhost"
      }:${config.port || 5432}/${config.database || "workalot"}`;

    // Initialize SQL connection
    // Both Bun and postgres use similar connection patterns
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
    // Check if TimescaleDB is enabled and table already exists as hypertable
    if (this.enableTimescaleDB) {
      try {
        const hypertableCheck = await this.sql.unsafe(`
          SELECT * FROM timescaledb_information.hypertables
          WHERE hypertable_name = '${this.tableName}'
        `);

        if (hypertableCheck.length > 0) {
          // Table already exists as hypertable, skip all schema creation
          console.log(
            `TimescaleDB: Skipping schema creation for existing hypertable ${this.tableName}`
          );
          return;
        }
      } catch (error) {
        // If the query fails, continue with normal schema creation
        console.log(
          `TimescaleDB: Hypertable check failed, proceeding with schema creation:`,
          error
        );
      }
    }

    // Create extension for UUID generation if not exists
    await this.sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    // Enable TimescaleDB extension if requested
    if (this.enableTimescaleDB) {
      await this.sql`CREATE EXTENSION IF NOT EXISTS timescaledb;`;
    }

    // Create jobs table using appropriate query method for dynamic table name
    // For TimescaleDB, we need to check if the table needs to be recreated with composite primary key
    if (this.enableTimescaleDB) {
      try {
        // Check if table exists and has data
        const tableCheck = await this.sql.unsafe(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = '${this.tableName}'
          ) as table_exists;
        `);

        if (tableCheck[0]?.table_exists) {
          // Check if the table has a primary key on just 'id'
          const primaryKeyCheck = await this.sql.unsafe(`
            SELECT
              conname,
              ARRAY(
                SELECT attname
                FROM pg_attribute
                WHERE attrelid = conrelid AND attnum = ANY(conkey)
              ) as columns
            FROM pg_constraint
            WHERE conrelid = '${this.tableName}'::regclass
            AND contype = 'p';
          `);

          if (primaryKeyCheck.length > 0) {
            const primaryKeyColumns = primaryKeyCheck[0].columns;
            // If primary key only contains 'id', we need to recreate the table
            if (
              primaryKeyColumns.length === 1 &&
              primaryKeyColumns[0] === "id"
            ) {
              console.log(
                `TimescaleDB: Recreating table ${this.tableName} with composite primary key`
              );

              // Drop dependent objects first
              await this.sql.unsafe(`
                DROP VIEW IF EXISTS workalot_job_stats;
              `);

              // Get all the data from the existing table
              const data = await this.sql.unsafe(`
                SELECT * FROM ${this.tableName};
              `);

              // Drop the existing table
              await this.sql.unsafe(`
                DROP TABLE ${this.tableName};
              `);

              // Recreate with composite primary key
              await this.sql.unsafe(`
                CREATE TABLE ${this.tableName} (
                  id VARCHAR(26),
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
                  metadata JSONB DEFAULT '{}'::jsonb,
                  PRIMARY KEY (id, requested_at)
                )
              `);

              // Convert to hypertable
              await this.sql.unsafe(`
                SELECT create_hypertable('${this.tableName}', 'requested_at',
                  chunk_time_interval => INTERVAL '${this.chunkTimeInterval}')
              `);

              // Enable compression
              await this.sql.unsafe(`
                ALTER TABLE ${this.tableName} SET (
                  timescaledb.compress,
                  timescaledb.compress_segmentby = 'status',
                  timescaledb.compress_orderby = 'requested_at DESC'
                )
              `);

              // Reinsert the data if any existed
              if (data.length > 0) {
                console.log(`TimescaleDB: Reinserting ${data.length} rows`);
                for (const row of data) {
                  if (isBunEnvironment) {
                    await this.sql.unsafe(`
                      INSERT INTO ${this.tableName} (
                        id, payload, status, worker_id, result, error,
                        requested_at, started_at, completed_at, last_updated,
                        retry_count, max_retries, priority, metadata
                      ) VALUES (
                        '${row.id}', '${JSON.stringify(row.payload)}', '${
                      row.status
                    }', 
                        ${row.worker_id ? row.worker_id : "NULL"}, 
                        ${
                          row.result
                            ? `'${JSON.stringify(row.result)}'`
                            : "NULL"
                        }, 
                        ${row.error ? `'${row.error}'` : "NULL"},
                        '${row.requested_at.toISOString()}', 
                        ${
                          row.started_at
                            ? `'${row.started_at.toISOString()}'`
                            : "NULL"
                        }, 
                        ${
                          row.completed_at
                            ? `'${row.completed_at.toISOString()}'`
                            : "NULL"
                        }, 
                        '${row.last_updated.toISOString()}', 
                        ${row.retry_count}, ${row.max_retries}, ${
                      row.priority
                    }, 
                        '${JSON.stringify(row.metadata)}'
                      )
                    `);
                  } else {
                    await this.sql.query(
                      `
                      INSERT INTO ${this.tableName} (
                        id, payload, status, worker_id, result, error,
                        requested_at, started_at, completed_at, last_updated,
                        retry_count, max_retries, priority, metadata
                      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    `,
                      [
                        row.id,
                        JSON.stringify(row.payload),
                        row.status,
                        row.worker_id,
                        row.result ? JSON.stringify(row.result) : null,
                        row.error,
                        row.requested_at,
                        row.started_at,
                        row.completed_at,
                        row.last_updated,
                        row.retry_count,
                        row.max_retries,
                        row.priority,
                        JSON.stringify(row.metadata),
                      ]
                    );
                  }
                }
              }
            }
          }
        } else {
          // Create table with composite primary key for TimescaleDB
          if (isBunEnvironment) {
            await this.sql.unsafe(`
              CREATE TABLE ${this.tableName} (
                id VARCHAR(26),
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
                metadata JSONB DEFAULT '{}'::jsonb,
                PRIMARY KEY (id, requested_at)
              )
            `);
          } else {
            await this.sql.query(`
              CREATE TABLE ${this.tableName} (
                id VARCHAR(26),
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
                metadata JSONB DEFAULT '{}'::jsonb,
                PRIMARY KEY (id, requested_at)
              )
            `);
          }
        }
      } catch (error) {
        console.log(
          `TimescaleDB: Error checking/recreating table structure:`,
          error
        );
        // Continue with normal schema processing
      }
    } else {
      if (isBunEnvironment) {
        await this.sql.unsafe(`
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
          )
        `);
      } else {
        await this.sql.query(`
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
          )
        `);
      }
    }

    // Convert to hypertable if TimesimescaleDB is enabled
    if (this.enableTimescaleDB) {
      // Check if already a hypertable using appropriate query method
      let hypertableCheck;
      if (isBunEnvironment) {
        hypertableCheck = await this.sql.unsafe(`
          SELECT * FROM timescaledb_information.hypertables
          WHERE hypertable_name = '${this.tableName}'
        `);
      } else {
        hypertableCheck = await this.sql.query(
          `
          SELECT * FROM timescaledb_information.hypertables
          WHERE hypertable_name = $1
        `,
          [this.tableName]
        );
      }

      if (hypertableCheck.rows?.length === 0) {
        // Convert to hypertable using appropriate query method for TimescaleDB functions
        if (isBunEnvironment) {
          await this.sql.unsafe(`
            SELECT create_hypertable('${this.tableName}', 'requested_at',
              chunk_time_interval => INTERVAL '${this.chunkTimeInterval}')
          `);

          // Enable compression
          await this.sql.unsafe(`
            ALTER TABLE ${this.tableName} SET (
              timescaledb.compress,
              timescaledb.compress_segmentby = 'status',
              timescaledb.compress_orderby = 'requested_at DESC'
            )
          `);

          // Set up compression policy
          await this.sql.unsafe(`
            SELECT add_compression_policy('${this.tableName}', INTERVAL '${this.compressionInterval}')
          `);

          // Set up retention policy
          await this.sql.unsafe(`
            SELECT add_retention_policy('${this.tableName}', INTERVAL '${this.retentionInterval}')
          `);
        } else {
          await this.sql.query(
            `
            SELECT create_hypertable($1, 'requested_at',
              chunk_time_interval => INTERVAL $2)
          `,
            [this.tableName, this.chunkTimeInterval]
          );

          // Enable compression
          await this.sql.query(`
            ALTER TABLE ${this.tableName} SET (
              timescaledb.compress,
              timescaledb.compress_segmentby = 'status',
              timescaledb.compress_orderby = 'requested_at DESC'
            )
          `);

          // Set up compression policy
          await this.sql.query(
            `
            SELECT add_compression_policy($1, INTERVAL $2)
          `,
            [this.tableName, this.compressionInterval]
          );

          // Set up retention policy
          await this.sql.query(
            `
            SELECT add_retention_policy($1, INTERVAL $2)
          `,
            [this.tableName, this.retentionInterval]
          );
        }
      }
    }

    // Skip index creation if TimescaleDB is enabled and table is already a hypertable
    if (this.enableTimescaleDB) {
      console.log(
        `TimescaleDB: Checking if ${this.tableName} is already a hypertable...`
      );
      let hypertableCheck;
      if (isBunEnvironment) {
        hypertableCheck = await this.sql.unsafe(`
          SELECT * FROM timescaledb_information.hypertables
          WHERE hypertable_name = '${this.tableName}'
        `);
      } else {
        hypertableCheck = await this.sql.query(
          `
          SELECT * FROM timescaledb_information.hypertables
          WHERE hypertable_name = $1
        `,
          [this.tableName]
        );
      }

      console.log(
        `TimescaleDB: Hypertable check result: ${
          hypertableCheck.rows?.length || 0
        } rows`
      );

      if (hypertableCheck.rows?.length > 0) {
        // Table is already a hypertable with indexes, skip index creation
        console.log(
          `TimescaleDB: Skipping index creation for existing hypertable ${this.tableName}`
        );
        return;
      }
    }

    // Create indexes for performance using appropriate query method for dynamic table names
    if (isBunEnvironment) {
      await this.sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status
        ON ${this.tableName}(status)
        WHERE status IN ('pending', 'processing')
      `);
    } else {
      await this.sql.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status
        ON ${this.tableName}(status)
        WHERE status IN ('pending', 'processing')
      `);
    }

    if (isBunEnvironment) {
      await this.sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_worker_id
        ON ${this.tableName}(worker_id)
        WHERE worker_id IS NOT NULL
      `);
    } else {
      await this.sql.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_worker_id
        ON ${this.tableName}(worker_id)
        WHERE worker_id IS NOT NULL
      `);
    }

    if (isBunEnvironment) {
      await this.sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_priority_requested
        ON ${this.tableName}(priority DESC, requested_at ASC)
        WHERE status = 'pending'
      `);
    } else {
      await this.sql.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_priority_requested
        ON ${this.tableName}(priority DESC, requested_at ASC)
        WHERE status = 'pending'
      `);
    }

    if (isBunEnvironment) {
      await this.sql.unsafe(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_completed_at
        ON ${this.tableName}(completed_at)
        WHERE status IN ('completed', 'failed')
      `);
    } else {
      await this.sql.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_completed_at
        ON ${this.tableName}(completed_at)
        WHERE status IN ('completed', 'failed')
      `);
    }

    // TimescaleDB-specific indexes for better time-series performance
    if (this.enableTimescaleDB) {
      if (isBunEnvironment) {
        await this.sql.unsafe(`
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_time_status
          ON ${this.tableName}(requested_at DESC, status)
          WHERE status IN ('pending', 'processing')
        `);

        await this.sql.unsafe(`
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_time_completed
          ON ${this.tableName}(completed_at DESC)
          WHERE completed_at IS NOT NULL
        `);
      } else {
        await this.sql.query(`
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_time_status
          ON ${this.tableName}(requested_at DESC, status)
          WHERE status IN ('pending', 'processing')
        `);

        await this.sql.query(`
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_time_completed
          ON ${this.tableName}(completed_at DESC)
          WHERE completed_at IS NOT NULL
        `);
      }
    }

    // Create trigger for updating last_updated timestamp
    if (isBunEnvironment) {
      await this.sql`
        CREATE OR REPLACE FUNCTION update_last_updated_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.last_updated = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `;
    } else {
      await this.sql.query(`
        CREATE OR REPLACE FUNCTION update_last_updated_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.last_updated = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);
    }

    if (isBunEnvironment) {
      await this.sql.unsafe(`
        DROP TRIGGER IF EXISTS update_${this.tableName}_last_updated ON ${this.tableName};
        CREATE TRIGGER update_${this.tableName}_last_updated
        BEFORE UPDATE ON ${this.tableName}
        FOR EACH ROW EXECUTE FUNCTION update_last_updated_column()
      `);
    } else {
      await this.sql.query(`
        DROP TRIGGER IF EXISTS update_${this.tableName}_last_updated ON ${this.tableName};
        CREATE TRIGGER update_${this.tableName}_last_updated
        BEFORE UPDATE ON ${this.tableName}
        FOR EACH ROW EXECUTE FUNCTION update_last_updated_column()
      `);
    }

    // Create notification trigger if enabled
    if (this.enableNotifications) {
      if (isBunEnvironment) {
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
      } else {
        await this.sql.query(`
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
        `);
      }

      if (isBunEnvironment) {
        await this.sql.unsafe(`
        DROP TRIGGER IF EXISTS ${this.tableName}_notify ON ${this.tableName};
        CREATE TRIGGER ${this.tableName}_notify
        AFTER INSERT OR UPDATE OR DELETE ON ${this.tableName}
        FOR EACH ROW EXECUTE FUNCTION notify_job_change()
      `);
      } else {
        await this.sql.query(`
        DROP TRIGGER IF EXISTS ${this.tableName}_notify ON ${this.tableName};
        CREATE TRIGGER ${this.tableName}_notify
        AFTER INSERT OR UPDATE OR DELETE ON ${this.tableName}
        FOR EACH ROW EXECUTE FUNCTION notify_job_change()
      `);
      }
    }
  }

  private async setupNotifications(): Promise<void> {
    // Create a separate connection for LISTEN
    // Both Bun and postgres use the same connection pattern
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

    await this.sql.unsafe(`
      INSERT INTO ${this.tableName} (id, payload, status, requested_at)
      VALUES ('${id}', '${JSON.stringify(jobPayload)}', '${
      JobStatus.PENDING
    }', NOW())
    `);

    // Notify about new job if notifications are enabled
    if (this.enableNotifications) {
      this.eventEmitter.emit("job-added", { id, payload: jobPayload });
    }

    return id;
  }

  async getJob(id: string): Promise<QueueItem | undefined> {
    const result = await this.sql.unsafe(`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.tableName}
      WHERE id = '${id}'
    `);

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
    workerId?: number
  ): Promise<boolean> {
    let rowsAffected = 0;

    switch (status) {
      case JobStatus.PROCESSING:
        if (isBunEnvironment) {
          const processing = await this.sql.unsafe(`
            UPDATE ${this.tableName}
            SET status = '${status}', worker_id = ${workerId}, started_at = NOW()
            WHERE id = '${id}' AND status = 'pending'
            RETURNING id
          `);
          rowsAffected = processing.length;
        } else {
          const processing = await this.sql.query(
            `
            UPDATE ${this.tableName}
            SET status = $1, worker_id = $2, started_at = NOW()
            WHERE id = $3 AND status = 'pending'
            RETURNING id
          `,
            [status, workerId, id]
          );
          rowsAffected = processing.rows?.length || 0;
        }
        break;

      case JobStatus.COMPLETED:
        if (isBunEnvironment) {
          const completed = await this.sql.unsafe(`
            UPDATE ${this.tableName}
            SET status = '${status}', result = ${
            result ? `'${JSON.stringify(result)}'` : "null"
          }, completed_at = NOW()
            WHERE id = '${id}'
            RETURNING id
          `);
          rowsAffected = completed.length;
        } else {
          const completed = await this.sql.query(
            `
            UPDATE ${this.tableName}
            SET status = $1, result = $2, completed_at = NOW()
            WHERE id = $3
            RETURNING id
          `,
            [status, result ? JSON.stringify(result) : null, id]
          );
          rowsAffected = completed.rows?.length || 0;
        }
        break;

      case JobStatus.FAILED:
        if (isBunEnvironment) {
          const failed = await this.sql.unsafe(`
            UPDATE ${this.tableName}
            SET status = '${status}', error = '${
            error?.message || null
          }', completed_at = NOW()
            WHERE id = '${id}'
            RETURNING id
          `);
          rowsAffected = failed.length;
        } else {
          const failed = await this.sql.query(
            `
            UPDATE ${this.tableName}
            SET status = $1, error = $2, completed_at = NOW()
            WHERE id = $3
            RETURNING id
          `,
            [status, error?.message || null, id]
          );
          rowsAffected = failed.rows?.length || 0;
        }
        break;

      default:
        if (isBunEnvironment) {
          const updated = await this.sql.unsafe(`
            UPDATE ${this.tableName}
            SET status = '${status}'
            WHERE id = '${id}'
            RETURNING id
          `);
          rowsAffected = updated.length;
        } else {
          const updated = await this.sql.query(
            `
            UPDATE ${this.tableName}
            SET status = $1
            WHERE id = $2
            RETURNING id
          `,
            [status, id]
          );
          rowsAffected = updated.rows?.length || 0;
        }
    }

    return rowsAffected > 0;
  }

  async getNextPendingJob(): Promise<QueueItem | undefined> {
    // Use FOR UPDATE SKIP LOCKED for atomic job fetching
    // Both Bun and postgres support this PostgreSQL feature
    const rows = await this.sql.unsafe(`
      SELECT
        id, payload, status, worker_id, result, error,
        requested_at, started_at, completed_at, last_updated
      FROM ${this.tableName}
      WHERE status = 'pending'
      ORDER BY priority DESC, requested_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (rows.length === 0) {
      return undefined;
    }

    const job = rows[0];

    // Mark as processing
    await this.sql.unsafe(`
      UPDATE ${this.tableName}
      SET status = 'processing'
      WHERE id = '${job.id}'
    `);

    return this.mapRowToQueueItem(job);
  }

  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        SELECT
          id, payload, status, worker_id, result, error,
          requested_at, started_at, completed_at, last_updated
        FROM ${this.tableName}
        WHERE status = '${status}'
        ORDER BY requested_at DESC
        LIMIT 1000
      `);
    } else {
      result = await this.sql.query(
        `
        SELECT
          id, payload, status, worker_id, result, error,
          requested_at, started_at, completed_at, last_updated
        FROM ${this.tableName}
        WHERE status = $1
        ORDER BY requested_at DESC
        LIMIT 1000
      `,
        [status]
      );
    }

    const rows = result.rows || result;
    return rows.map((row: any) => this.mapRowToQueueItem(row));
  }

  async getStats(): Promise<QueueStats> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'processing') as processing,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM ${this.tableName}
      `);
    } else {
      result = await this.sql.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'processing') as processing,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM ${this.tableName}
      `);
    }

    const row = result.rows?.[0] || result[0];
    return {
      total: parseInt(row.total),
      pending: parseInt(row.pending),
      processing: parseInt(row.processing),
      completed: parseInt(row.completed),
      failed: parseInt(row.failed),
    };
  }

  async hasPendingJobs(): Promise<boolean> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        SELECT EXISTS (
          SELECT 1 FROM ${this.tableName}
          WHERE status = 'pending'
          LIMIT 1
        ) as has_pending
      `);
    } else {
      result = await this.sql.query(`
        SELECT EXISTS (
          SELECT 1 FROM ${this.tableName}
          WHERE status = 'pending'
          LIMIT 1
        ) as has_pending
      `);
    }

    return result.rows?.[0]?.has_pending || result[0]?.has_pending;
  }

  async hasProcessingJobs(): Promise<boolean> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        SELECT EXISTS (
          SELECT 1 FROM ${this.tableName}
          WHERE status = 'processing'
          LIMIT 1
        ) as has_processing
      `);
    } else {
      result = await this.sql.query(`
        SELECT EXISTS (
          SELECT 1 FROM ${this.tableName}
          WHERE status = 'processing'
          LIMIT 1
        ) as has_processing
      `);
    }

    return result.rows?.[0]?.has_processing || result[0]?.has_processing;
  }

  async isEmpty(): Promise<boolean> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        SELECT NOT EXISTS (
          SELECT 1 FROM ${this.tableName}
          WHERE status IN ('pending', 'processing')
          LIMIT 1
        ) as is_empty
      `);
    } else {
      result = await this.sql.query(`
        SELECT NOT EXISTS (
          SELECT 1 FROM ${this.tableName}
          WHERE status IN ('pending', 'processing')
          LIMIT 1
        ) as is_empty
      `);
    }

    return result.rows?.[0]?.is_empty || result[0]?.is_empty;
  }

  async recoverStalledJobs(stalledTimeoutMs: number = 300000): Promise<number> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        UPDATE ${this.tableName}
        SET
          status = 'pending',
          worker_id = NULL,
          retry_count = retry_count + 1
        WHERE
          status = 'processing'
          AND last_updated < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
          AND retry_count < max_retries
        RETURNING id
      `);
    } else {
      // Node.js pg requires interval to be passed as a parameter
      result = await this.sql.query(`
        UPDATE ${this.tableName}
        SET
          status = 'pending',
          worker_id = NULL,
          retry_count = retry_count + 1
        WHERE
          status = 'processing'
          AND last_updated < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
          AND retry_count < max_retries
        RETURNING id
      `);
    }

    const rowCount = result.rows?.length || result.length || 0;

    if (rowCount > 0 && this.enableNotifications) {
      const jobIds = result.rows
        ? result.rows.map((r: any) => r.id)
        : result.map((r: any) => r.id);
      this.eventEmitter.emit("jobs-recovered", {
        count: rowCount,
        jobIds,
      });
    }

    return rowCount;
  }

  async getStalledJobs(
    stalledTimeoutMs: number = 300000
  ): Promise<QueueItem[]> {
    let result;
    if (isBunEnvironment) {
      result = await this.sql.unsafe(`
        SELECT
          id, payload, status, worker_id, result, error,
          requested_at, started_at, completed_at, last_updated
        FROM ${this.tableName}
        WHERE
          status = 'processing'
          AND last_updated < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
        ORDER BY last_updated ASC
      `);
    } else {
      // Node.js pg requires interval to be passed as a parameter
      result = await this.sql.query(`
        SELECT
          id, payload, status, worker_id, result, error,
          requested_at, started_at, completed_at, last_updated
        FROM ${this.tableName}
        WHERE
          status = 'processing'
          AND last_updated < NOW() - INTERVAL '${stalledTimeoutMs} milliseconds'
        ORDER BY last_updated ASC
      `);
    }

    const rows = result.rows || result;
    return rows.map((row: any) => this.mapRowToQueueItem(row));
  }

  async cleanup(): Promise<number> {
    if (this.enableTimescaleDB) {
      // For TimescaleDB, rely on retention policies but still clean up manually if needed
      // The retention policy will automatically drop old chunks
      console.log("TimescaleDB retention policy handles automatic cleanup");
      return 0;
    }

    let rows;
    if (isBunEnvironment) {
      rows = await this.sql.unsafe(`
        DELETE FROM ${this.tableName}
        WHERE
          status IN ('completed', 'failed')
          AND completed_at < NOW() - INTERVAL '${this.retentionDays} days'
        RETURNING id
      `);
    } else {
      rows = await this.sql.query(`
        DELETE FROM ${this.tableName}
        WHERE
          status IN ('completed', 'failed')
          AND completed_at < NOW() - INTERVAL '${this.retentionDays} days'
        RETURNING id
      `);
    }

    const rowCount = rows?.rows?.length || rows?.length || 0;

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
        // Both Bun and postgres need explicit closing
        await this.notificationConnection.end();
        this.notificationConnection = null;
      } catch (err) {
        console.error("Error closing notification connection:", err);
      }
    }

    // Close main connection
    if (this.sql) {
      await this.sql.end();
    }

    this.isInitialized = false;
    console.log("PostgreSQLQueue shutdown complete");
  }

  /**
   * Batch add jobs for better performance
   */
  async batchAddJobs(
    jobs: Array<{ payload: JobPayload; customId?: string }>
  ): Promise<string[]> {
    const ids: string[] = [];

    for (const job of jobs) {
      const id = job.customId || ulid();
      ids.push(id);

      if (isBunEnvironment) {
        await this.sql`
          INSERT INTO ${this.tableName} (id, payload, status, requested_at)
          VALUES (${id}, ${JSON.stringify(job.payload)}, ${
          JobStatus.PENDING
        }, NOW())
        `;
      } else {
        await this.sql.query(
          `
          INSERT INTO ${this.tableName} (id, payload, status, requested_at)
          VALUES ($1, $2, $3, NOW())
        `,
          [id, JSON.stringify(job.payload), JobStatus.PENDING]
        );
      }
    }

    return ids;
  }

  /**
   * Get jobs for a specific worker
   */
  async getJobsByWorker(workerId: number): Promise<QueueItem[]> {
    let rows;
    if (isBunEnvironment) {
      rows = await this.sql.unsafe(`
        SELECT
          id, payload, status, worker_id, result, error,
          requested_at, started_at, completed_at, last_updated
        FROM ${this.tableName}
        WHERE worker_id = ${workerId}
        ORDER BY last_updated DESC
        LIMIT 100
      `);
    } else {
      rows = await this.sql.query(
        `
        SELECT
          id, payload, status, worker_id, result, error,
          requested_at, started_at, completed_at, last_updated
        FROM ${this.tableName}
        WHERE worker_id = $1
        ORDER BY last_updated DESC
        LIMIT 100
      `,
        [workerId]
      );
    }

    const resultRows = rows.rows || rows;
    return resultRows.map((row: any) => this.mapRowToQueueItem(row));
  }

  /**
   * Update job priority
   */
  async updateJobPriority(jobId: string, priority: number): Promise<boolean> {
    let rows;
    if (isBunEnvironment) {
      rows = await this.sql.unsafe(`
        UPDATE ${this.tableName}
        SET priority = ${priority}
        WHERE id = '${jobId}' AND status = 'pending'
        RETURNING id
      `);
    } else {
      rows = await this.sql.query(
        `
        UPDATE ${this.tableName}
        SET priority = $1
        WHERE id = $2 AND status = 'pending'
        RETURNING id
      `,
        [priority, jobId]
      );
    }

    return rows.rows?.length > 0 || rows.length > 0 ? true : false;
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
