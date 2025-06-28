-- Initial schema for PGLite job queue
-- Optimized for high-performance job processing with proper indexing

-- Note: PGLite doesn't support uuid-ossp extension, so we'll use TEXT IDs

-- Job status enum
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Main jobs table
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    job_payload JSONB NOT NULL,
    status job_status NOT NULL DEFAULT 'pending',
    
    -- Timestamps
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Job execution details
    worker_id INTEGER,
    result JSONB,
    error_message TEXT,
    error_stack TEXT,
    
    -- Retry and timeout handling
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER,
    
    -- Priority and scheduling
    priority INTEGER NOT NULL DEFAULT 0,
    scheduled_for TIMESTAMPTZ,
    
    -- Metadata
    created_by TEXT,
    tags TEXT[],
    
    -- Constraints
    CONSTRAINT jobs_status_timestamps_check CHECK (
        (status = 'pending' AND started_at IS NULL AND completed_at IS NULL) OR
        (status = 'processing' AND started_at IS NOT NULL AND completed_at IS NULL) OR
        (status IN ('completed', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
    ),
    CONSTRAINT jobs_retry_count_check CHECK (retry_count >= 0 AND retry_count <= max_retries),
    CONSTRAINT jobs_priority_check CHECK (priority >= 0)
);

-- Indexes for optimal performance
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_status_priority ON jobs (status, priority DESC, requested_at ASC) WHERE status = 'pending';
CREATE INDEX idx_jobs_scheduled_for ON jobs (scheduled_for) WHERE scheduled_for IS NOT NULL AND status = 'pending';
CREATE INDEX idx_jobs_worker_id ON jobs (worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX idx_jobs_requested_at ON jobs (requested_at);
CREATE INDEX idx_jobs_completed_at ON jobs (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_jobs_tags ON jobs USING GIN (tags) WHERE tags IS NOT NULL;
CREATE INDEX idx_jobs_payload ON jobs USING GIN (job_payload);

-- Partial indexes for common queries
CREATE INDEX idx_jobs_active ON jobs (last_updated) WHERE status IN ('pending', 'processing');
-- Note: Removed time-based index predicate as PGLite requires IMMUTABLE functions

-- Function to automatically update last_updated timestamp
CREATE OR REPLACE FUNCTION update_last_updated_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update last_updated
CREATE TRIGGER update_jobs_last_updated 
    BEFORE UPDATE ON jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_last_updated_column();

-- Function to get next pending job with row locking
CREATE OR REPLACE FUNCTION get_next_pending_job(worker_id_param INTEGER DEFAULT NULL)
RETURNS TABLE (
    id TEXT,
    job_payload JSONB,
    status job_status,
    requested_at TIMESTAMPTZ,
    priority INTEGER,
    scheduled_for TIMESTAMPTZ,
    timeout_ms INTEGER,
    retry_count INTEGER,
    max_retries INTEGER
) AS $$
DECLARE
    job_record RECORD;
BEGIN
    -- Get the next pending job with highest priority, respecting scheduled_for
    SELECT j.id, j.job_payload, j.status, j.requested_at, j.priority, 
           j.scheduled_for, j.timeout_ms, j.retry_count, j.max_retries
    INTO job_record
    FROM jobs j
    WHERE j.status = 'pending'
      AND (j.scheduled_for IS NULL OR j.scheduled_for <= NOW())
    ORDER BY j.priority DESC, j.requested_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    -- If we found a job, update it to processing status
    IF FOUND THEN
        UPDATE jobs 
        SET status = 'processing',
            started_at = NOW(),
            worker_id = worker_id_param
        WHERE jobs.id = job_record.id;
        
        -- Return the job details
        RETURN QUERY SELECT 
            job_record.id,
            job_record.job_payload,
            'processing'::job_status,
            job_record.requested_at,
            job_record.priority,
            job_record.scheduled_for,
            job_record.timeout_ms,
            job_record.retry_count,
            job_record.max_retries;
    END IF;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old jobs
CREATE OR REPLACE FUNCTION cleanup_old_jobs(older_than_hours INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM jobs 
    WHERE status IN ('completed', 'failed') 
      AND completed_at < NOW() - (older_than_hours || ' hours')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create a view for job statistics
CREATE VIEW job_stats AS
SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'processing') as processing,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    MIN(requested_at) FILTER (WHERE status = 'pending') as oldest_pending
FROM jobs;

-- Create notification triggers for job status changes
CREATE OR REPLACE FUNCTION notify_job_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify on status changes
    IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        PERFORM pg_notify('job_status_changed', json_build_object(
            'job_id', NEW.id,
            'old_status', OLD.status,
            'new_status', NEW.status,
            'worker_id', NEW.worker_id
        )::text);
    END IF;
    
    -- Notify on new jobs
    IF TG_OP = 'INSERT' THEN
        PERFORM pg_notify('job_added', json_build_object(
            'job_id', NEW.id,
            'status', NEW.status,
            'priority', NEW.priority
        )::text);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers for notifications
CREATE TRIGGER job_status_change_notify
    AFTER INSERT OR UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_job_status_change();

-- Schema version tracking
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT
);

-- Insert initial migration record
INSERT INTO schema_migrations (version, description) 
VALUES (1, 'Initial schema with jobs table, indexes, and functions');
