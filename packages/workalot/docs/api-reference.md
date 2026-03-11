# API Reference

Complete reference for all Workalot public APIs.

## TaskManager

Main class for job queue management.

### Constructor

```typescript
constructor(config?: QueueConfig, projectRoot?: string)
```

**Parameters:**

| Parameter   | Type          | Default         | Description                                    |
| ----------- | ------------- | --------------- | ---------------------------------------------- |
| config      | `QueueConfig` | `{}`            | Configuration options                          |
| projectRoot | `string`      | `process.cwd()` | Project root directory for job file resolution |

**Example:**

```typescript
const manager = new TaskManager(
  {
    backend: "memory",
    maxThreads: 4,
  },
  "/path/to/project",
);
```

### Methods

#### initialize()

Initialize the task manager and its components.

```typescript
async initialize(): Promise<void>
```

**Throws:** Error if already initialized or if backend fails to start

**Example:**

```typescript
await manager.initialize();
console.log("Ready to schedule jobs");
```

#### scheduleAndWait()

Schedule a job and wait for it to complete.

```typescript
async scheduleAndWait(jobPayload: JobPayload): Promise<JobResult>
```

**Parameters:**

| Parameter  | Type         | Description                |
| ---------- | ------------ | -------------------------- |
| jobPayload | `JobPayload` | Job configuration and data |

**Returns:** `JobResult` containing execution results and timing

**Example:**

```typescript
const result = await manager.scheduleAndWait({
  jobFile: "jobs/DataProcessor.ts",
  jobPayload: { input: "data.csv" },
  jobTimeout: 60000,
});

console.log(result.results);
console.log(`Executed in ${result.executionTime}ms`);
```

#### schedule()

Schedule a job without waiting for completion (fire-and-forget).

```typescript
async schedule(jobPayload: JobPayload): Promise<string>
```

**Parameters:**

| Parameter  | Type         | Description                |
| ---------- | ------------ | -------------------------- |
| jobPayload | `JobPayload` | Job configuration and data |

**Returns:** Job ID string

**Example:**

```typescript
const jobId = await manager.schedule({
  jobFile: "jobs/EmailJob.ts",
  jobPayload: { recipient: "user@example.com" },
});

console.log(`Job scheduled: ${jobId}`);
```

#### whenFree()

Register a callback to be called when the queue becomes idle.

```typescript
whenFree(callback: WhenFreeCallback): void
```

**Parameters:**

| Parameter | Type               | Description                         |
| --------- | ------------------ | ----------------------------------- |
| callback  | `WhenFreeCallback` | Function to call when queue is idle |

**Example:**

```typescript
manager.whenFree(() => {
  console.log("Queue is empty, performing cleanup");
  cleanup();
});
```

#### removeWhenFreeCallback()

Remove a previously registered whenFree callback.

```typescript
removeWhenFreeCallback(callback: WhenFreeCallback): boolean
```

**Returns:** `true` if callback was removed, `false` if not found

#### getStatus()

Get the current system status.

```typescript
async getStatus(): Promise<{
  isInitialized: boolean;
  isShuttingDown: boolean;
  queue: any;
  workers: any;
  scheduler: any;
}>
```

**Example:**

```typescript
const status = await manager.getStatus();
console.log(`Initialized: ${status.isInitialized}`);
console.log(`Queue: ${status.queue.total} jobs`);
console.log(`Workers: ${status.workers.available}/${status.workers.total} available`);
```

#### isIdle()

Check if the system is currently idle.

```typescript
async isIdle(): Promise<boolean>
```

**Returns:** `true` if no pending or processing jobs and workers are available

#### whenIdle()

Wait for the system to become idle.

```typescript
async whenIdle(timeoutMs?: number): Promise<void>
```

**Parameters:**

| Parameter | Type     | Default   | Description                          |
| --------- | -------- | --------- | ------------------------------------ |
| timeoutMs | `number` | undefined | Maximum time to wait in milliseconds |

**Throws:** Error if timeout is exceeded

#### getQueueStats()

Get queue statistics.

```typescript
async getQueueStats(): Promise<QueueStats>
```

**Returns:**

```typescript
interface QueueStats {
  total: number; // Total jobs in queue
  pending: number; // Pending jobs
  processing: number; // Currently processing
  completed: number; // Completed jobs
  failed: number; // Failed jobs
  oldestPending?: Date; // Oldest pending job timestamp
}
```

#### getWorkerStats()

Get worker statistics.

```typescript
async getWorkerStats(): Promise<any>
```

#### getJobsByStatus()

Get jobs filtered by status.

```typescript
async getJobsByStatus(status: string): Promise<any[]>
```

**Parameters:**

| Parameter | Type     | Description                                            |
| --------- | -------- | ------------------------------------------------------ |
| status    | `string` | One of: "pending", "processing", "completed", "failed" |

#### shutdown()

Gracefully shut down the task manager.

```typescript
async shutdown(): Promise<void>
```

**Note:** Waits for in-flight jobs to complete before shutting down

## TaskManagerFactory

Factory for creating and managing multiple TaskManager instances.

### Constructor

```typescript
constructor(defaultConfig?: QueueConfig, defaultProjectRoot?: string)
```

### Methods

#### create()

Create a new named TaskManager instance.

```typescript
async create(
  name?: string,
  config?: QueueConfig,
  projectRoot?: string
): Promise<TaskManager>
```

**Throws:** Error if instance with same name already exists

#### getOrCreate()

Get existing instance or create new one.

```typescript
async getOrCreate(
  name?: string,
  config?: QueueConfig,
  projectRoot?: string
): Promise<TaskManager>
```

