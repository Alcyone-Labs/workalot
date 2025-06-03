# API Documentation

## Table of Contents

- [Main Functions](#main-functions)
- [Configuration](#configuration)
- [Job Interface](#job-interface)
- [Types](#types)
- [Classes](#classes)
- [Events](#events)
- [Error Handling](#error-handling)

## Main Functions

### `initializeTaskManager(config?, projectRoot?)`

Initialize the global task management system.

```typescript
await initializeTaskManager({
  maxThreads: 4,
  maxInMemoryAge: 60000,
  persistenceFile: 'queue.json',
  healthCheckInterval: 5000
});
```

**Parameters:**
- `config?: QueueConfig` - Configuration options
- `projectRoot?: string` - Project root directory (default: `process.cwd()`)

**Returns:** `Promise<void>`

### `scheduleNow(jobPayload)`

Schedule a job and wait for completion.

```typescript
const result = await scheduleNow({
  jobFile: 'jobs/ProcessData.ts',
  jobPayload: { data: [1, 2, 3] },
  jobTimeout: 10000
});
```

**Parameters:**
- `jobPayload: JobPayload` - Job configuration

**Returns:** `Promise<JobResult>`

### `whenFree(callback)`

Register a callback for when the queue becomes free.

```typescript
whenFree(() => {
  console.log('Queue is now free!');
});
```

**Parameters:**
- `callback: () => void` - Callback function

**Returns:** `void`

### `scheduleJob(jobPayload)`

Schedule a job without waiting (fire and forget).

```typescript
const jobId = await scheduleJob({
  jobFile: 'jobs/BackgroundTask.ts',
  jobPayload: { data: 'background' }
});
```

**Parameters:**
- `jobPayload: JobPayload` - Job configuration

**Returns:** `Promise<string>` - Job ID

### `getStatus()`

Get comprehensive system status.

```typescript
const status = await getStatus();
console.log(status.workers.available); // Available workers
console.log(status.queue.pending);     // Pending jobs
```

**Returns:** `Promise<SystemStatus>`

### `isIdle()`

Check if the system is idle (no pending jobs, workers available).

```typescript
if (await isIdle()) {
  console.log('System is idle');
}
```

**Returns:** `Promise<boolean>`

### `getQueueStats()`

Get detailed queue statistics.

```typescript
const stats = await getQueueStats();
console.log(`${stats.pending} jobs pending`);
```

**Returns:** `Promise<QueueStats>`

### `getWorkerStats()`

Get detailed worker statistics.

```typescript
const stats = await getWorkerStats();
console.log(`${stats.available}/${stats.total} workers available`);
```

**Returns:** `Promise<WorkerStats>`

### `removeWhenFreeCallback(callback)`

Remove a previously registered whenFree callback.

```typescript
const callback = () => console.log('Free!');
whenFree(callback);
// Later...
removeWhenFreeCallback(callback);
```

**Parameters:**
- `callback: () => void` - Callback to remove

**Returns:** `boolean` - True if removed, false if not found

### `shutdown()`

Gracefully shutdown the system.

```typescript
await shutdown();
```

**Returns:** `Promise<void>`

## Configuration

### `QueueConfig`

```typescript
interface QueueConfig {
  maxThreads?: number;        // Worker thread count (default: CPU cores - 2)
  maxInMemoryAge?: number;    // Max age for completed jobs in ms (default: 24h)
  persistenceFile?: string;   // JSON persistence file (default: 'queue-state.json')
  healthCheckInterval?: number; // Health check interval in ms (default: 5000)
}
```

**Examples:**

```typescript
// Minimal config
await initializeTaskManager();

// Custom config
await initializeTaskManager({
  maxThreads: 8,
  maxInMemoryAge: 30 * 60 * 1000, // 30 minutes
  persistenceFile: 'my-queue.json',
  healthCheckInterval: 2000
});

// High-performance config
await initializeTaskManager({
  maxThreads: 16,
  maxInMemoryAge: 5 * 60 * 1000,  // 5 minutes
  healthCheckInterval: 1000
});
```

## Job Interface

### `IJob`

All jobs must implement this interface:

```typescript
interface IJob {
  getJobId(payload?: Record<string, any>): string | undefined;
  run(payload: Record<string, any>): Promise<Record<string, any>> | Record<string, any>;
}
```

### `BaseJob`

Abstract base class providing common functionality:

```typescript
import { BaseJob } from 'task-management';

export class MyJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Validate required fields
    this.validatePayload(payload, ['requiredField']);
    
    // Process data
    const result = await this.processData(payload.data);
    
    // Return standardized response
    return this.createSuccessResult({ result });
  }
}
```

**Helper Methods:**
- `validatePayload(payload, requiredFields)` - Validate required fields
- `createSuccessResult(data)` - Create success response
- `createErrorResult(message, details?)` - Create error response
- `getJobId(payload?)` - Generate SHA1-based job ID

## Types

### `JobPayload`

```typescript
interface JobPayload {
  jobFile: string;                    // Path to job file
  jobPayload: Record<string, any>;    // Data for the job
  jobTimeout?: number;                // Timeout in ms (default: 5000)
}
```

### `JobResult`

```typescript
interface JobResult {
  results: Record<string, any>;  // Job output
  executionTime: number;         // Execution time in ms
  queueTime: number;            // Queue wait time in ms
}
```

### `QueueStats`

```typescript
interface QueueStats {
  total: number;           // Total jobs in queue
  pending: number;         // Pending jobs
  processing: number;      // Currently processing
  completed: number;       // Completed jobs
  failed: number;         // Failed jobs
  oldestPending?: Date;   // Oldest pending job timestamp
}
```

### `WorkerStats`

```typescript
interface WorkerStats {
  total: number;      // Total workers
  ready: number;      // Ready workers
  busy: number;       // Busy workers
  available: number;  // Available workers (ready - busy)
}
```

### `JobStatus`

```typescript
enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}
```

## Classes

### `TaskManager`

Main class for advanced usage:

```typescript
import { TaskManager } from 'task-management';

const taskManager = new TaskManager({
  maxThreads: 4,
  persistenceFile: 'queue.json'
});

await taskManager.initialize();

// Use methods...
const result = await taskManager.scheduleNow(jobPayload);
taskManager.whenFree(() => console.log('Free!'));

await taskManager.shutdown();
```

### `TaskManagerSingleton`

Singleton wrapper (used by function API):

```typescript
import { TaskManagerSingleton } from 'task-management';

const singleton = TaskManagerSingleton.getInstance();
await singleton.initialize(config);
```

## Events

### TaskManager Events

```typescript
taskManager.on('ready', () => {
  console.log('TaskManager is ready');
});

taskManager.on('job-scheduled', (jobId: string) => {
  console.log(`Job ${jobId} scheduled`);
});

taskManager.on('job-completed', (jobId: string, result: JobResult) => {
  console.log(`Job ${jobId} completed`);
});

taskManager.on('job-failed', (jobId: string, error: string) => {
  console.log(`Job ${jobId} failed: ${error}`);
});

taskManager.on('queue-empty', () => {
  console.log('Queue is empty');
});

taskManager.on('queue-not-empty', () => {
  console.log('Queue has jobs');
});
```

## Error Handling

### Error Types

- `JobLoadError` - Job file loading failed
- `JobValidationError` - Job validation failed
- `JobTimeoutError` - Job execution timed out
- `JobExecutionError` - Job execution failed

### Error Handling Patterns

```typescript
try {
  const result = await scheduleNow(jobPayload);
} catch (error) {
  if (error.message.includes('timed out')) {
    // Handle timeout
  } else if (error.message.includes('Job execution failed')) {
    // Handle execution failure
  } else {
    // Handle other errors
  }
}
```

### Job Error Handling

```typescript
export class MyJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    try {
      this.validatePayload(payload, ['data']);
      
      const result = await this.processData(payload.data);
      return this.createSuccessResult(result);
      
    } catch (error) {
      // Log error details
      console.error('Job failed:', error);
      
      // Return error response or throw
      throw new Error(`Processing failed: ${error.message}`);
    }
  }
}
```

## Advanced Usage

### Custom Job ID Generation

```typescript
export class MyJob extends BaseJob {
  getJobId(payload?: Record<string, any>): string | undefined {
    if (payload?.customId) {
      return payload.customId;
    }
    return super.getJobId(payload); // Use default SHA1 generation
  }
}
```

### Job Registry

```typescript
import { JobRegistry } from 'task-management';

const registry = new JobRegistry();
const jobs = await registry.discoverJobs('jobs/');
console.log('Available jobs:', jobs.map(j => j.name));
```

### Queue Backend Swapping

```typescript
import { QueueManager, IQueueBackend } from 'task-management';

// Use in-memory queue
const queueManager = new QueueManager(config);

// Or implement custom backend
class PostgreSQLQueue extends IQueueBackend {
  // Implement abstract methods...
}
```
