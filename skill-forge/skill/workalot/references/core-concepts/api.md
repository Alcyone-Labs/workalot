# Core Concepts API

## Factory Pattern API

### `createTaskManager(name: string, config: QueueConfig): Promise<TaskManager>`

Creates named TaskManager instance for testability and multiple instances.

**Parameters**:
- `name`: Unique instance identifier (used in destroy)
- `config`: QueueConfig object

**Returns**: Promise<TaskManager> instance

**Example**:
```typescript
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
  maxThreads: 4,
});
```

### `destroyTaskManager(name: string): Promise<void>`

Shuts down and destroys named TaskManager instance.

**Parameters**:
- `name`: Instance identifier from createTaskManager

### `scheduleAndWaitWith(manager: TaskManager, jobPayload: JobRequest): Promise<JobResult>`

Schedule job and wait for completion with specific manager instance.

**Parameters**:
- `manager`: TaskManager instance from createTaskManager
- `jobPayload`: JobRequest object

**Returns**: Promise<JobResult>

### `scheduleWith(manager: TaskManager, jobPayload: JobRequest): Promise<string>`

Schedule job without waiting (fire-and-forget), returns job ID.

**Parameters**:
- `manager`: TaskManager instance
- `jobPayload`: JobRequest object

**Returns**: Promise<string> (job ID)

### `whenFreeWith(manager: TaskManager, callback: () => void): void`

Register callback when queue becomes empty.

**Parameters**:
- `manager`: TaskManager instance
- `callback`: Function to execute when queue empty

### `getQueueStatsWith(manager: TaskManager): Promise<QueueStats>`

Get queue statistics from specific manager instance.

**Returns**: Promise<QueueStats>

## Singleton Pattern API (Legacy)

**Use factory pattern in new code, singleton kept for compatibility**

### `scheduleAndWait(jobPayload: JobRequest): Promise<JobResult>`

Schedule job using default singleton instance.

### `getQueueStats(): Promise<QueueStats>`

Get stats from default singleton instance.

### `shutdown(): Promise<void>`

Shutdown default singleton instance.

## WebSocket Worker API

### `SimpleOrchestrator`

```typescript
new SimpleOrchestrator(config: {
  wsPort: number;
  wsHostname?: string;
  distributionStrategy?: "round-robin" | "random";
  queueConfig: QueueConfig;
})

methods:
  - start(): Promise<void>
  - shutdown(): Promise<void>
  - addJob(job: object): Promise<string>
```

### `SimpleWorker`

```typescript
new SimpleWorker(config: {
  workerId: number;
  wsUrl: string;
  projectRoot: string;
  defaultTimeout?: number;
})

methods:
  - start(): Promise<void>
  - shutdown(): Promise<void>
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

## JobRequest Interface

```typescript
interface JobRequest {
  jobFile: string;
  jobPayload: any;
  jobTimeout?: number;
  customId?: string;
}
```

## JobResult Interface

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
