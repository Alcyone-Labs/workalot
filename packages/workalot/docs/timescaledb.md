# TimescaleDB Setup for Workalot

This guide explains how to set up and use TimescaleDB with Workalot for optimized time-series job processing.

## Overview

TimescaleDB is a PostgreSQL extension that provides time-series optimizations including:
- **Hypertables**: Automatic partitioning of data by time
- **Compression**: 70-90% storage reduction for historical data
- **Retention Policies**: Automatic cleanup of old data
- **Time-based Indexing**: Optimized queries for time-series data

## Prerequisites

1. **Docker** (recommended for easy setup)
2. **TimescaleDB** (PostgreSQL with TimescaleDB extension)

## Quick Start with Docker

### 1. Start TimescaleDB

```bash
# Start the TimescaleDB container
docker-compose up -d

# Or manually:
docker run -d \
  --name timescaledb \
  -p 5432:5432 \
  -e POSTGRES_DB=workalot \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  timescale/timescaledb:latest-pg16
```

### 2. Configure Workalot

```typescript
import { initializeTaskManager } from "@alcyone-labs/workalot";

const config = {
  backend: "postgresql",
  host: "localhost",
  port: 5432,
  database: "workalot",
  user: "postgres",
  password: "password",

  // Enable TimescaleDB features
  enableTimescaleDB: true,

  // Hypertable configuration
  chunkTimeInterval: "1 hour",    // New partition every hour
  compressionInterval: "7 days",  // Compress data older than 7 days
  retentionInterval: "90 days",   // Keep data for 90 days

  maxThreads: 4,
};

await initializeTaskManager(config);
```

### 3. Run the Example

```bash
# Install dependencies
pnpm install

# Run the TimescaleDB example
pnpm tsx examples/timescaledb-example.ts
```

## Configuration Options

### Hypertable Settings

| Option | Description | Default | Example |
|--------|-------------|---------|---------|
| `chunkTimeInterval` | Time interval for creating new partitions | `"1 hour"` | `"30 minutes"`, `"1 day"` |
| `compressionInterval` | Age threshold for data compression | `"7 days"` | `"1 day"`, `"30 days"` |
| `retentionInterval` | Age threshold for data deletion | `"90 days"` | `"30 days"`, `"1 year"` |

### Choosing Time Intervals

**Chunk Time Interval:**
- Smaller chunks (e.g., 1 hour): Better query performance, more partitions
- Larger chunks (e.g., 1 day): Fewer partitions, slightly slower queries

**Compression Interval:**
- Compress data that's no longer actively queried
- Typical: 7-30 days depending on access patterns

**Retention Interval:**
- Balance between data availability and storage costs
- Typical: 30-365 days depending on business requirements

## Performance Benefits

### Storage Efficiency
- **70-90% reduction** in storage space for historical data
- Automatic compression of old partitions
- Efficient handling of large time-series datasets

### Query Performance
- **Time-based partitioning** enables fast queries on recent data
- **Automatic indexing** on time columns
- **Parallel query execution** across partitions

### Maintenance
- **Automatic retention policies** prevent unbounded growth
- **Background compression** doesn't impact query performance
- **Partition management** handled automatically

## Monitoring and Maintenance

### Check Hypertable Status

```sql
-- View hypertable information
SELECT * FROM timescaledb_information.hypertables
WHERE table_name = 'workalot_jobs';

-- Check compression status
SELECT
  chunk_name,
  is_compressed,
  compression_status
FROM timescaledb_information.chunks
WHERE hypertable_name = 'workalot_jobs'
ORDER BY range_start DESC;
```

### Manual Operations

```sql
-- Manually compress old chunks
SELECT compress_chunk(chunk)
FROM show_chunks('workalot_jobs', INTERVAL '7 days') AS chunk
WHERE NOT chunk_is_compressed(chunk);

-- Check retention policy
SELECT * FROM timescaledb_information.jobs
WHERE proc_name = 'policy_retention';
```

## Troubleshooting

### Common Issues

1. **Extension not found**: Ensure TimescaleDB is properly installed
2. **Permission denied**: Check database user permissions
3. **Slow queries**: Adjust chunk size or add more indexes

### Performance Tuning

1. **Chunk size**: Smaller chunks for high-frequency data
2. **Compression timing**: Compress when data is no longer updated
3. **Retention policies**: Set based on actual data access patterns

## Production Considerations

### High Availability
- Use TimescaleDB's replication features
- Configure connection pooling
- Monitor disk space and compression jobs

### Backup and Recovery
- Include hypertable metadata in backups
- Test restoration procedures
- Consider continuous archiving for large datasets

### Scaling
- Horizontal scaling with TimescaleDB multi-node
- Connection pooling for high concurrency
- Monitor query performance and adjust partitioning

## Example Use Cases

### IoT Data Processing
```typescript
// Process sensor data with time-series optimization
const sensorConfig = {
  enableTimescaleDB: true,
  chunkTimeInterval: "1 hour",
  compressionInterval: "1 day",
  retentionInterval: "1 year",
};
```

### Financial Transactions
```typescript
// Handle high-volume transaction processing
const financeConfig = {
  enableTimescaleDB: true,
  chunkTimeInterval: "30 minutes",
  compressionInterval: "30 days",
  retentionInterval: "7 years", // Regulatory requirements
};
```

### Log Analytics
```typescript
// Efficient log storage and querying
const loggingConfig = {
  enableTimescaleDB: true,
  chunkTimeInterval: "1 day",
  compressionInterval: "90 days",
  retentionInterval: "2 years",
};
```

## Migration from Regular PostgreSQL

If you have existing data, you can migrate to TimescaleDB:

```sql
-- Convert existing table to hypertable
SELECT create_hypertable('workalot_jobs', 'requested_at', migrate_data => true);

-- Add compression policy
SELECT add_compression_policy('workalot_jobs', INTERVAL '7 days');

-- Add retention policy
SELECT add_retention_policy('workalot_jobs', INTERVAL '90 days');
```

## Support

For TimescaleDB-specific issues:
- [TimescaleDB Documentation](https://docs.timescale.com/)
- [TimescaleDB Community](https://www.timescale.com/community)

For Workalot integration issues:
- Check the main Workalot documentation
- Review PostgreSQL queue configuration