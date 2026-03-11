-- Initial schema for SQLite job queue
-- Optimized for high-performance job processing with proper indexing
-- Adapted from PGLite schema for SQLite compatibility

-- Main jobs table
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    job_payload TEXT NOT NULL, -- JSON as TEXT in SQLite
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    
    -- Timestamps (using TEXT for ISO 8601 format)
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    last_updated TEXT NOT NULL DEFAULT (datetime('now')),
    
    -- Job execution details
    worker_id INTEGER,
    result TEXT, -- JSON as TEXT
    error_message TEXT,
    error_stack TEXT,
    
    -- Retry and timeout handling
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER,
    
    -- Priority and scheduling
    priority INTEGER NOT NULL DEFAULT 0,
    scheduled_for TEXT, -- ISO 8601 timestamp
    
    -- Metadata
    created_by TEXT,
    tags TEXT, -- JSON array as TEXT
    
    -- Constraints
    CHECK (
        (status = 'pending' AND started_at IS NULL AND completed_at IS NULL) OR
        (status = 'processing' AND started_at IS NOT NULL AND completed_at IS NULL) OR
        (status IN ('completed', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
    ),
    CHECK (retry_count >= 0 AND retry_count <= max_retries),
    CHECK (priority >= 0)
);

-- Indexes for optimal performance
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_status_priority ON jobs (status, priority DESC, requested_at ASC) WHERE status = 'pending';
CREATE INDEX idx_jobs_scheduled_for ON jobs (scheduled_for) WHERE scheduled_for IS NOT NULL AND status = 'pending';
CREATE INDEX idx_jobs_worker_id ON jobs (worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX idx_jobs_requested_at ON jobs (requested_at);
CREATE INDEX idx_jobs_completed_at ON jobs (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_jobs_active ON jobs (last_updated) WHERE status IN ('pending', 'processing');

-- Trigger to automatically update last_updated timestamp
CREATE TRIGGER update_jobs_last_updated 
    AFTER UPDATE ON jobs 
    FOR EACH ROW 
    BEGIN
        UPDATE jobs SET last_updated = datetime('now') WHERE id = NEW.id;
    END;

-- Schema version tracking
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);

-- Insert initial migration record
INSERT INTO schema_migrations (version, description) 
VALUES (1, 'Initial schema with jobs table, indexes, and triggers');
