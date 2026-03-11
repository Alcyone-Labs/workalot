-- TimescaleDB Hypertable Migration
-- Converts workalot_jobs table to hypertable for efficient time-series data handling

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Check if table is already a hypertable to avoid errors
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'workalot_jobs'
    ) THEN
        -- First, drop all existing indexes to avoid conflicts
        DROP INDEX IF EXISTS idx_workalot_jobs_status;
        DROP INDEX IF EXISTS idx_workalot_jobs_status_priority;
        DROP INDEX IF EXISTS idx_workalot_jobs_scheduled_for;
        DROP INDEX IF EXISTS idx_workalot_jobs_worker_id;
        DROP INDEX IF EXISTS idx_workalot_jobs_requested_at;
        DROP INDEX IF EXISTS idx_workalot_jobs_completed_at;
        DROP INDEX IF EXISTS idx_workalot_jobs_tags;
        DROP INDEX IF EXISTS idx_workalot_jobs_payload;
        DROP INDEX IF EXISTS idx_workalot_jobs_active;
        
        -- Modify primary key to include partitioning column (required by TimescaleDB)
        -- Drop existing primary key constraint
        ALTER TABLE workalot_jobs DROP CONSTRAINT IF EXISTS workalot_jobs_pkey;

        -- Add composite primary key that includes the partitioning column
        ALTER TABLE workalot_jobs ADD CONSTRAINT workalot_jobs_pkey PRIMARY KEY (id, requested_at);

        -- Convert workalot_jobs table to hypertable partitioned by requested_at (1 hour chunks)
        -- This enables automatic partitioning and optimized time-based queries
        SELECT create_hypertable('workalot_jobs', 'requested_at', chunk_time_interval => INTERVAL '1 hour');

        -- Enable columnstore (compression) on the hypertable
        -- This significantly reduces storage space for historical data
        ALTER TABLE workalot_jobs SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'status',
            timescaledb.compress_orderby = 'requested_at DESC'
        );

        -- Set up compression policy for old data (compress chunks older than 7 days)
        SELECT add_compression_policy('workalot_jobs', INTERVAL '7 days');

        -- Set up retention policy (drop data older than 90 days)
        -- Adjust this interval based on your data retention requirements
        SELECT add_retention_policy('workalot_jobs', INTERVAL '90 days');
    END IF;
END $$;

-- Create additional indexes optimized for TimescaleDB
CREATE INDEX IF NOT EXISTS idx_workalot_jobs_time_status ON workalot_jobs (requested_at DESC, status)
WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_workalot_jobs_time_completed ON workalot_jobs (completed_at DESC)
WHERE completed_at IS NOT NULL;

-- Create continuous aggregates for job statistics (optional but recommended)
-- This provides fast access to aggregated metrics over time
-- Check if the view already exists to avoid errors
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_matviews WHERE matviewname = 'workalot_job_stats_hourly'
    ) THEN
        CREATE MATERIALIZED VIEW workalot_job_stats_hourly
        WITH (timescaledb.continuous) AS
        SELECT
            time_bucket('1 hour', requested_at) AS bucket,
            COUNT(*) as total_jobs,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
            AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL) as avg_processing_time
        FROM workalot_jobs
        GROUP BY bucket
        WITH NO DATA;

        -- Enable automatic refresh for continuous aggregates
        SELECT add_continuous_aggregate_policy('workalot_job_stats_hourly',
            start_offset => INTERVAL '3 hours',
            end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour');

        -- Create retention policy for continuous aggregates (keep 1 year of hourly stats)
        SELECT add_retention_policy('workalot_job_stats_hourly', INTERVAL '1 year');
    END IF;
END $$;

-- Insert migration record
INSERT INTO schema_migrations (version, description)
VALUES (2, 'Convert workalot_jobs table to TimescaleDB hypertable with compression and retention policies')
ON CONFLICT (version) DO NOTHING;