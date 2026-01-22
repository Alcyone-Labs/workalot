# Job Development Gotchas

## Common Pitfalls

### Not Extending BaseJob

**Problem**: Job doesn't have access to validation methods.

**Symptoms**: `this.validatePayload is not a function`

**Fix**:
```typescript
// BAD - Doesn't extend BaseJob
export class MyJob {
  async run(payload: any): Promise<any> {
    // Can't call this.validatePayload()
  }
}

// GOOD - Extends BaseJob
import { BaseJob } from "#/jobs/BaseJob.js";
export default class MyJob extends BaseJob implements IJob {
  async run(payload: any): Promise<any> {
    this.validatePayload(payload, { required: ["id"] });
  }
}
```

### Missing Implements IJob

**Problem**: TypeScript type errors, job not recognized as valid job.

**Symptoms**: `Class does not correctly implement interface 'IJob'`

**Fix**:
```typescript
// BAD - Missing implements
export default class MyJob extends BaseJob {
  async run(payload: any): Promise<any> {
  }
}

// GOOD - Implements IJob
import { BaseJob, IJob } from "#/jobs/BaseJob.js";
export default class MyJob extends BaseJob implements IJob {
  async run(payload: any): Promise<any> {
  }
}
```

### Synchronous Operations in Jobs

**Problem**: Blocking operations block worker thread, delay other jobs.

**Symptoms**: Queue stalls, high latency, poor throughput

**Fix**:
```typescript
// BAD - Synchronous file operations
async run(payload: any): Promise<any> {
  const data = fs.readFileSync(payload.path, "utf-8"); // Blocks!
  return this.success({ data });
}

// GOOD - Asynchronous operations
import { readFile } from "fs/promises";
async run(payload: any): Promise<any> {
  const data = await readFile(payload.path, "utf-8"); // Non-blocking!
  return this.success({ data });
}
```

### Ignoring Timeouts

**Problem**: Long-running jobs don't respect timeout, waste resources.

**Symptoms**: Jobs run forever, queue stuck

**Fix**:
```typescript
// BAD - Infinite loop
async run(payload: any): Promise<any> {
  while (true) {
    // Process forever - no timeout check!
  }
}

// GOOD - Timeout-aware
async run(payload: any): Promise<any> {
  const startTime = Date.now();
  const timeout = 30000; // 30 seconds

  while (Date.now() - startTime < timeout) {
    const hasMore = await this.processBatch();

    if (!hasMore) break;
  }

  return this.success({ processed: true });
}
```

### Not Validating Inputs

**Problem**: Invalid payloads cause crashes, data corruption.

**Symptoms**: Jobs fail with cryptic errors, unexpected behavior

**Fix**:
```typescript
// BAD - No validation
async run(payload: any): Promise<any> {
  const result = payload.value * 2; // Crashes if undefined!
  return this.success({ result });
}

// GOOD - Validate first
async run(payload: any): Promise<any> {
  this.validatePayload(payload, {
    required: ["value"],
    types: { value: "number" },
  });

  const result = payload.value * 2;
  return this.success({ result });
}
```

### Not Cleaning Up Resources

**Problem**: Unclosed connections, file handles cause resource leaks.

**Symptoms**: Memory usage grows, connection pool exhausted, file handles limit reached

**Fix**:
```typescript
// BAD - Resources never cleaned up
async run(payload: any): Promise<any> {
  const connection = await createDatabaseConnection();
  const data = await connection.query("SELECT * FROM table");

  return this.success({ data });
  // Connection never closed!
}

// GOOD - Always cleanup in finally
async run(payload: any): Promise<any> {
  let connection;

  try {
    connection = await createDatabaseConnection();
    const data = await connection.query("SELECT * FROM table");

    return this.success({ data });
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}
```

### Not Handling Context MetaEnvelope

**Problem**: Workflow jobs lose accumulated context between steps.

**Symptoms**: Later steps can't access previous step results

**Fix**:
```typescript
// BAD - Ignores meta envelope
async run(payload: any, context?: JobExecutionContext): Promise<any> {
  // Processes in isolation - no workflow state!
  const result = await this.process(payload);
  return this.success({ result });
}

// GOOD - Updates meta envelope
async run(payload: any, context?: JobExecutionContext): Promise<any> {
  if (!context?.metaEnvelope) {
    // Initialize if first step
    context.metaEnvelope = {
      workflowId: payload.workflowId || "default",
      stepNumber: 1,
      previousResults: [],
      metadata: {},
    };
  }

  const result = await this.process(payload);

  // Add result to envelope
  context.metaEnvelope.previousResults.push({
    step: this.constructor.name,
    result,
    timestamp: new Date().toISOString(),
  });

  context.metaEnvelope.stepNumber++;

  return this.success({
    result,
    workflowProgress: context.metaEnvelope,
  });
}
```

### Returning Wrong Format

**Problem**: Job results not recognized by orchestrator.

**Symptoms**: Jobs marked as failed despite returning success

