# Migration Guide

This guide covers migrating from Workalot v1.x to v2.x.

## Breaking Changes

### API Changes

| v1.x                   | v2.x                 | Notes                   |
| ---------------------- | -------------------- | ----------------------- |
| `TaskManagerSingleton` | `TaskManagerFactory` | New factory pattern     |
| `scheduleNow()`        | `scheduleAndWait()`  | Renamed for clarity     |
| Callback-based         | `async/await`        | Modern async patterns   |
| `postMessage`          | `WebSocket`          | New communication layer |

### Constructor Changes

```typescript
// v1.x
const manager = TaskManagerSingleton.getInstance({
  maxWorkers: 4,
});

// v2.x
const factory = new TaskManagerFactory();
const manager = await factory.create("default", {
  maxThreads: 4,
});
```

### Schedule Method Changes

```typescript
// v1.x
manager.scheduleNow(jobFile, payload, callback);

// v2.x
const result = await manager.scheduleAndWait({
  jobFile: "jobs/MyJob.ts",
  jobPayload: payload,
});

// Fire-and-forget
const jobId = await manager.schedule({
  jobFile: "jobs/MyJob.ts",
  jobPayload: payload,
});
```

### Backend Configuration

```typescript
// v1.x
const manager = new TaskManager({
  type: "memory", // or "redis", "postgres"
  url: "redis://localhost",
});

// v2.x
const manager = new TaskManager({
  backend: "memory", // "memory", "sqlite", "postgresql", "redis", "pglite"
  databaseUrl: "redis://localhost:6379",
});
```

## Migration Steps

### 1. Update Dependencies

```bash
pnpm remove workalot
pnpm add workalot@^2.0.0
```

### 2. Update Job Files

v1.x jobs used a different signature:

```typescript
// v1.x
class MyJob {
  async run(payload, done) {
    done(null, { result: payload.data });
  }
}
```

v2.x jobs extend BaseJob:

```typescript
// v2.x
import { BaseJob } from "workalot";

export class MyJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    return this.createSuccessResult({
      result: payload.data,
    });
  }
}
```

### 3. Update Application Code

```typescript
// v1.x
import { TaskManagerSingleton } from "workalot";

TaskManagerSingleton.initialize({ maxWorkers: 4 });

TaskManagerSingleton.scheduleNow("jobs/MyJob.ts", { data: "test" }, (err, result) => {
  console.log(result);
});

TaskManagerSingleton.shutdown();
```

```typescript
// v2.x
import { TaskManager, TaskManagerFactory } from "workalot";

// Option 1: Factory pattern (recommended)
const factory = new TaskManagerFactory();
const manager = await factory.create("default", {
  backend: "memory",
  maxThreads: 4,
});

const result = await manager.scheduleAndWait({
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "test" },
});

await factory.destroyAll();

// Option 2: Singleton (still available)
import { initializeTaskManager, scheduleAndWait, shutdown } from "workalot";

await initializeTaskManager({ backend: "memory" });

const result = await scheduleAndWait({
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "test" },
});

await shutdown();
```

### 4. Update Callback Usage

```typescript
// v1.x - whenFree with callback
manager.whenFree(() => {
  console.log("Queue is empty");
});

// v2.x - whenFree with callback (same API)
manager.whenFree(() => {
  console.log("Queue is empty");
});

// v2.x - whenIdle with promise
await manager.whenIdle(30000); // 30 second timeout
```

### 5. Update Status Methods

```typescript
// v1.x
const status = manager.getStatus();
const workers = manager.getWorkers();

// v2.x
const status = await manager.getStatus();
const workers = await manager.getWorkerStats();
const queueStats = await manager.getQueueStats();
```

### 6. Update Error Handling

```typescript
// v1.x
manager.scheduleNow("job.ts", payload, (err, result) => {
  if (err) {
    console.error("Job failed:", err);
    return;
  }
  console.log("Result:", result);
});

// v2.x
try {
  const result = await manager.scheduleAndWait({
    jobFile: "jobs/MyJob.ts",
    jobPayload: payload,
  });
  console.log("Result:", result.results);
} catch (error) {
  console.error("Job failed:", error.message);
}
```

## New Features in v2.x

### Factory Pattern

Multiple isolated instances:

```typescript
const factory = new TaskManagerFactory();

const mainQueue = await factory.create("main", {
  backend: "postgresql",
});

const backgroundQueue = await factory.create("background", {
  backend: "memory",
});

const priorityQueue = await factory.create("priority", {
  backend: "redis",
});
```

