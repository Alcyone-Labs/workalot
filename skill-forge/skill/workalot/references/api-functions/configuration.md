# API Functions Configuration

## Basic Configuration

```typescript
const config: QueueConfig = {
  // Backend selection
  backend: "sqlite", // memory | sqlite | pglite | postgresql | redis

  // Database connection
  databaseUrl: "./queue.db", // SQLite: path, PostgreSQL: URL, Redis: URL

  // Worker configuration
  maxThreads: 4, // Default: os.cpus().length - 2

  // Job lifecycle
  maxInMemoryAge: 24 * 60 * 60 * 1000, // 24 hours (Memory only)
  jobRecoveryEnabled: true, // Enable stalled job recovery

  // Monitoring
  healthCheckInterval: 5000, // 5 seconds
  silent: false, // Reduce logging
};
```

## Factory Pattern Configuration

```typescript
import { TaskManagerFactory } from "#/index.js";

const factory = new TaskManagerFactory({
  backend: "sqlite",
  databaseUrl: "./queue.db",
  maxThreads: 4,
});

// Create multiple instances
const mainManager = await factory.create("main");
const priorityManager = await factory.create("priority");
const backgroundManager = await factory.create("background");

// Use each instance for different job types
```

## Singleton Configuration

```typescript
import { initializeTaskManager } from "#/index.js";

await initializeTaskManager({
  backend: "sqlite",
  databaseUrl: "./queue.db",
  maxThreads: 4,
});

// Singleton functions use this instance
// scheduleAndWait(), schedule(), getQueueStats(), whenFree(), shutdown()
```

## Environment-Based Configuration

```typescript
function getConfig(): QueueConfig {
  const env = process.env.NODE_ENV || "development";

  switch (env) {
    case "development":
      return {
        backend: "memory",
        maxThreads: 2,
        silent: false,
        jobRecoveryEnabled: false,
      };

    case "testing":
      return {
        backend: "memory",
        maxThreads: 1,
        silent: true,
        jobRecoveryEnabled: false,
      };

    case "production":
      return {
        backend: process.env.DB_TYPE || "sqlite",
        databaseUrl: process.env.DATABASE_URL || "./queue.db",
        maxThreads: undefined, // System default
        silent: true,
        jobRecoveryEnabled: true,
      };

    default:
      throw new Error(`Unknown environment: ${env}`);
  }
}

const manager = await createTaskManager("prod", getConfig());
```

## Timeout Configuration

```typescript
// Default timeout (5 seconds)
const result = await scheduleAndWait({
  jobFile: "jobs/SlowJob.ts",
  jobPayload: { iterations: 1000 },
});

// Custom timeout (30 seconds)
const result = await scheduleAndWait({
  jobFile: "jobs/SlowJob.ts",
  jobPayload: { iterations: 1000 },
  jobTimeout: 30000,
});
```

## Retry Configuration

```typescript
// Job recovery enabled (stalled jobs auto-recovered)
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
  jobRecoveryEnabled: true, // Checks for stalled jobs every 60 seconds
});
```

## Backend-Specific Configuration

### SQLite Configuration

```typescript
const config: QueueConfig = {
  backend: "sqlite",
  databaseUrl: "./queue.db",
  sqliteConfig: {
    walMode: true, // Better concurrency
    busyTimeout: 5000, // Wait for locks
    synchronous: "NORMAL", // Speed vs durability
  },
};
```

### PostgreSQL Configuration

```typescript
const config: QueueConfig = {
  backend: "postgresql",
  databaseUrl: "postgresql://user:pass@localhost:5432/db",
  postgresConfig: {
    poolSize: 20,
    enableListen: true, // Real-time notifications
    enablePartitioning: true, // Table partitioning
    ssl: { rejectUnauthorized: true },
  },
  enableTimescaleDB: false, // Or true for time-series optimization
};
```

### Redis Configuration

```typescript
const config: QueueConfig = {
  backend: "redis",
  databaseUrl: "redis://localhost:6379",
  redisConfig: {
    keyPrefix: "myapp",
    completedJobTTL: 86400, // 24 hours
    failedJobTTL: 604800, // 7 days
    enablePubSub: true, // Real-time notifications
    tls: { rejectUnauthorized: false },
  },
};
```

### Memory Configuration

```typescript
const config: QueueConfig = {
  backend: "memory",
  maxInMemoryAge: 60 * 60 * 1000, // 1 hour retention
  persistenceFile: "./queue-state.json", // Optional persistence file
};
```

## Worker Configuration

```typescript
const manager = await createTaskManager("main", {
  backend: "sqlite",
  maxThreads: 4, // 4 worker threads
  healthCheckInterval: 5000, // Health check every 5 seconds
});
```

## Monitoring Configuration

```typescript
const manager = await createTaskManager("main", {
  backend: "sqlite",
  silent: true, // Reduce logging for production
  healthCheckInterval: 10000, // Check every 10 seconds
});

// Monitor queue stats
setInterval(async () => {
  const stats = await getQueueStatsWith(manager);

  console.log("Queue:", stats.pending, "pending,", stats.processing, "processing");
}, 10000);
```

## Configuration Best Practices

### Development Environment

- Use Memory backend for speed
- Set `silent: false` for visibility
- Disable job recovery
- Use 2 worker threads for faster feedback

### Testing Environment

- Use Memory backend for isolation
- Set `silent: true` to reduce noise
- Use 1 worker thread for deterministic tests
- Disable job recovery
- Use factory pattern for fresh instances each test

### Production Environment

- Use SQLite/PostgreSQL for persistence
- Set `silent: true` to reduce logs
- Enable job recovery
- Use system default threads (`os.cpus().length - 2`)
- Configure connection pools for distributed backends
- Use environment variables for database URLs
- Enable health checks with 30-60 second intervals

### High-Throughput Scenarios

- Use Redis backend for maximum performance
- Use fire-and-forget pattern (`schedule()`)
- Maximize worker count
- Use batch operations where available
- Monitor queue depth to prevent overload

### Resource-Constrained Environments

- Reduce worker count
- Use SQLite instead of PostgreSQL/Redis (lower overhead)
- Increase job timeouts
- Disable health checks (set to 0)
- Use Memory backend if persistence not required
