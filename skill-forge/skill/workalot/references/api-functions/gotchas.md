# API Functions Gotchas

## Singleton Pitfalls

### Using Singleton in Tests

**Problem**: Tests share state, one test affects another.

**Symptoms**: Flaky tests, state leakage between tests

**Fix**:
```typescript
// BAD - Tests share singleton
import { scheduleAndWait } from "#/index.js";

test("test 1", async () => {
  const result = await scheduleAndWait({ /* job */ });
  // Test 2 sees this job!
});

// GOOD - Each test gets fresh instance
import { createTaskManager, scheduleAndWaitWith, destroyTaskManager } from "#/index.js";

let manager: TaskManager;

beforeEach(async () => {
  manager = await createTaskManager("test", { backend: "memory" });
});

afterEach(async () => {
  await destroyTaskManager("test");
});

test("test 1", async () => {
  const result = await scheduleAndWaitWith(manager, { /* job */ });
  // Test 2 is isolated
});
```

### Singleton Name Collisions

**Problem**: Multiple parts of app try to create same-named singleton.

**Symptoms**: "TaskManager 'main' already exists" errors

**Fix**:
```typescript
// BAD - Same name used everywhere
const main1 = await createTaskManager("main", { /* config */ });
const main2 = await createTaskManager("main", { /* config */ }); // Error!

// GOOD - Use unique names or factory pattern
const orderManager = await createTaskManager("orders", { /* config */ });
const inventoryManager = await createTaskManager("inventory", { /* config */ });

// Or use factory for multiple instances
const factory = new TaskManagerFactory({ /* config */ });
const manager1 = await factory.create("instance1");
const manager2 = await factory.create("instance2");
```

## Factory Pitfalls

### Not Destroying Managers

**Problem**: Unclosed managers cause resource leaks (database connections, worker threads).

**Symptoms**: Connection pool exhaustion, high memory usage, process hangs on exit

**Fix**:
```typescript
// BAD - Never destroyed
class Service {
  async start() {
    this.manager = await createTaskManager("service", { /* config */ });
  }

  async stop() {
    // Manager never destroyed!
  }
}

// GOOD - Always cleanup
class Service {
  async stop() {
    try {
      // Wait for queue to drain
      await whenFreeWith(this.manager, async () => {
        await destroyTaskManager("service");
        console.log("Manager destroyed");
      });
    } catch (error) {
      console.error("Error during shutdown:", error);
      await destroyTaskManager("service");
      throw error;
    }
  }
}
```

### Mixed API Usage

**Problem**: Calling singleton functions with factory-created managers.

**Symptoms**: Jobs scheduled to wrong queue, errors, undefined behavior

**Fix**:
```typescript
// BAD - Mixed usage
const factory = new TaskManagerFactory({ /* config */ });
const manager = await factory.create("main");
const result = await scheduleAndWait({ /* job */ }); // Uses singleton!

// GOOD - Use manager-specific functions
const result = await scheduleAndWaitWith(manager, { /* job */ });
```

## Job Request Pitfalls

### Invalid Job File Paths

**Problem**: Relative paths or wrong extensions cause job loading failures.

**Symptoms**: `Job file not found or not readable` errors

**Fix**:
```typescript
// BAD - Wrong path
const result = await scheduleAndWait({
  jobFile: "./jobs/MyJob.ts", // Resolved relative to wrong location
  jobPayload: { /* ... */ },
});

// GOOD - Use paths relative to project root
const result = await scheduleAndWait({
  jobFile: "jobs/MyJob.ts", // Resolved from project root
  jobPayload: { /* ... */ },
});
```

### Missing Timeout Configuration

**Problem**: Jobs run forever, blocking queue, wasting resources.

**Symptoms**: Jobs never complete, queue stalls, high processing count

**Fix**:
```typescript
// BAD - No timeout
const result = await scheduleAndWait({
  jobFile: "jobs/InfiniteJob.ts",
  jobPayload: { /* ... */ },
});

// GOOD - Set reasonable timeout
const result = await scheduleAndWait({
  jobFile: "jobs/LongJob.ts",
  jobPayload: { /* ... */ },
  jobTimeout: 30000, // 30 seconds
});
```

### Oversized Payloads

**Problem**: Large payloads cause memory issues, serialization errors, slow processing.

**Symptoms**: Out of memory errors, slow scheduling, worker crashes

**Fix**:
```typescript
// BAD - Large direct payload
const result = await scheduleAndWait({
  jobFile: "jobs/ProcessJob.ts",
  jobPayload: { data: hugeArray }, // >10MB!
});

// GOOD - Store externally, reference in payload
const reference = await storeInS3(hugeArray);

const result = await scheduleAndWait({
  jobFile: "jobs/ProcessJob.ts",
  jobPayload: { _ref: reference },
});

// In job, load from S3
const data = await loadFromS3(payload._ref);
```