### WebSocket Communication

Distributed workers use WebSocket:

```typescript
const manager = new TaskManager({
  wsPort: 8080,
  wsHostname: "0.0.0.0",
});
```

### Job Recovery

Automatic stalled job recovery:

```typescript
const manager = new TaskManager({
  jobRecoveryEnabled: true,
  healthCheckInterval: 30000,
});
```

### Batch Processing

High-throughput batch jobs:

```typescript
scheduler.setBatchConfig({
  batchSize: 100,
  enabled: true,
});
```

### Meta Envelopes

Workflow chaining:

```typescript
await manager.scheduleAndWait({
  jobFile: "jobs/Step1.ts",
  jobPayload: { data: "input" },
  metaEnvelope: {
    workflowId: "wf-123",
    stepNumber: 1,
  },
});
```

## Complete Migration Example

### Before (v1.x)

```typescript
// main.ts
const TaskManagerSingleton = require("workalot").TaskManagerSingleton;

TaskManagerSingleton.initialize({
  type: "redis",
  url: process.env.REDIS_URL,
  maxWorkers: 4,
});

function processOrder(order) {
  return new Promise((resolve, reject) => {
    TaskManagerSingleton.scheduleNow("jobs/ProcessOrder.ts", { order }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function onAllComplete() {
  console.log("All orders processed");
  TaskManagerSingleton.shutdown();
}

// Usage
processOrder({ id: 1, items: ["a", "b"] })
  .then(() => processOrder({ id: 2, items: ["c"] }))
  .then(() => {
    if (TaskManagerSingleton.isQueueEmpty()) {
      onAllComplete();
    } else {
      TaskManagerSingleton.whenQueueEmpty(onAllComplete);
    }
  });
```

### After (v2.x)

```typescript
// main.ts
import { TaskManagerFactory } from "workalot";

async function main() {
  const factory = new TaskManagerFactory();

  const mainQueue = await factory.create("main", {
    backend: "redis",
    databaseUrl: process.env.REDIS_URL,
    maxThreads: 4,
  });

  async function processOrder(order) {
    const result = await mainQueue.scheduleAndWait({
      jobFile: "jobs/ProcessOrder.ts",
      jobPayload: { order },
    });
    return result;
  }

  // Usage
  await processOrder({ id: 1, items: ["a", "b"] });
  await processOrder({ id: 2, items: ["c"] });

  await mainQueue.whenIdle();
  console.log("All orders processed");

  await factory.destroyAll();
}

main().catch(console.error);
```

## Rollback Plan

If issues arise, you can temporarily use the compatibility layer:

```typescript
// Add this shim file for gradual migration
import { TaskManager } from "workalot";

export class LegacyTaskManager {
  private manager: TaskManager;

  constructor(config: any) {
    this.manager = new TaskManager({
      backend: config.type,
      databaseUrl: config.url,
      maxThreads: config.maxWorkers,
    });
  }

  async initialize() {
    await this.manager.initialize();
  }

  scheduleNow(jobFile: string, payload: any, callback: (err: Error | null, result?: any) => void) {
    this.manager
      .scheduleAndWait({
        jobFile,
        jobPayload: payload,
      })
      .then((result) => callback(null, result))
      .catch((err) => callback(err));
  }

  getStatus() {
    return this.manager.getStatus();
  }

  shutdown() {
    return this.manager.shutdown();
  }
}
```

## Testing Migration

1. **Run existing tests** with v2.x
2. **Update test expectations** for new API
3. **Test error handling** with new patterns
4. **Benchmark performance** to ensure no regression
5. **Test failure scenarios** with job recovery

## Known Issues

### Path Resolution

Job files are now resolved relative to project root:

```typescript
// Ensure jobFile paths are correct
const jobId = await manager.schedule({
  jobFile: "jobs/MyJob.ts", // Relative to projectRoot
  jobPayload: payload,
});
```

### Callback Context

Old callbacks that relied on `this` context need updates:

```typescript
// v1.x - this might refer to TaskManagerSingleton
manager.scheduleNow("job.ts", payload, function (err, result) {
  // this.getStatus() worked
});

// v2.x - use arrow functions or pass manager reference
manager
  .scheduleAndWait({
    jobFile: "jobs/MyJob.ts",
    jobPayload: payload,
  })
  .then((result) => {
    manager.getStatus(); // Use manager directly
  });
```
