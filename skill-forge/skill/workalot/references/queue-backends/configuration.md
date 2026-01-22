# Queue Backends Configuration

## SQLite Backend Config

### Full Config Schema

```typescript
interface SQLiteQueueConfig extends QueueConfig {
  databaseUrl?: string; // "./queue.db" or "memory://"
  debug?: boolean; // Enable debug logging
  migrationsPath?: string; // Path to migration files
  autoMigrate?: boolean; // Auto-run migrations (default: true)
  enableWAL?: boolean; // Enable WAL mode (default: true)
}
```

### WAL Mode Configuration

WAL (Write-Ahead Logging) enables concurrent reads and writes:

```typescript
const queue = new SQLiteQueue({
  databaseUrl: "./queue.db",
  enableWAL: true, // Enable WAL mode
});

// WAL mode enables:
// - Concurrent reads/writes
// - Better crash recovery
// - Reduced disk I/O
```

**Avoid WAL on**: Network filesystems (NFS, SMB), read-only media

### In-Memory SQLite

```typescript
const queue = new SQLiteQueue({
  databaseUrl: "memory://", // Use in-memory database
});

// Faster than file-based, but no persistence
// Perfect for tests or temporary processing
```

### Migration Path

```typescript
const queue = new SQLiteQueue({
  databaseUrl: "./queue.db",
  migrationsPath: "./migrations/sqlite", // Custom migration path
  autoMigrate: true, // Auto-run migrations
});
```

## PostgreSQL Backend Config

### Full Config Schema

```typescript
interface PostgreSQLQueueConfig extends QueueConfig {
  databaseUrl: string; // "postgresql://user:pass@host:5432/db"
  poolSize?: number; // Connection pool size (default: 20)
  enableListen?: boolean; // Enable LISTEN/NOTIFY (default: false)
  enablePartitioning?: boolean; // Enable table partitioning (default: false)
  ssl?: { rejectUnauthorized: boolean };
  enableTimescaleDB?: boolean; // Enable TimescaleDB features (default: false)
  chunkTimeInterval?: string; // Hypertable chunk interval (default: "1 hour")
  compressionInterval?: string; // Compression interval (default: "7 days")
  retentionInterval?: string; // Retention policy (default: "90 days")
}
```

### Connection Pool

```typescript
const queue = new PostgreSQLQueue({
  databaseUrl: process.env.DATABASE_URL,
  poolSize: 20, // 20 connections in pool
});

// Ensure pool size >= number of workers
// Default workers: os.cpus().length - 2
```

### LISTEN/NOTIFY

Real-time notifications for job updates:

```typescript
const queue = new PostgreSQLQueue({
  databaseUrl: "postgresql://...",
  enableListen: true, // Enable real-time notifications
});

// Benefits:
// - Instant job status updates
// - Reduced polling
// - Better scaling
```

### TimescaleDB Integration

Optimized for time-series job data:

```typescript
const queue = new PostgreSQLQueue({
  databaseUrl: "postgresql://...",
  enableTimescaleDB: true, // Convert to hypertable
  chunkTimeInterval: "1 hour", // Create new chunks every hour
  compressionInterval: "7 days", // Compress 7-day-old chunks
  retentionInterval: "90 days", // Drop 90-day-old data
});

// Results:
// - 70-90% storage reduction
// - Faster time-based queries
// - Automatic data lifecycle
```

## Redis Backend Config

### Full Config Schema

```typescript
interface RedisQueueConfig extends QueueConfig {
  databaseUrl: string; // "redis://host:6379"
  keyPrefix?: string; // Prefix for all keys (default: "workalot")
  completedJobTTL?: number; // Completed job TTL in ms (default: 86400)
  failedJobTTL?: number; // Failed job TTL in ms (default: 604800)
  enablePubSub?: boolean; // Enable pub/sub (default: false)
  tls?: { rejectUnauthorized: boolean };
}
```

### Key Prefix

```typescript
const queue = new RedisQueue({
  databaseUrl: "redis://...",
  keyPrefix: "myapp", // All keys prefixed with "myapp:"
});

// Keys: "myapp:jobs:pending", "myapp:jobs:processing", etc.
// Prevents key collisions in shared Redis
```

### TTL Configuration

```typescript
const queue = new RedisQueue({
  databaseUrl: "redis://...",
  completedJobTTL: 86400, // 24 hours for completed jobs
  failedJobTTL: 604800, // 7 days for failed jobs
});

// Jobs auto-expire after TTL
// Saves memory, prevents unbounded growth
```

### Pub/Sub

Real-time job notifications:

```typescript
const queue = new RedisQueue({
  databaseUrl: "redis://...",
  enablePubSub: true, // Enable Redis pub/sub
});

// Instant notifications for:
// - Job added
// - Job status changed
// - Worker status updates
```

### Upstash/Edge Configuration

```typescript
const queue = new RedisQueue({
  databaseUrl: process.env.UPSTASH_REDIS_URL,
  redisConfig: {
    tls: { rejectUnauthorized: false }, // Upstash requires TLS
  },
});

// Upstash provides:
// - Serverless Redis
// - Cloudflare Workers compatible
// - Edge deployment
```

## PGLite Backend Config

### Full Config Schema

```typescript
interface PGLiteQueueConfig extends QueueConfig {
  databaseUrl?: string; // Directory path or "memory://"
  memory?: boolean; // In-memory mode (default: false)
  relaxedDurability?: boolean; // Trade durability for speed (default: false)
  autoMigrate?: boolean; // Auto-run migrations (default: true)
  debug?: boolean;
}
```

### In-Memory Mode

```typescript
const queue = new PGLiteQueue({
  databaseUrl: "memory://", // In-memory WASM
  memory: true, // Explicit in-memory flag
});

// Benefits:
// - No disk I/O
// - Faster than disk-based
// - Still PostgreSQL-compatible
```

### Relaxed Durability

```typescript
const queue = new PGLiteQueue({
  databaseUrl: "./data/pglite",
  relaxedDurability: true, // Trade durability for speed
});

// Benefits:
// - 2-3x faster commits
// - Less disk I/O
// - Acceptable for caching/temporary data
```

## Memory Backend Config

### Full Config Schema

```typescript
interface MemoryQueueConfig extends QueueConfig {
  maxInMemoryAge?: number; // Job age before cleanup (default: 24 hours)
  persistenceFile?: string; // Persistence file (default: "queue-state.json")
  healthCheckInterval?: number; // Check interval in ms (default: 5000)
  silent?: boolean; // Reduce logging (default: false)
}
```

### Job Age Cleanup

```typescript
const queue = new MemoryQueue({
  maxInMemoryAge: 60 * 60 * 1000, // 1 hour
  persistenceFile: "./queue-state.json",
});

// Jobs older than 1 hour auto-cleaned
// Call queue.cleanup() to trigger manually
```

### Persistence File

```typescript
const queue = new MemoryQueue({
  persistenceFile: "./backup/queue-state.json",
});

// Queue state saved on shutdown
// Restored on next startup
// JSON format, human-readable
```