## Configuration Pitfalls

### Wrong Backend for Environment

**Problem**: Using Memory in production (data loss on restart).

**Symptoms**: Jobs disappear after restart, data loss

**Fix**:
```typescript
// BAD - Production with memory
const manager = await createTaskManager("prod", {
  backend: "memory", // Jobs lost on restart!
});

// GOOD - Production with persistence
const manager = await createTaskManager("prod", {
  backend: "sqlite", // or postgresql/redis
  databaseUrl: process.env.DATABASE_URL || "./queue.db",
});
```

### Insufficient Worker Count

**Problem**: Too few workers cause queue buildup, poor throughput.

**Symptoms**: Jobs waiting, slow processing, high latency

**Fix**:
```typescript
// BAD - Only 2 workers on 8-core machine
const manager = await createTaskManager("main", {
  maxThreads: 2,
});

// GOOD - Use system default
const manager = await createTaskManager("main", {
  maxThreads: undefined, // os.cpus().length - 2
});
```

### Excessive Logging

**Problem**: High CPU usage from logging, poor performance.

**Symptoms**: Slow jobs, high CPU usage, large log files

**Fix**:
```typescript
// BAD - Verbose logging in production
const manager = await createTaskManager("prod", {
  silent: false, // Logs everything!
});

// GOOD - Silent in production
const manager = await createTaskManager("prod", {
  silent: true, // Reduce logs
});
```

## Monitoring Pitfalls

### Polling Too Frequently

**Problem**: Excessive health checks waste resources.

**Symptoms**: High CPU usage, slowed job processing

**Fix**:
```typescript
// BAD - Check every 100ms
setInterval(async () => {
  const stats = await getQueueStats();
  console.log(stats);
}, 100);

// GOOD - Check every 30-60 seconds
setInterval(async () => {
  const stats = await getQueueStats();
  console.log(stats);
}, 30000); // 30 seconds
```

### Not Handling Queue Drain

**Problem**: Shutdown kills active jobs, data loss, corruption.

**Symptoms**: Jobs marked as processing but never complete

**Fix**:
```typescript
// BAD - Immediate shutdown
async function shutdown() {
  await destroyTaskManager("main");
  console.log("Shutdown");
}

// GOOD - Wait for queue to empty
async function shutdown() {
  console.log("Draining queue...");

  await whenFree(async () => {
    await destroyTaskManager("main");
    console.log("Shutdown complete");
  });
}
```

## Error Handling Pitfalls

### Swallowing Errors

**Problem**: Errors not propagated, jobs marked as success.

**Symptoms**: Silent failures, incorrect results, hard to debug

**Fix**:
```typescript
// BAD - Silently catches errors
try {
  const result = await scheduleAndWait({ /* job */ });
  return result;
} catch (error) {
  console.error(error);
  return { success: true }; // Swallows error!
}

// GOOD - Propagate errors
try {
  const result = await scheduleAndWait({ /* job */ });
  return result;
} catch (error) {
  console.error("Job failed:", error);
  throw error; // Let caller handle
}
```

### Not Checking Success Flag

**Problem**: Assuming job succeeded when it failed.

**Symptoms**: Processing failed data, cascading errors

**Fix**:
```typescript
const result = await scheduleAndWait({ /* job */ });

// BAD - Doesn't check
console.log("Result:", result.result);

// GOOD - Check success flag
if (result.success) {
  console.log("Success:", result.result);
} else {
  console.error("Failed:", result.error);
}
```

## Resource Management Pitfalls

### Forgetting to Close Connections

**Problem**: Database connections accumulate, cause pool exhaustion.

**Symptoms**: Connection errors, resource leaks, connection timeouts

**Fix**:
```typescript
// BAD - Connection never closed
class DatabaseService {
  async getData() {
    const conn = await createConnection();
    const data = await conn.query("SELECT * FROM table");
    return data;
    // Connection never closed!
  }
}

// GOOD - Always close in finally
class DatabaseService {
  async getData() {
    let conn;

    try {
      conn = await createConnection();
      const data = await conn.query("SELECT * FROM table");
      return data;
    } finally {
      if (conn) {
        await conn.close();
      }
    }
  }
}
```

### Not Cleaning Up Workers

**Problem**: Worker threads accumulate, cause memory leaks.

**Symptoms**: Memory usage grows over time, OOM errors

**Fix**:
```typescript
// BAD - Workers never cleaned up
const manager = await createTaskManager("main", { /* config */ });

// Never destroyed!

// GOOD - Always destroy
try {
  await processJobs();
} finally {
  await destroyTaskManager("main");
}
```
