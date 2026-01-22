# API Functions

## Overview

Workalot provides both simple singleton API and factory pattern API. Use factory pattern for testability and multiple instances.

**Key Functions**:
- `scheduleAndWait()` / `scheduleAndWaitWith()` - Schedule and wait for completion
- `schedule()` / `scheduleWith()` - Fire-and-forget job scheduling
- `createTaskManager()` / `destroyTaskManager()` - Factory pattern for multiple instances
- `getQueueStats()` / `getQueueStatsWith()` - Queue statistics
- `whenFree()` / `whenFreeWith()` - Register callback on queue empty

## When to Use Each Function

### Schedule and Wait (synchronous)

Use when:
- Job result needed immediately
- Need to handle errors synchronously
- Simple request-response pattern
- UI-driven workflows

```typescript
import { scheduleAndWait } from "#/index.js";

const result = await scheduleAndWait({
  jobFile: "jobs/ProcessDataJob.ts",
  jobPayload: { data: [1, 2, 3] },
});

if (result.success) {
  console.log("Result:", result.result);
} else {
  console.error("Error:", result.error);
}
```

### Schedule and Forget (asynchronous)

Use when:
- Result not needed immediately
- Fire-and-forget pattern
- Background processing
- High-throughput scenarios

```typescript
import { schedule } from "#/index.js";

const jobId = await schedule({
  jobFile: "jobs/BackgroundJob.ts",
  jobPayload: { task: "cleanup" },
});

console.log("Job scheduled:", jobId);
// Continue without waiting...
```

### Factory Pattern (recommended)

Use when:
- Multiple TaskManager instances needed
- Test isolation required
- Production deployment
- Managing lifecycles

```typescript
import {
  createTaskManager,
  scheduleAndWaitWith,
  destroyTaskManager,
} from "#/index.js";

// Create instance
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
});

// Use instance
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "value" },
});

// Cleanup
await destroyTaskManager("main");
```

### Queue Monitoring

Use when:
- Need queue visibility
- Health checks
- Dashboard metrics
- Alerting on queue buildup

```typescript
import { getQueueStats } from "#/index.js";

setInterval(async () => {
  const stats = await getQueueStats();

  console.log("Queue Stats:");
  console.log(`  Total: ${stats.total}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Processing: ${stats.processing}`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed: ${stats.failed}`);

  // Alert on queue buildup
  if (stats.pending > 1000) {
    console.warn("⚠️  Queue buildup detected:", stats.pending);
    // Send alert...
  }
}, 10000); // Every 10 seconds
```

### Worker Monitoring

Use when:
- Need worker availability
- Load balancing decisions
- Scaling triggers
- Performance metrics

```typescript
import { getWorkerStats } from "#/index.js";

setInterval(async () => {
  const workers = await getWorkerStats();

  console.log("Worker Stats:");
  console.log(`  Total: ${workers.totalWorkers}`);
  console.log(`  Available: ${workers.availableWorkers}`);
  console.log(`  Busy: ${workers.busyWorkers}`);

  // Scale up if needed
  const utilization = workers.busyWorkers / workers.totalWorkers;

  if (utilization > 0.8) {
    console.warn("High worker utilization:", utilization);
    // Add more workers...
  }
}, 5000); // Every 5 seconds
```

### Empty Queue Callback

Use when:
- Need to run code after all jobs complete
- Batch processing end
- Cleanup on completion
- Shutdown sequences

```typescript
import { whenFree } from "#/index.js";

whenFree(async () => {
  console.log("All jobs completed!");

  // Run cleanup
  await cleanupResources();

  // Send notification
  await sendNotification("Batch processing complete");

  // Shutdown if needed
  await shutdown();
});
```

## Factory Presets

Use pre-configured factories for common scenarios:

```typescript
import { TaskManagerFactoryPresets } from "#/index.js";

// Development preset (Memory, 2 threads, no recovery)
const devFactory = TaskManagerFactoryPresets.development();
const devManager = await devFactory.create("dev");

// Production SQLite preset (SQLite, system threads, WAL mode)
const prodSQLiteFactory = TaskManagerFactoryPresets.productionSQLite("./prod.db");
const prodSQLiteManager = await prodSQLiteFactory.create("main");

