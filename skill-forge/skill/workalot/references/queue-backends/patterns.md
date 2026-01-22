# Queue Backends Patterns

## Backend Switching Pattern

Swap backends without code changes:

```typescript
function getQueueConfig(): QueueConfig {
  const backend = process.env.DB_TYPE || "memory";

  const baseConfig = {
    maxThreads: 8,
    jobRecoveryEnabled: true,
  };

  switch (backend) {
    case "sqlite":
      return {
        ...baseConfig,
        backend: "sqlite",
        databaseUrl: "./queue.db",
        sqliteConfig: { walMode: true },
      };

    case "postgresql":
      return {
        ...baseConfig,
        backend: "postgresql",
        databaseUrl: process.env.DATABASE_URL!,
        postgresConfig: {
          poolSize: 20,
          enableListen: true,
        },
      };

    case "redis":
      return {
        ...baseConfig,
        backend: "redis",
        databaseUrl: process.env.REDIS_URL!,
        redisConfig: {
          keyPrefix: "myapp",
          enablePubSub: true,
        },
      };

    default:
      return {
        ...baseConfig,
        backend: "memory",
      };
  }
}

const manager = await createTaskManager("main", getQueueConfig());
```

## Backend Migration Pattern

Migrate from Memory to SQLite with zero downtime:

```typescript
// 1. Start SQLite backend (doesn't affect Memory)
const sqliteManager = await createTaskManager("sqlite-backup", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
});

// 2. Drain Memory backend
const memoryManager = await createTaskManager("memory", {
  backend: "memory",
});

await whenFreeWith(memoryManager, async () => {
  console.log("Memory backend drained");

  // 3. Switch to SQLite
  const sqliteManager = await createTaskManager("main", {
    backend: "sqlite",
    databaseUrl: "./queue.db",
  });

  console.log("Switched to SQLite backend");
});
```

## High-Availability Pattern

PostgreSQL with replication + Redis fallback:

```typescript
async function createHAResilientQueue(): Promise<TaskManager> {
  try {
    // Try PostgreSQL first
    return await createTaskManager("ha", {
      backend: "postgresql",
      databaseUrl: process.env.POSTGRES_URL!,
      postgresConfig: {
        poolSize: 10,
        connectionTimeoutMillis: 5000,
      },
    });
  } catch (postgresError) {
    console.warn("PostgreSQL unavailable, falling back to Redis", postgresError);
    return await createTaskManager("ha", {
      backend: "redis",
      databaseUrl: process.env.REDIS_URL!,
    });
  }
}
```

## Multi-Tier Storage Pattern

Hot (Memory) + Warm (SQLite) + Cold (PostgreSQL):

```typescript
// Hot tier: Fastest for active jobs
const hotQueue = new MemoryQueue({
  maxInMemoryAge: 5 * 60 * 1000, // 5 minutes
});

// Warm tier: Recent completed jobs
const warmQueue = new SQLiteQueue({
  databaseUrl: "./warm.db",
});

// Cold tier: Archive for long-term storage
const coldQueue = new PostgreSQLQueue({
  databaseUrl: process.env.ARCHIVE_DB_URL!,
});

// Move jobs between tiers
async function archiveOldJobs() {
  const completed = await hotQueue.getJobsByStatus(JobStatus.COMPLETED);
  for (const job of completed) {
    // Move to warm queue
    await warmQueue.addJob(job);
    // Remove from hot queue
    await hotQueue.cleanup();
  }

  // Archive warm queue to cold queue weekly
  // ... implementation
}
```

## Connection Pool Scaling Pattern

Dynamic pool sizing based on load:

```typescript
class ScalingPostgreSQLQueue extends PostgreSQLQueue {
  private basePoolSize: number = 10;
  private maxPoolSize: number = 50;

  async adjustPoolSize(): Promise<void> {
    const stats = await this.getStats();
    const loadPercentage = (stats.processing / this.basePoolSize) * 100;

    let newSize = this.basePoolSize;

    if (loadPercentage > 80) {
      newSize = Math.min(this.maxPoolSize, this.basePoolSize * 2);
    } else if (loadPercentage < 30) {
      newSize = Math.max(this.basePoolSize, this.basePoolSize / 2);
    }

    console.log(`Adjusting pool: ${loadPercentage}% load → ${newSize} connections`);
    // Reconnect with new pool size (implementation specific)
  }
}

// Check every 30 seconds
setInterval(() => scalingQueue.adjustPoolSize(), 30000);
```

## Redis Cluster Pattern

Distributed Redis for horizontal scaling:

```typescript
const redisNodes = [
  "redis://node1:6379",
  "redis://node2:6379",
  "redis://node3:6379",
];

// Distribute jobs across nodes
async function scheduleDistributed(job: JobRequest): Promise<string> {
  const nodeIndex = hash(job.jobId) % redisNodes.length;
  const nodeUrl = redisNodes[nodeIndex];

  const queue = new RedisQueue({ databaseUrl: nodeUrl });
  await queue.initialize();

  return await queue.addJob(job.jobPayload);
}

// Consistent hashing for job routing
function hash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
```

## Backup Pattern

SQLite WAL backup with zero downtime:

```typescript
import { execSync } from "child_process";

function backupSQLiteQueue(dbPath: string, backupPath: string): void {
  // 1. Run SQLite online backup
  execSync(`sqlite3 "${dbPath}" ".backup '${backupPath}'"`, {
    stdio: "inherit",
  });

  console.log(`Backup created: ${backupPath}`);

  // 2. Verify backup
  execSync(`sqlite3 "${backupPath}" "PRAGMA integrity_check;"`, {
    stdio: "inherit",
  });

  console.log("Backup verified");
}

// Run daily backups
setInterval(() => {
  const timestamp = new Date().toISOString().split("T")[0];
  backupSQLiteQueue("./queue.db", `./backups/queue-${timestamp}.db`);
}, 24 * 60 * 60 * 1000); // Daily
```

## Monitoring Pattern

Health checks for each backend type:

```typescript
interface QueueHealth {
  backend: string;
  healthy: boolean;
  latency: number;
  queueDepth: number;
  oldestJobAge?: number;
}

async function checkQueueHealth(queue: IQueueBackend): Promise<QueueHealth> {
  const start = Date.now();
  const stats = await queue.getStats();
  const latency = Date.now() - start;

  // Backend-specific checks
  let healthy = true;

  if (queue instanceof SQLiteQueue) {
    // Check WAL file health
    // ... implementation
  } else if (queue instanceof PostgreSQLQueue) {
    // Check connection pool status
    // ... implementation
  } else if (queue instanceof RedisQueue) {
    // Check Redis ping
    // ... implementation
  }

  return {
    backend: queue.constructor.name,
    healthy,
    latency,
    queueDepth: stats.pending + stats.processing,
    oldestJobAge: stats.oldestPending
      ? Date.now() - stats.oldestPending.getTime()
      : undefined,
  };
}
```

## Connection Retry Pattern

Exponential backoff for database connections:

```typescript
async function connectWithRetry<T>(
  connect: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await connect();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = baseDelay * Math.pow(2, attempt - 1);

      console.warn(
        `Connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`
      );

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Usage
const manager = await connectWithRetry(async () => {
  return await createTaskManager("main", {
    backend: "postgresql",
    databaseUrl: process.env.DATABASE_URL,
  });
});
```
