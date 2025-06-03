# Task Management Library

A robust, multi-threaded job queue system for NodeJS/BunJS with in-memory storage, JSON persistence, and promise-based APIs.

## Features

- 🚀 **Multi-threaded execution** using worker threads
- 📦 **In-memory queue** with JSON persistence
- 🎯 **Promise-based API** with `scheduleNow()` and `whenFree()`
- 🔧 **Dynamic job loading** from TypeScript/JavaScript files
- 📊 **Comprehensive monitoring** and statistics
- 🛡️ **Error handling** and timeout management
- 🔄 **Graceful shutdown** with state preservation
- ⚡ **High performance** with configurable worker pools

## Quick Start

### Installation

```bash
npm install task-management
# or
pnpm add task-management
# or
yarn add task-management
```

### Basic Usage

```typescript
import { initializeTaskManager, scheduleNow, whenFree, shutdown } from 'task-management';

// Initialize the task manager
await initializeTaskManager({
  maxThreads: 4,
  persistenceFile: 'queue-state.json'
});

// Schedule a job and wait for completion
const result = await scheduleNow({
  jobFile: 'jobs/ProcessDataJob.ts',
  jobPayload: { data: [1, 2, 3, 4, 5] },
  jobTimeout: 10000
});

console.log('Job completed:', result);

// Get notified when queue is free
whenFree(() => {
  console.log('All jobs completed!');
});

// Graceful shutdown
await shutdown();
```

## API Reference

### Main Functions

#### `initializeTaskManager(config?, projectRoot?)`

Initialize the task management system.

**Parameters:**
- `config` (optional): Configuration object
- `projectRoot` (optional): Project root directory

**Configuration Options:**
```typescript
interface QueueConfig {
  maxThreads?: number;        // Default: CPU cores - 2
  maxInMemoryAge?: number;    // Default: 24 hours (ms)
  persistenceFile?: string;   // Default: 'queue-state.json'
  healthCheckInterval?: number; // Default: 5000ms
}
```

#### `scheduleNow(jobPayload)`

Schedule a job and return a promise that resolves when the job completes.

**Parameters:**
```typescript
interface JobPayload {
  jobFile: string;           // Path to job file
  jobPayload: Record<string, any>; // Data to pass to job
  jobTimeout?: number;       // Execution timeout (default: 5000ms)
}
```

**Returns:** `Promise<JobResult>`

```typescript
interface JobResult {
  results: Record<string, any>; // Job output
  executionTime: number;        // Time taken (ms)
  queueTime: number;           // Time in queue (ms)
}
```

#### `whenFree(callback)`

Register a callback to be called when the queue becomes free (no pending jobs).

**Parameters:**
- `callback`: Function to call when queue is free

#### `scheduleJob(jobPayload)`

Schedule a job without waiting for completion (fire and forget).

**Returns:** `Promise<string>` - Job ID

### Utility Functions

- `getStatus()` - Get system status
- `isIdle()` - Check if system is idle
- `getQueueStats()` - Get queue statistics
- `getWorkerStats()` - Get worker statistics
- `removeWhenFreeCallback(callback)` - Remove a whenFree callback
- `shutdown()` - Graceful shutdown

## Creating Jobs

Jobs are TypeScript/JavaScript classes that implement the `IJob` interface:

```typescript
import { BaseJob } from 'task-management';

export class MyJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Validate input
    this.validatePayload(payload, ['requiredField']);
    
    // Process data
    const result = await this.processData(payload.data);
    
    // Return success response
    return this.createSuccessResult({ result });
  }
  
  private async processData(data: any): Promise<any> {
    // Your job logic here
    return data;
  }
}
```

### Job Structure

- **Extend `BaseJob`**: Provides common functionality
- **Implement `run(payload)`**: Main job logic
- **Use helper methods**: `validatePayload()`, `createSuccessResult()`, `createErrorResult()`
- **Handle errors**: Throw errors for failures, they'll be caught and handled

### Job ID Generation

Override `getJobId()` for custom ID generation:

```typescript
export class MyJob extends BaseJob {
  getJobId(payload?: Record<string, any>): string | undefined {
    // Return custom ID or undefined for auto-generation
    return payload?.customId || super.getJobId(payload);
  }
}
```

## Advanced Usage

### Class-based API

For more control, use the class-based API:

```typescript
import { TaskManager } from 'task-management';

const taskManager = new TaskManager({
  maxThreads: 8,
  persistenceFile: 'my-queue.json'
});

await taskManager.initialize();

// Use taskManager methods...
await taskManager.shutdown();
```

### Event Handling

```typescript
import { TaskManager } from 'task-management';

const taskManager = new TaskManager();

taskManager.on('job-completed', (jobId, result) => {
  console.log(`Job ${jobId} completed:`, result);
});

taskManager.on('job-failed', (jobId, error) => {
  console.log(`Job ${jobId} failed:`, error);
});

taskManager.on('queue-empty', () => {
  console.log('Queue is now empty');
});
```

### Statistics and Monitoring

```typescript
// Get comprehensive status
const status = await getStatus();
console.log('System status:', status);

// Get queue statistics
const queueStats = await getQueueStats();
console.log('Queue stats:', queueStats);

// Get worker statistics
const workerStats = await getWorkerStats();
console.log('Worker stats:', workerStats);
```

## Configuration

### Environment Variables

- `NODE_ENV=test` - Disables process signal handlers during testing
- `VITEST=true` - Alternative test environment detection

### Performance Tuning

- **maxThreads**: Set based on your CPU cores and workload
- **maxInMemoryAge**: Adjust based on memory constraints
- **healthCheckInterval**: Lower for faster failure detection
- **jobTimeout**: Set appropriate timeouts for your jobs

## Error Handling

The library provides comprehensive error handling:

```typescript
try {
  const result = await scheduleNow({
    jobFile: 'jobs/MyJob.ts',
    jobPayload: { data: 'test' }
  });
} catch (error) {
  if (error.message.includes('timed out')) {
    console.log('Job timed out');
  } else if (error.message.includes('Job execution failed')) {
    console.log('Job failed:', error.message);
  }
}
```

## Best Practices

1. **Job Design**
   - Keep jobs focused and single-purpose
   - Validate input data early
   - Use appropriate timeouts
   - Handle errors gracefully

2. **Performance**
   - Configure worker count based on workload
   - Monitor queue statistics
   - Use appropriate job timeouts
   - Clean up old completed jobs

3. **Reliability**
   - Always call `shutdown()` for graceful cleanup
   - Handle job failures appropriately
   - Monitor worker health
   - Use persistence for important queues

4. **Testing**
   - Test jobs in isolation
   - Use unique persistence files for tests
   - Clean up resources in test teardown

## Examples

See the `examples/` directory for complete examples:
- `examples/basic-usage.ts` - Basic API usage
- `examples/sample-consumer/` - Complete application example

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request
