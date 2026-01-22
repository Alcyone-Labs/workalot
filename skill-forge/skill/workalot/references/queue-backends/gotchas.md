# Queue Backends Gotchas

## SQLite-Specific Issues

### WAL Mode on Network Filesystem

**Problem**: SQLite WAL fails on NFS/SMB due to locking requirements.

**Symptoms**: `database is locked` errors, performance degradation

**Fix**:

```typescript
// Detect if database is on network filesystem
import { statSync } from "fs";

function isNetworkFS(path: string): boolean {
  // Simple check - in production, use more robust detection
  return path.startsWith("/mnt/") || path.startsWith("//");
}

const dbPath = "./queue.db";
const config: SQLiteQueueConfig = {
  databaseUrl: dbPath,
  enableWAL: !isNetworkFS(dbPath), // Disable WAL on network FS
};

const queue = new SQLiteQueue(config);
```

### Connection Busy Errors

**Problem**: Multiple concurrent writes exceed SQLite's single-writer limit.

**Symptoms**: `SQLITE_BUSY` errors

**Fix**:

```typescript
const queue = new SQLiteQueue({
  databaseUrl: "./queue.db",
  sqliteConfig: {
    walMode: true, // Enable WAL for concurrent reads
    busyTimeout: 5000, // Wait up to 5 seconds for locks
    synchronous: "NORMAL", // Less strict = better performance
  },
});
```

### Database File Growing Without Cleanup

**Problem**: Completed/failed jobs accumulate, disk usage grows.

**Symptoms**: Large queue.db file (>1GB), slow queries

**Fix**:

```typescript
// Run cleanup periodically
setInterval(async () => {
  const stats = await queue.getStats();

  if (stats.total > 10000) {
    const cleaned = await queue.cleanup();
    console.log(`Cleaned up ${cleaned} old jobs`);
  }
}, 60 * 60 * 1000); // Every hour

// Cleanup removes jobs older than maxInMemoryAge (default: 24 hours)
```

## PostgreSQL-Specific Issues

### Connection Pool Exhaustion

**Problem**: More workers than pool connections cause waits/timeouts.

**Symptoms**: Job queuing despite available workers, slow processing

**Fix**:

```typescript
const cpuCount = require("os").cpus().length - 2;

const manager = await createTaskManager("prod", {
  backend: "postgresql",
  maxThreads: cpuCount, // Limit workers
  postgresConfig: {
    poolSize: cpuCount * 2, // Pool > workers
  },
});
```

### LISTEN/NOTIFY Not Receiving Events

**Problem**: Real-time notifications not firing.

**Symptoms**: Worker polling instead of instant updates

**Fix**:

```typescript
const queue = new PostgreSQLQueue({
  databaseUrl: "postgresql://...",
  enableListen: true, // Enable LISTEN/NOTIFY
});

// Ensure connection supports notifications
// Check PostgreSQL logs for LISTEN errors
// Test with: SELECT pg_notify('job_update', 'test');
```

### TimescaleDB Hypertable Creation Failure

**Problem**: Hypertable conversion fails on existing data.

**Symptoms**: `cannot create hypertable` errors

**Fix**:

```typescript
// Create TimescaleDB tables on empty database
async function enableTimescaleDBSafely(queue: PostgreSQLQueue): Promise<void> {
  const stats = await queue.getStats();

  if (stats.total === 0) {
    // Safe to enable on empty database
    await queue.shutdown();

    const timescaleQueue = new PostgreSQLQueue({
      databaseUrl: process.env.DATABASE_URL,
      enableTimescaleDB: true,
    });

    await timescaleQueue.initialize();
  } else {
    console.warn("Database not empty, manual TimescaleDB migration required");
  }
}
```

## Redis-Specific Issues

### Memory Pressure from Large Payloads

**Problem**: Large job payloads (>1MB) cause Redis memory spikes.

**Symptoms**: High memory usage, slow operations

**Fix**:

```typescript
// Store large payloads externally
async function scheduleWithExternalPayload(
  queue: RedisQueue,
  jobFile: string,
  largePayload: any
): Promise<string> {
  // Store large payload in S3/filesystem
  const payloadRef = await storeExternal(largePayload);

  // Queue job with reference
  return await queue.addJob({
    jobFile,
    jobPayload: { _ref: payloadRef, _size: JSON.stringify(largePayload).length },
  });
}

async function loadExternalPayload(payloadRef: string): Promise<any> {
  return await retrieveExternal(payloadRef);
}
```

### PUB/SUB Connection Loss

**Problem**: Pub/sub connection drops, notifications stop.

**Symptoms**: Workers stop receiving jobs, queue appears empty

**Fix**:

```typescript
class ResilientRedisQueue extends RedisQueue {
  private reconnectInterval?: NodeJS.Timeout;

  async initialize(): Promise<void> {
    await super.initialize();

    // Start ping/pong to detect connection loss
    this.reconnectInterval = setInterval(async () => {
      try {
        await this.ping();
      } catch (error) {
        console.warn("Redis connection lost, reconnecting...", error);
        await this.shutdown();
        await this.initialize();
      }
    }, 5000); // Every 5 seconds
  }

  async ping(): Promise<void> {
    // Implementation specific to Redis client
    // Send PING command
  }

  async shutdown(): Promise<void> {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    await super.shutdown();
  }
}
```

### Key Collisions in Shared Redis

**Problem**: Multiple apps use same Redis, keys collide.

**Symptoms**: Jobs appearing in wrong queue, unexpected failures

**Fix**:

```typescript
const queue = new RedisQueue({
  databaseUrl: process.env.REDIS_URL,
  redisConfig: {
    keyPrefix: `myapp-${process.env.NODE_ENV || "dev"}`, // Unique prefix
  },
});

// Keys: "myapp-prod:jobs:pending", "myapp-prod:jobs:processing"
```

## PGLite-Specific Issues

### Slow Startup Time

**Problem**: WASM compilation takes 1-2 seconds on first load.

**Symptoms**: Application hangs on startup

**Fix**:

```typescript
// Warm up PGLite during initialization
async function initializePGLiteWithWarmup(): Promise<PGLiteQueue> {
  console.log("Initializing PGLite (WASM compilation, this may take a moment)...");

  const queue = new PGLiteQueue({
    databaseUrl: "./data/pglite",
  });

  await queue.initialize();

  // Warm up with simple query
  await queue.getStats();

  console.log("PGLite ready");

  return queue;
}
```

### High Memory Usage

**Problem**: PGLite uses more memory than SQLite for same data.

**Symptoms**: High memory footprint, OOM errors

**Fix**:

```typescript
// Use in-memory mode only when necessary
const config = {
  databaseUrl: process.env.USE_IN_MEMORY ? "memory://" : "./data/pglite",
  memory: process.env.USE_IN_MEMORY || false,
};

// If running on resource-constrained environment, use SQLite instead
if (process.env.LOW_MEMORY) {
  const queue = new SQLiteQueue({ databaseUrl: "./queue.db" });
} else {
  const queue = new PGLiteQueue(config);
}
```

## Backend-Switching Issues

### Incompatible Schemas

**Problem**: Different backends have different features/constraints.

**Symptoms**: Jobs fail after backend change, data loss

**Fix**:

```typescript
// Validate queue config before switching
async function validateBackendCompatibility(
  oldBackend: string,
  newBackend: string
): Promise<boolean> {
  const features = {
    memory: { priority: false, scheduling: true },
    sqlite: { priority: true, scheduling: true },
    postgresql: { priority: true, scheduling: true, timeseries: true },
    redis: { priority: true, scheduling: true, pubsub: true },
  };

  const oldFeatures = features[oldBackend as keyof typeof features];
  const newFeatures = features[newBackend as keyof typeof features];

  // Check if jobs use features not supported by new backend
  for (const feature of Object.keys(oldFeatures)) {
    if (!newFeatures[feature as keyof typeof newFeatures]) {
      console.warn(
        `New backend doesn't support ${feature}, jobs using it will fail`
      );
      return false;
    }
  }

  return true;
}
```

### Missing Dependencies

**Problem**: Backend dependencies not installed.

**Symptoms**: `Cannot find module 'better-sqlite3'`, `Cannot find module 'postgres'`

**Fix**:

```typescript
// Package.json
{
  "dependencies": {
    "@alcyone-labs/workalot": "^2.0.0"
  },
  "optionalDependencies": {
    // SQLite (Node.js only, Bun has built-in)
    "better-sqlite3": "^12.6.2",
    // PostgreSQL
    "postgres": "^3.4.8",
    // PGLite
    "@electric-sql/pglite": "^0.3.15",
    // Redis
    "ioredis": "^5.9.2"
  }
}

// Workalot will fail gracefully if backend dependency missing
```

## Migration Issues

### Data Loss During Migration

**Problem**: Migrating backends without draining queue.

**Symptoms**: Jobs in old backend lost after switch

**Fix**:

```typescript
async function safeBackendMigration(
  oldQueue: IQueueBackend,
  newQueue: IQueueBackend
): Promise<void> {
  // 1. Stop accepting new jobs to old queue
  // 2. Wait for old queue to empty
  let stats = await oldQueue.getStats();
  while (stats.pending > 0 || stats.processing > 0) {
    console.log(`Waiting for old queue to drain: ${stats.pending} pending, ${stats.processing} processing`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    stats = await oldQueue.getStats();
  }

  console.log("Old queue drained, migrating...");

  // 3. Migrate any completed jobs to new queue if needed
  const completed = await oldQueue.getJobsByStatus(JobStatus.COMPLETED);
  for (const job of completed) {
    // Copy to new queue
    await newQueue.addJob(job.jobPayload, job.id);
  }

  // 4. Shutdown old queue
  await oldQueue.shutdown();

  console.log("Migration complete");
}
```
