# Job Creation Guide

This guide explains how to create, structure, and test custom job classes in Workalot.

## Basic Job Structure

All jobs extend the abstract `BaseJob` class:

```typescript
import { BaseJob } from "workalot";

export class MyJob extends BaseJob {
  constructor() {
    super("MyJob"); // Unique job name
  }

  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Validate input
    this.validatePayload(payload, ["requiredField"]);

    // Process data
    const result = await this.process(payload);

    // Return result
    return this.createSuccessResult({
      processed: result,
      timestamp: new Date().toISOString(),
    });
  }

  private async process(payload: Record<string, any>): Promise<any> {
    // Job implementation
    return { data: payload.data };
  }
}
```

## Job File Location

Jobs are resolved relative to the project root specified in TaskManager configuration:

```
project-root/
├── jobs/
│   ├── EmailJob.ts
│   ├── DataProcessor.ts
│   └── ReportGenerator.ts
├── app.ts
└── package.json
```

```typescript
const manager = new TaskManager({}, "/path/to/project");

// Loads /path/to/project/jobs/EmailJob.ts
await manager.scheduleAndWait({
  jobFile: "jobs/EmailJob.ts",
  jobPayload: { to: "user@example.com" },
});
```

## Payload Validation

Use the built-in validation helper:

```typescript
async run(payload: Record<string, any>): Promise<Record<string, any>> {
  this.validatePayload(payload, [
    "action",      // Required field
    "userId",      // Required field
  ]);

  // Custom validation
  if (payload.priority && (payload.priority < 1 || payload.priority > 5)) {
    throw new Error("Priority must be between 1 and 5");
  }

  // ...
}
```

**Throws:** `JobValidationError` if required field is missing

## Result Types

### Success Result

```typescript
return this.createSuccessResult({
  processedItems: 100,
  outputFile: "/path/to/output.csv",
});
```

Returns:

```typescript
{
  success: true,
  data: {
    processedItems: 100,
    outputFile: "/path/to/output.csv",
  },
  timestamp: "2024-01-15T10:30:00.000Z",
}
```

### Error Result

```typescript
return this.createErrorResult("Processing failed", {
  errorCode: "INVALID_INPUT",
  attemptedItems: payload.items?.length || 0,
});
```

Returns:

```typescript
{
  success: false,
  error: "Processing failed",
  details: {
    errorCode: "INVALID_INPUT",
    attemptedItems: 0,
  },
  timestamp: "2024-01-15T10:30:00.000Z",
}
```

## Scheduling Jobs from Within Jobs

Jobs can schedule other jobs using the execution context:

```typescript
import { BaseJob, JobExecutionContext } from "workalot";

export class PipelineJob extends BaseJob {
  async run(
    payload: Record<string, any>,
    context: JobExecutionContext,
  ): Promise<Record<string, any>> {
    // Step 1: Process data
    const processed = await this.processData(payload);

    // Step 2: Schedule cleanup job
    context.schedule({
      jobFile: "jobs/CleanupJob.ts",
      jobPayload: { inputFile: processed.outputPath },
    });

    // Return immediately (cleanup runs asynchronously)
    return this.createSuccessResult({
      processed: true,
      cleanupScheduled: true,
    });
  }

  private async processData(payload: Record<string, any>): Promise<any> {
    // ...
  }
}
```

### Waiting for Scheduled Jobs

```typescript
async run(
  payload: Record<string, any>,
  context: JobExecutionContext
): Promise<Record<string, any>> {
  // Schedule and wait for each step
  const step1Result = await context.scheduleAndWait({
    jobFile: "jobs/Step1Job.ts",
    jobPayload: { data: payload.data },
  });

  const step2Result = await context.scheduleAndWait({
    jobFile: "jobs/Step2Job.ts",
    jobPayload: { input: step1Result.results.output },
  });

  return this.createSuccessResult({
    step1: step1Result,
    step2: step2Result,
  });
}
```

## Job Types

### Simple Processing Job

```typescript
export class StringProcessor extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["text"]);

    const uppercased = payload.text.toUpperCase();
    const wordCount = uppercased.split(/\s+/).length;

    return this.createSuccessResult({
      processed: uppercased,
      wordCount,
    });
  }
}
```

### I/O Bound Job

```typescript
export class FileProcessor extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["inputPath", "outputPath"]);

    const content = await this.readFile(payload.inputPath);
    const processed = this.transform(content);
    await this.writeFile(payload.outputPath, processed);

    return this.createSuccessResult({ processed: true });
  }

  private readFile(path: string): Promise<string> {
    // Implementation
  }

  private transform(content: string): string {
    // Implementation
  }

  private writeFile(path: string, content: string): Promise<void> {
    // Implementation
  }
}
```

### CPU Intensive Job

