# API Functions API

## Factory Pattern Functions

### `createTaskManager(name: string, config: QueueConfig): Promise<TaskManager>`

Create named TaskManager instance.

**Parameters**:

- `name`: Unique instance identifier (used for destroy)
- `config`: QueueConfig object (see configuration.md)

**Returns**: Promise<TaskManager>

**Throws**: Error if name already exists

**Example**:

```typescript
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
  maxThreads: 4,
});
```

### `destroyTaskManager(name: string): Promise<void>`

Shutdown and destroy named TaskManager instance.

**Parameters**:

- `name`: Instance identifier from createTaskManager

**Example**:

```typescript
await destroyTaskManager("main");
```

### `scheduleAndWaitWith(manager: TaskManager, jobPayload: JobRequest): Promise<JobResult>`

Schedule job and wait for completion using specific manager instance.

**Parameters**:

- `manager`: TaskManager instance from createTaskManager
- `jobPayload`: JobRequest object (see Request Configuration)

**Returns**: Promise<JobResult>

**Throws**: Error if manager doesn't exist

**Example**:

```typescript
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/ProcessDataJob.ts",
  jobPayload: { data: [1, 2, 3] },
  jobTimeout: 30000,
});

console.log("Success:", result.success);
console.log("Result:", result.result);
```

### `scheduleWith(manager: TaskManager, jobPayload: JobRequest): Promise<string>`

Schedule job without waiting (fire-and-forget), returns job ID.

**Parameters**:

- `manager`: TaskManager instance
- `jobPayload`: JobRequest object

**Returns**: Promise<string> (job ID)

**Example**:

```typescript
const jobId = await scheduleWith(manager, {
  jobFile: "jobs/BackgroundJob.ts",
  jobPayload: { task: "cleanup" },
});

console.log("Job scheduled:", jobId);
```

### `whenFreeWith(manager: TaskManager, callback: () => void): void`

Register callback when queue becomes empty.

**Parameters**:

- `manager`: TaskManager instance
- `callback`: Function to execute when queue empty

**Example**:

```typescript
whenFreeWith(manager, () => {
  console.log("Queue is empty!");
  await shutdown();
});
```

### `getQueueStatsWith(manager: TaskManager): Promise<QueueStats>`

Get queue statistics from specific manager instance.

**Parameters**:

- `manager`: TaskManager instance

**Returns**: Promise<QueueStats>

**Example**:

```typescript
const stats = await getQueueStatsWith(manager);

console.log(`Pending: ${stats.pending}`);
console.log(`Processing: ${stats.processing}`);
```

## Singleton Pattern Functions (Legacy)

### `scheduleAndWait(jobPayload: JobRequest): Promise<JobResult>`

Schedule job using default singleton instance.

**Parameters**:

- `jobPayload`: JobRequest object

**Returns**: Promise<JobResult>

**Example**:

```typescript
import { scheduleAndWait } from "#/index.js";

const result = await scheduleAndWait({
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "value" },
});
```

### `schedule(jobPayload: JobRequest): Promise<string>`

Schedule job without waiting using default singleton.

**Parameters**:

- `jobPayload`: JobRequest object

**Returns**: Promise<string> (job ID)

**Example**:

```typescript
import { schedule } from "#/index.js";

const jobId = await schedule({
  jobFile: "jobs/BackgroundJob.ts",
  jobPayload: { task: "cleanup" },
});
```

### `getQueueStats(): Promise<QueueStats>`

Get stats from default singleton instance.

**Returns**: Promise<QueueStats>

### `shutdown(): Promise<void>`

Shutdown default singleton instance.

### `whenFree(callback: () => void): void`

Register callback when singleton queue becomes empty.

## Factory Preset Functions

### `TaskManagerFactoryPresets.development(): TaskManagerFactory`

Create factory configured for development (Memory backend, 2 threads, no recovery).

**Returns**: TaskManagerFactory instance

**Example**:

```typescript
const devFactory = TaskManagerFactoryPresets.development();
const manager = await devFactory.create("dev");
```

### `TaskManagerFactoryPresets.productionSQLite(dbPath: string): TaskManagerFactory`

Create factory for production SQLite (WAL mode, system threads, recovery enabled).

**Parameters**:

- `dbPath`: Path to SQLite database file

**Returns**: TaskManagerFactory instance

**Example**:

```typescript
const prodFactory = TaskManagerFactoryPresets.productionSQLite("./prod.db");
const manager = await prodFactory.create("main");
```

### `TaskManagerFactoryPresets.productionPostgreSQL(dbUrl: string): TaskManagerFactory`

Create factory for production PostgreSQL (pool, LISTEN/NOTIFY, recovery).

**Parameters**:

- `dbUrl`: PostgreSQL connection string

**Returns**: TaskManagerFactory instance

**Example**:

```typescript
const pgFactory = TaskManagerFactoryPresets.productionPostgreSQL(
  "postgresql://user:pass@localhost:5432/db",
);
const manager = await pgFactory.create("main");
```

## Monitoring Functions

### `getWorkerStats(): Promise<WorkerStats>`

Get worker statistics (total, available, busy).

**Returns**: Promise<WorkerStats>

**Example**:

```typescript
const workers = await getWorkerStats();

console.log(`Total workers: ${workers.totalWorkers}`);
console.log(`Available: ${workers.availableWorkers}`);
console.log(`Busy: ${workers.busyWorkers}`);
```

### `getQueueStats(): Promise<QueueStats>`

Get queue statistics (total, pending, processing, completed, failed).

**Returns**: Promise<QueueStats>

## Interface Definitions

### `JobRequest`

```typescript
interface JobRequest {
  jobFile: string;
  jobPayload: any;
  jobTimeout?: number;
  customId?: string;
}
```

### `JobResult`

```typescript
interface JobResult {
  jobId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  retryCount: number;
}
```

### `QueueStats`

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

### `WorkerStats`

```typescript
interface WorkerStats {
  totalWorkers: number;
  availableWorkers: number;
  busyWorkers: number;
}
```

### `QueueConfig`

```typescript
interface QueueConfig {
  backend?: "memory" | "sqlite" | "pglite" | "postgresql" | "redis";
  databaseUrl?: string;
  maxThreads?: number;
  persistenceFile?: string;
  maxInMemoryAge?: number;
  healthCheckInterval?: number;
  silent?: boolean;
  jobRecoveryEnabled?: boolean;
  // Backend-specific config (see queue-backends/configuration.md)
  postgresConfig?: PostgreSQLQueueConfig;
  sqliteConfig?: SQLiteQueueConfig;
  redisConfig?: RedisQueueConfig;
  pgliteConfig?: PGLiteQueueConfig;
}
```