#### get()

Get existing instance by name.

```typescript
get(name: string): TaskManager | undefined
```

#### destroy()

Destroy a specific instance.

```typescript
async destroy(name: string): Promise<boolean>
```

#### destroyAll()

Destroy all instances.

```typescript
async destroyAll(): Promise<void>
```

#### list()

List all instance names.

```typescript
list(): string[]
```

#### size()

Get number of instances.

```typescript
size(): number
```

#### getAllStats()

Get statistics for all instances.

```typescript
async getAllStats(): Promise<Record<string, any>>
```

### Presets

```typescript
class TaskManagerFactoryPresets {
  static development(): TaskManagerFactory;
  static testing(): TaskManagerFactory;
  static productionSQLite(dbPath?: string): TaskManagerFactory;
  static productionPostgreSQL(connectionString: string): TaskManagerFactory;
  static highPerformance(): TaskManagerFactory;
}
```

## TaskManagerSingleton

Legacy singleton access (prefer using TaskManagerFactory).

```typescript
// Functions exported from src/api/index.ts
initializeTaskManager(config?, projectRoot?): Promise<void>
scheduleAndWait(jobPayload): Promise<JobResult>
schedule(jobPayload): Promise<string>
whenFree(callback): void
getStatus(): Promise<any>
isIdle(): Promise<boolean>
whenIdle(timeoutMs?): Promise<void>
shutdown(): Promise<void>
```

## BaseJob

Abstract base class for custom job implementations.

### Constructor

```typescript
constructor(jobName?: string)
```

**Parameters:**

| Parameter | Type     | Default                 | Description           |
| --------- | -------- | ----------------------- | --------------------- |
| jobName   | `string` | `this.constructor.name` | Unique job identifier |

### Abstract Methods

#### run()

Execute the job.

```typescript
abstract run(
  payload: Record<string, any>,
  context: JobExecutionContext
): Promise<Record<string, any>>
```

**Parameters:**

| Parameter | Type                  | Description                           |
| --------- | --------------------- | ------------------------------------- |
| payload   | `Record<string, any>` | Job input data                        |
| context   | `JobExecutionContext` | Execution context with scheduling API |

**Returns:** Job result data

**Example:**

```typescript
class MyJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["requiredField"]);

    const result = await this.processData(payload);

    return this.createSuccessResult({ processed: result });
  }
}
```

### Protected Methods

#### validatePayload()

Validate that required fields are present.

```typescript
protected validatePayload(payload: Record<string, any>, requiredFields: string[]): void
```

**Throws:** Error if required field is missing

#### createSuccessResult()

Create a standardized success result.

```typescript
protected createSuccessResult(data: Record<string, any>): Record<string, any>
```

**Returns:**

```typescript
{
  success: true,
  data: Record<string, any>,
  timestamp: string,
}
```

#### createErrorResult()

Create a standardized error result.

```typescript
protected createErrorResult(message: string, details?: Record<string, any>): Record<string, any>
```

**Returns:**

```typescript
{
  success: false,
  error: string,
  details?: Record<string, any>,
  timestamp: string,
}
```

#### getJobId()

Generate job identifier.

```typescript
getJobId(payload?: Record<string, any>): string | undefined
```

## QueueConfig

Configuration for TaskManager.

```typescript
interface QueueConfig {
  // Backend configuration
  backend?: "memory" | "pglite" | "postgresql" | "sqlite" | "redis";
  databaseUrl?: string;

  // TimescaleDB configuration (PostgreSQL only)
  enableTimescaleDB?: boolean;
  chunkTimeInterval?: string;
  compressionInterval?: string;
  retentionInterval?: string;

  // Worker configuration
  maxThreads?: number;
  silent?: boolean;

  // Job recovery
  jobRecoveryEnabled?: boolean;

  // Health checks
  healthCheckInterval?: number;

  // Persistence
  maxInMemoryAge?: number;
}
```

## JobPayload

Job scheduling request.

```typescript
interface JobPayload {
  jobFile: string | PathLike; // Path to job file
  jobPayload: Record<string, any>; // Job data
  jobTimeout?: number; // Job-specific timeout (ms)
  metaEnvelope?: MetaEnvelope; // Workflow metadata
}
```

## JobResult

Job execution result.

```typescript
interface JobResult {
  results: Record<string, any>; // Job return value
  executionTime: number; // Execution time in ms
  queueTime: number; // Time waiting in queue
  schedulingRequests?: JobSchedulingRequest[]; // Jobs scheduled by this job
}
```

## JobExecutionContext

Context provided to job run method.

```typescript
interface JobExecutionContext extends BaseJobExecutionContext {
  jobId: string;
  startTime: number;
  queueTime: number;
  timeout: number;

  // Scheduling API
  scheduleAndWait(jobPayload: JobPayload): Promise<string>;
  schedule(jobPayload: JobPayload): string;

  // Workflow metadata
  metaEnvelope?: MetaEnvelope;
}
```

## Events

TaskManager emits the following events:

```typescript
interface TaskManagerEvents {
  ready: () => void;
  "job-scheduled": (jobId: string) => void;
  "job-completed": (jobId: string, result: JobResult) => void;
  "job-failed": (jobId: string, error: string) => void;
  "queue-empty": () => void;
  "queue-not-empty": () => void;
  "all-workers-busy": () => void;
  "workers-available": () => void;
}
```

**Example:**

```typescript
manager.on("job-completed", (jobId, result) => {
  console.log(`Job ${jobId} completed:`, result);
});

manager.on("job-failed", (jobId, error) => {
  console.error(`Job ${jobId} failed:`, error);
});
```