```typescript
export class DataAnalyzer extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["datasetId"]);

    const dataset = await this.loadDataset(payload.datasetId);
    const statistics = this.computeStatistics(dataset);
    const visualization = this.generateChart(statistics);

    return this.createSuccessResult({
      statistics,
      chartPath: visualization,
    });
  }

  private computeStatistics(data: number[]): Statistics {
    // CPU-intensive computation
    // Runs in worker thread, won't block main thread
  }
}
```

### External API Job

```typescript
export class ExternalApiJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["endpoint", "method"]);

    const response = await fetch(payload.endpoint, {
      method: payload.method,
      headers: payload.headers || {},
      body: payload.body ? JSON.stringify(payload.body) : undefined,
    });

    const result = await response.json();

    if (!response.ok) {
      return this.createErrorResult(`API failed: ${response.statusText}`, {
        statusCode: response.status,
        response: result,
      });
    }

    return this.createSuccessResult({ data: result });
  }
}
```

## Job Configuration

### Job-Specific Timeout

```typescript
await manager.scheduleAndWait({
  jobFile: "jobs/LongJob.ts",
  jobPayload: { data: "large" },
  jobTimeout: 120000, // 2 minutes
});
```

### Workflow Metadata

```typescript
await manager.scheduleAndWait({
  jobFile: "jobs/Step1.ts",
  jobPayload: { data: "input" },
  metaEnvelope: {
    workflowId: "wf-123",
    stepNumber: 1,
    sequenceNo: 1,
    metadata: { source: "user-upload" },
  },
});
```

## Error Handling

### Throwing Errors

```typescript
async run(payload: Record<string, any>): Promise<Record<string, any>> {
  try {
    const result = await this.riskyOperation(payload);
    return this.createSuccessResult(result);
  } catch (error) {
    // Error is captured and job marked as failed
    throw new Error(`Operation failed: ${error.message}`);
  }
}
```

### Returning Error Results

```typescript
async run(payload: Record<string, any>): Promise<Record<string, any>> {
  const validation = this.validateInput(payload);
  if (!validation.valid) {
    return this.createErrorResult("Invalid input", {
      errors: validation.errors,
    });
  }

  // Process...
}
```

## Testing Jobs

### Unit Testing

```typescript
import { describe, it, expect } from "vitest";
import { MyJob } from "./jobs/MyJob";

describe("MyJob", () => {
  it("should process valid payload", async () => {
    const job = new MyJob();
    const result = await job.run({ data: "test" });

    expect(result.success).toBe(true);
    expect(result.data.processed).toBe("TEST");
  });

  it("should throw on missing required field", async () => {
    const job = new MyJob();

    await expect(job.run({})).rejects.toThrow("Missing required field");
  });
});
```

### Integration Testing with TaskManager

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TaskManager } from "workalot";

describe("Job Integration", () => {
  let manager: TaskManager;

  beforeAll(async () => {
    manager = new TaskManager({ backend: "memory" });
    await manager.initialize();
  });

  afterAll(async () => {
    await manager.shutdown();
  });

  it("should execute job successfully", async () => {
    const result = await manager.scheduleAndWait({
      jobFile: "jobs/TestJob.ts",
      jobPayload: { testData: "value" },
    });

    expect(result.results.success).toBe(true);
    expect(result.executionTime).toBeGreaterThan(0);
  });
});
```

## Best Practices

1. **Single Responsibility**: Each job should do one thing well
2. **Idempotency**: Jobs should be safe to retry
3. **Error Handling**: Return error results instead of throwing when appropriate
4. **Validation**: Validate payload early with `validatePayload()`
5. **Timeout Configuration**: Set appropriate timeouts for long-running jobs
6. **Documentation**: Document job inputs, outputs, and side effects
7. **Testing**: Write unit tests for job logic independently

## Common Patterns

### Retry Pattern

```typescript
export class RetryJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const maxRetries = payload.maxRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.attemptOperation(payload);
        return this.createSuccessResult({ attempt, result });
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          await this.delay(1000 * attempt); // Exponential backoff
        }
      }
    }

    return this.createErrorResult(`Failed after ${maxRetries} attempts`, {
      error: lastError?.message,
    });
  }
}
```

### Batching Pattern

```typescript
export class BatchProcessor extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["items"]);

    const batchSize = payload.batchSize || 100;
    const items = payload.items;
    const results = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResult = await this.processBatch(batch);
      results.push(...batchResult);
    }

    return this.createSuccessResult({
      processed: results.length,
      results,
    });
  }
}
```

### Chaining Pattern

```typescript
export class ChainJob extends BaseJob {
  async run(
    payload: Record<string, any>,
    context: JobExecutionContext,
  ): Promise<Record<string, any>> {
    const results = [];

    // Execute steps in sequence
    for (const step of payload.steps) {
      const stepResult = await context.scheduleAndWait({
        jobFile: `jobs/steps/${step}.ts`,
        jobPayload: { input: payload.input },
      });
      results.push(stepResult);
      payload.input = stepResult.results.output;
    }

    return this.createSuccessResult({ steps: results });
  }
}
```
