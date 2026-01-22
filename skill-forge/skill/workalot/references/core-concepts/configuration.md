# Core Concepts Configuration

## QueueConfig Schema

```typescript
interface QueueConfig {
  // Backend selection
  backend?: "memory" | "sqlite" | "pglite" | "postgresql" | "redis";

  // Database connection
  databaseUrl?: string;

  // Worker configuration
  maxThreads?: number;

  // Persistence
  persistenceFile?: string;
  maxInMemoryAge?: number;

  // Monitoring
  healthCheckInterval?: number;

  // Logging
  silent?: boolean;

  // Job recovery
  jobRecoveryEnabled?: boolean;

  // PostgreSQL-specific
  postgresConfig?: {
    poolSize?: number;
    enableListen?: boolean;
    enablePartitioning?: boolean;
    ssl?: { rejectUnauthorized: boolean };
  };

  // SQLite-specific
  sqliteConfig?: {
    walMode?: boolean;
    busyTimeout?: number;
    synchronous?: "OFF" | "NORMAL" | "FULL";
  };

  // PGLite-specific
  pgliteConfig?: {
    memory?: boolean;
    relaxedDurability?: boolean;
  };

  // Redis-specific
  redisConfig?: {
    keyPrefix?: string;
    completedJobTTL?: number;
    failedJobTTL?: number;
    enablePubSub?: boolean;
    tls?: { rejectUnauthorized: boolean };
  };

  // TimescaleDB-specific
  enableTimescaleDB?: boolean;
  chunkTimeInterval?: string;
  compressionInterval?: string;
  retentionInterval?: string;
}
```

## Default Values

- `backend`: "memory"
- `maxThreads`: `os.cpus().length - 2`
- `healthCheckInterval`: 5000ms
- `silent`: false
- `jobRecoveryEnabled`: true
- `maxInMemoryAge`: 24 * 60 * 60 * 1000 (24 hours)

## Environment Variables

Use environment variables for sensitive configuration:

```bash
# PostgreSQL
DATABASE_URL="postgresql://user:pass@localhost:5432/db"

# Redis
REDIS_URL="redis://localhost:6379"
UPSTASH_REDIS_URL="redis://user:pass@host"

# SQLite
SQLITE_DB_PATH="./data/queue.db"

# Worker config
MAX_WORKERS=8
HEALTH_CHECK_INTERVAL=60000
```

## Factory Presets Configuration

```typescript
import { TaskManagerFactoryPresets } from "#/index.js";

// Development preset
const devConfig = {
  backend: "memory",
  maxThreads: 2,
  jobRecoveryEnabled: false,
};

// Production SQLite preset
const prodSQLiteConfig = {
  backend: "sqlite",
  databaseUrl: "./prod.db",
  maxThreads: undefined, // System default
  jobRecoveryEnabled: true,
  sqliteConfig: {
    walMode: true,
    synchronous: "NORMAL",
  },
};

// Production PostgreSQL preset
const prodPGConfig = {
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
  postgresConfig: {
    poolSize: 20,
    enableListen: true,
    enablePartitioning: true,
  },
  enableTimescaleDB: true,
  chunkTimeInterval: "1 hour",
  compressionInterval: "7 days",
  retentionInterval: "90 days",
};
```

## Worker Configuration

```typescript
// SimpleWorker config
new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
  defaultTimeout: 30000, // 30 second default
})

// WorkerManager config (local threads)
new WorkerManager(orchestrator, {
  numWorkers: 4,
  projectRoot: process.cwd(),
})
```

## Orchestrator Configuration

```typescript
// SimpleOrchestrator config
new SimpleOrchestrator({
  wsPort: 8080,
  wsHostname: "0.0.0.0", // Bind to all interfaces
  distributionStrategy: "round-robin", // or "random"
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./orchestrator.db",
    jobRecoveryEnabled: true,
  },
})
```
