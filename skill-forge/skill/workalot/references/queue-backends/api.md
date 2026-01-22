# Queue Backends API

## SQLite Queue API

```typescript
import { SQLiteQueue, SQLiteQueueConfig } from "#/queue/SQLiteQueue.js";

const queue = new SQLiteQueue({
  databaseUrl?: string; // "./queue.db" or "memory://"
  debug?: boolean;
  migrationsPath?: string;
  autoMigrate?: boolean; // Default: true
  enableWAL?: boolean; // Default: true
});

// Methods
await queue.initialize(): Promise<void>;
await queue.addJob(payload: JobPayload, customId?: string): Promise<string>;
await queue.getJob(id: string): Promise<QueueItem | undefined>;
await queue.updateJobStatus(id: string, status: JobStatus, result?: JobResult, error?: Error, workerId?: number): Promise<boolean>;
await queue.getNextPendingJob(): Promise<QueueItem | undefined>;
await queue.getNextPendingJobs(count: number): Promise<QueueItem[]>;
await queue.getJobsByStatus(status: JobStatus): Promise<QueueItem[]>;
await queue.getStats(): Promise<QueueStats>;
await queue.cleanup(): Promise<number>;
await queue.hasPendingJobs(): Promise<boolean>;
await queue.hasProcessingJobs(): Promise<boolean>;
await queue.isEmpty(): Promise<boolean>;
await queue.recoverStalledJobs(timeoutMs?: number): Promise<number>;
await queue.getStalledJobs(timeoutMs?: number): Promise<QueueItem[]>;
await queue.isIdle(): Promise<boolean>;
await queue.shutdown(): Promise<void>;
```

## PostgreSQL Queue API

```typescript
import { PostgreSQLQueue, PostgreSQLQueueConfig } from "#/queue/PostgreSQLQueue.js";

const queue = new PostgreSQLQueue({
  databaseUrl: string; // "postgresql://..."
  poolSize?: number; // Default: 20
  enableListen?: boolean; // Default: false
  enablePartitioning?: boolean; // Default: false
  ssl?: { rejectUnauthorized: boolean };
  enableTimescaleDB?: boolean; // Default: false
  chunkTimeInterval?: string; // "1 hour"
  compressionInterval?: string; // "7 days"
  retentionInterval?: string; // "90 days"
});

// Methods - same as SQLiteQueue
```

## Redis Queue API

```typescript
import { RedisQueue, RedisQueueConfig } from "#/queue/RedisQueue.js";

const queue = new RedisQueue({
  databaseUrl: string; // "redis://..."
  keyPrefix?: string; // Default: "workalot"
  completedJobTTL?: number; // Default: 86400 (24 hours)
  failedJobTTL?: number; // Default: 604800 (7 days)
  enablePubSub?: boolean; // Default: false
  tls?: { rejectUnauthorized: boolean };
});

// Methods - same as SQLiteQueue
```

## PGLite Queue API

```typescript
import { PGLiteQueue, PGLiteQueueConfig } from "#/queue/PGLiteQueue.js";

const queue = new PGLiteQueue({
  databaseUrl?: string; // Directory path or "memory://"
  memory?: boolean; // Default: false
  relaxedDurability?: boolean; // Default: false
  autoMigrate?: boolean; // Default: true
  debug?: boolean;
});

// Methods - same as SQLiteQueue
```

## Memory Queue API

```typescript
import { MemoryQueue, MemoryQueueConfig } from "#/queue/MemoryQueue.js";

const queue = new MemoryQueue({
  maxInMemoryAge?: number; // Default: 24 * 60 * 60 * 1000 (24 hours)
  persistenceFile?: string; // Default: "queue-state.json"
  healthCheckInterval?: number; // Default: 5000
  silent?: boolean; // Default: false
});

// Methods - same as SQLiteQueue
```

## QueueItem Interface

```typescript
interface QueueItem {
  id: string;
  jobPayload: JobPayload;
  status: JobStatus; // "pending" | "processing" | "completed" | "failed"
  requestedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastUpdated: Date;
  result?: JobResult;
  error?: Error;
  workerId?: number;
  retryCount: number;
  maxRetries: number;
  timeoutMs?: number;
  priority: number;
  scheduledFor?: Date;
  createdBy?: string;
  tags?: string[];
}
```

## JobStatus Enum

```typescript
enum JobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed"
}
```

## QueueStats Interface

```typescript
interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  oldestPending?: Date;
}
```

## JobPayload Interface

```typescript
interface JobPayload {
  jobFile: string; // Path to job file
  jobPayload: any; // Custom payload data
}
```

## JobResult Interface

```typescript
interface JobResult {
  success: boolean;
  result?: any;
  error?: string;
  data?: any;
}
```