**Fix**:
```typescript
// BAD - Returns raw value
async run(payload: any): Promise<any> {
  const result = processData(payload);
  return result; // Not formatted!
}

// GOOD - Returns via this.success()
async run(payload: any): Promise<any> {
  const result = processData(payload);
  return this.success({ result, processedAt: new Date().toISOString() });
}
```

### Not Handling Errors Properly

**Problem**: Errors not caught or returned incorrectly.

**Symptoms**: Worker crashes, job marked as timeout instead of failed

**Fix**:
```typescript
// BAD - Not catching errors
async run(payload: any): Promise<any> {
  const result = riskyOperation(payload); // Throws!
  return this.success({ result });
}

// GOOD - Wrap in try-catch
async run(payload: any): Promise<any> {
  try {
    const result = await riskyOperation(payload);
    return this.success({ result });
  } catch (error) {
    return this.error(
      `Operation failed: ${error}`,
      {
        payload,
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }
}
```

### Not Returning Explicit Error

**Problem**: Generic error messages make debugging difficult.

**Symptoms**: Vague failure reasons, hard to diagnose issues

**Fix**:
```typescript
// BAD - Generic error
async run(payload: any): Promise<any> {
  try {
    await processData(payload);
  } catch (error) {
    return this.error("Failed"); // What failed?
  }
}

// GOOD - Detailed error
async run(payload: any): Promise<any> {
  try {
    await processData(payload);
  } catch (error) {
    return this.error(
      `Processing failed at step 3: ${error}`,
      {
        payload,
        step: "processing",
        errorDetails: error instanceof Error ? error.message : "Unknown",
      }
    );
  }
}
```

### Modifying Payload Directly

**Problem**: Mutating input causes side effects in workflows.

**Symptoms**: Later workflow steps see modified data, unexpected behavior

**Fix**:
```typescript
// BAD - Mutates payload
async run(payload: any): Promise<any> {
  payload.processed = true; // Mutates input!
  return this.success({ result: payload });
}

// GOOD - Creates new object
async run(payload: any): Promise<any> {
  const processed = {
    ...payload,
    processed: true,
  };
  return this.success({ result: processed });
}
```

### Ignoring Job Context

**Problem**: Jobs don't access context for metadata/metrics.

**Symptoms**: No correlation tracking, missing timing data

**Fix**:
```typescript
// BAD - Ignores context parameter
async run(payload: any): Promise<any> {
  const startTime = Date.now();
  const result = await process(payload);
  return this.success({ result });
}

// GOOD - Uses context for timing
async run(payload: any, context?: JobExecutionContext): Promise<any> {
  const startTime = Date.now();
  const result = await process(payload);
  const duration = Date.now() - startTime;

  return this.success({
    result,
    duration,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
  });
}
```

### Over-Vebose Logging

**Problem**: Excessive logging degrades performance, fills logs.

**Symptoms**: High CPU usage from logging, slow jobs, disk I/O pressure

**Fix**:
```typescript
// BAD - Logs everything
async run(payload: any): Promise<any> {
  console.log("Starting job", payload);
  console.log("Processing item 1");
  console.log("Processing item 2");
  console.log("Processing item 3");
  // ... 1000 more logs
  console.log("Job completed");
  return this.success({ result });
}

// GOOD - Logs key events
async run(payload: any): Promise<any> {
  console.log(`Starting job for payload: ${JSON.stringify(payload)}`);

  const result = await process(payload);

  console.log(`Job completed in ${Date.now() - startTime}ms`);

  return this.success({ result });
}
```

### Not Using Custom Job IDs

**Problem**: Can't track duplicate prevention or custom correlation.

**Symptoms**: Random ULIDs, no deduplication possible

**Fix**:
```typescript
// BAD - Default ULID job IDs
async run(payload: any): Promise<any> {
  // Job gets random ULID
  return this.success({ result });
}

// GOOD - Deterministic custom ID
export default class TrackedJob extends BaseJob implements IJob {
  getJobId(payload: { userId: number; action: string }): string {
    return `user-${payload.userId}-${payload.action}-${Date.now()}`;
  }

  async run(payload: any): Promise<any> {
    // Job gets deterministic ID for deduplication
    return this.success({ result });
  }
}
```

### Blocking Worker Thread

**Problem**: CPU-intensive loops block other jobs.

**Symptoms**: Poor throughput, queue backlog grows

**Fix**:
```typescript
// BAD - Blocking loop
async run(payload: { count: number }): Promise<any> {
  for (let i = 0; i < payload.count; i++) {
    heavyComputation(i); // Blocks for 10ms each
  }
  return this.success({ processed: payload.count });
}

// GOOD - Yield control periodically
async run(payload: { count: number }): Promise<any> {
  const BATCH_SIZE = 100;

  for (let i = 0; i < payload.count; i += BATCH_SIZE) {
    for (let j = 0; j < BATCH_SIZE && i + j < payload.count; j++) {
      heavyComputation(i + j);
    }

    // Yield control to worker thread
    await new Promise(resolve => setImmediate(resolve));
  }

  return this.success({ processed: payload.count });
}
}
```
