# Job Development Configuration

## Job Timeout Configuration

```typescript
// Set job timeout when scheduling
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/LongJob.ts",
  jobPayload: { iterations: 1000 },
  jobTimeout: 30000, // 30 seconds
});

// Or configure default timeout for all jobs
const manager = await createTaskManager("main", {
  backend: "sqlite",
  maxThreads: 4,
  // Worker default timeout is 5000ms (5 seconds)
});
```

## Worker-Specific Configuration

```typescript
// Worker configuration for job execution
import { SimpleWorker } from "#/index.js";

const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
  defaultTimeout: 30000, // Default timeout for all jobs from this worker
});
```

## Job Retry Configuration

```typescript
// Queue configuration for job retries
const manager = await createTaskManager("main", {
  backend: "sqlite",
  jobRecoveryEnabled: true, // Enables stalled job recovery
  maxInMemoryAge: 24 * 60 * 60 * 1000, // 24 hours retention
});
```

## Job Priority Configuration

```typescript
// Schedule with priority (if backend supports it)
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/PriorityJob.ts",
  jobPayload: { data: "value" },
  // Priority queues coming in v2.1 (check roadmap)
  // priority: 10, // Higher number = higher priority
});
```

## Job Metadata Configuration

```typescript
// Add metadata to job
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/MetadataJob.ts",
  jobPayload: {
    data: "value",
    tags: ["processing", "analytics"], // Custom tags
    timeoutMs: 10000, // Job-specific timeout
  },
});
```

## Workflow Configuration

```typescript
// Configure workflow jobs with meta envelope
const manager = await createTaskManager("main", {
  backend: "sqlite",
});

// Schedule multi-step workflow
const step1 = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/WorkflowStep1.ts",
  jobPayload: {
    workflowId: "wf-123",
    stepName: "extract",
    data: {
      /* ... */
    },
  },
});

// Step 1 result includes meta envelope
const metaEnvelope = step1.result?.workflowProgress;

// Schedule step 2 with meta envelope
const step2 = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/WorkflowStep2.ts",
  jobPayload: {
    metaEnvelope, // Pass accumulated context
    stepName: "transform",
    data: {
      /* ... */
    },
  },
});
```

## Job Validation Configuration

```typescript
// Define validation rules in job
export default class ValidatedJob extends BaseJob implements IJob {
  private readonly requiredFields = ["userId", "action", "timestamp"];
  private readonly fieldTypes = {
    userId: "number",
    action: "string",
    timestamp: "string",
  };

  async run(payload: any): Promise<any> {
    // Use BaseJob's validation
    this.validatePayload(payload, {
      required: this.requiredFields,
      types: this.fieldTypes,
    });

    // Process job
    return this.success({ processed: true });
  }
}
```

## Job Error Reporting Configuration

```typescript
// Configure detailed error reporting
export default class ErrorReportingJob extends BaseJob implements IJob {
  async run(payload: any): Promise<any> {
    try {
      const result = await this.riskyOperation(payload);

      return this.success({
        result,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Return comprehensive error information
      return this.error(`Operation failed: ${error}`, {
        payload,
        operation: this.constructor.name,
        timestamp: new Date().toISOString(),
        stack: error instanceof Error ? error.stack : undefined,
        cause: error instanceof Error ? error.cause : undefined,
      });
    }
  }
}
```

## Job Progress Reporting Configuration

```typescript
// Configure job progress updates
export default class ProgressJob extends BaseJob implements IJob {
  private reportInterval?: NodeJS.Timeout;
  private lastProgress = 0;

  async run(payload: { total: number }): Promise<any> {
    const startTime = Date.now();

    // Start progress reporting every 1 second
    this.reportInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, Math.floor((elapsed / 1000) * 10));

      if (progress > this.lastProgress) {
        this.lastProgress = progress;
        console.log(`Progress: ${progress}% (${elapsed}ms elapsed)`);
      }
    }, 1000);

    try {
      // Do the work
      await this.processItems(payload.total);

      clearInterval(this.reportInterval);
      return this.success({ completedAt: new Date().toISOString() });
    } catch (error) {
      clearInterval(this.reportInterval);
      return this.error(`Processing failed: ${error}`);
    }
  }

  private async processItems(total: number): Promise<void> {
    for (let i = 0; i < total; i++) {
      await this.processItem(i);
      // Simulate work
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async processItem(index: number): Promise<void> {
    // Process single item
  }
}
```

## Job External Resource Configuration

```typescript
// Configure job to use external resources
export default class ExternalResourceJob extends BaseJob implements IJob {
  async run(payload: { s3Path: string }): Promise<any> {
    try {
      // Download from S3
      const data = await this.downloadFromS3(payload.s3Path);

      // Process data
      const result = await this.processData(data);

      // Upload back to S3
      const outputPath = await this.uploadToS3(result);

      return this.success({
        downloadedFrom: payload.s3Path,
        uploadedTo: outputPath,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.error(`S3 operation failed: ${error}`, {
        s3Path: payload.s3Path,
      });
    }
  }

  private async downloadFromS3(path: string): Promise<any> {
    // S3 download implementation
  }

  private async processData(data: any): Promise<any> {
    // Data processing logic
  }

  private async uploadToS3(data: any): Promise<string> {
    // S3 upload implementation
  }
}
```

## Job Configuration Best Practices

### Timeout Handling

- Set reasonable timeouts (default: 5000ms)
- Use longer timeouts for external API calls
- Avoid infinite loops in job logic
- Handle timeouts gracefully

### Error Handling

- Always wrap job logic in try-catch
- Return detailed error context
- Include payload in error metadata
- Log stack traces for debugging
- Validate inputs before processing

### Validation

- Use BaseJob.validatePayload() for type checking
- Define required fields clearly
- Provide helpful validation error messages
- Validate external dependencies (APIs, files, databases)

### Progress Reporting

- Report progress at reasonable intervals (1-5 seconds)
- Avoid excessive logging in production
- Use percentage completion for long-running jobs
- Include timestamp in progress updates

### Resource Management

- Clean up temporary resources (files, connections)
- Close database connections
- Release file handles
- Cancel intervals/timeouts on completion/error
- Use try-finally for cleanup guarantees