// Production PostgreSQL preset (PostgreSQL, pool, LISTEN/NOTIFY)
const prodPGFactory = TaskManagerFactoryPresets.productionPostgreSQL(
  "postgresql://user:pass@localhost/db"
);
const prodPGManager = await prodPGFactory.create("main");
```

## Request Configuration

### Basic Job Request

```typescript
interface JobRequest {
  jobFile: string; // Path to job file
  jobPayload: any; // Custom payload data
  jobTimeout?: number; // Optional timeout override
  customId?: string; // Optional custom job ID
}

const request: JobRequest = {
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "value" },
  jobTimeout: 30000, // 30 seconds
  customId: "custom-job-123",
};
```

### Workflow Job Request

```typescript
const workflowRequest: JobRequest = {
  jobFile: "jobs/WorkflowStepJob.ts",
  jobPayload: {
    workflowId: "wf-123",
    stepName: "transform",
    data: { /* ... */ },
  },
};
```

### Batch Job Request

```typescript
const batchRequests = Array.from({ length: 100 }, (_, i) => ({
  jobFile: "jobs/ProcessItemJob.ts",
  jobPayload: { itemId: i },
}));

const promises = batchRequests.map(req =>
  scheduleAndWaitWith(manager, req)
);

await Promise.all(promises);
```

## Response Handling

### Success Response

```typescript
interface JobResult {
  jobId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  retryCount: number;
}

const result: JobResult = await scheduleAndWait({ /* job */ });

if (result.success) {
  console.log("Job completed in", result.executionTime, "ms");
  console.log("Result:", result.result);
}
```

### Error Response

```typescript
if (!result.success) {
  console.error("Job failed:", result.error);
  console.error("Retry count:", result.retryCount);

  // Handle error
  if (result.retryCount >= 3) {
    console.error("Max retries reached, escalating...");
    await escalateError(result.error);
  }
}
```

## API Selection Decision Tree

```
Need job result immediately?
  ├─ Yes → Use scheduleAndWait()
  │
  └─ No → Need result later?
            ├─ Yes → Use schedule() and getJob()
            └─ No → Use schedule() (fire-and-forget)

Multiple instances needed?
  ├─ Yes → Use factory pattern
  │           createTaskManager(name, config)
  │           scheduleAndWaitWith(manager, job)
  │           destroyTaskManager(name)
  │
  └─ No → Use singleton pattern (legacy)
            initializeTaskManager(config)
            scheduleAndWait(job)
            shutdown()
```

## Error Handling Patterns

### Try-Catch Wrapper

```typescript
try {
  const result = await scheduleAndWait({
    jobFile: "jobs/RiskyJob.ts",
    jobPayload: { data: "value" },
  });
  console.log("Success:", result);
} catch (error) {
  console.error("Job scheduling failed:", error);

  if (error instanceof JobError) {
    // Handle job-specific error
    console.error("Job code:", error.jobCode);
  } else {
    // Handle system error
    console.error("System error:", error.message);
  }
}
```

### Timeout Handling

```typescript
const result = await scheduleAndWait({
  jobFile: "jobs/SlowJob.ts",
  jobPayload: { iterations: 1000 },
  jobTimeout: 30000, // 30 seconds
});

if (!result.success && result.executionTime >= 30000) {
  console.warn("Job timed out after 30 seconds");

  // Schedule retry with longer timeout
  const retry = await scheduleAndWait({
    jobFile: "jobs/SlowJob.ts",
    jobPayload: { ...result.jobPayload },
    jobTimeout: 60000, // 60 seconds
  });
}
```

### Retry Logic

```typescript
async function executeWithRetry(
  jobRequest: JobRequest,
  maxRetries: number = 3
): Promise<JobResult> {
  let lastResult: JobResult | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await scheduleAndWait(jobRequest);

    if (lastResult.success) {
      return lastResult;
    }

    console.warn(`Attempt ${attempt} failed:`, lastResult.error);

    if (attempt < maxRetries) {
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return lastResult!; // All retries exhausted
}
```
