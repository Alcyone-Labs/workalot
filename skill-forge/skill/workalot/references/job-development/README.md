# Job Development

## Overview

Jobs in Workalot are TypeScript/JavaScript classes extending `BaseJob`. Each job implements the `IJob` interface with a `run()` method.

**Key Concepts**:
- Jobs are isolated: Each runs in its own worker thread
- Jobs are async: Use async/await in `run()` method
- Jobs are type-safe: Explicit payload and result types
- Jobs are reusable: Same job class can handle different payloads

## When to Use Custom Jobs

Use custom jobs when you need:
- Data processing (transformations, aggregations)
- API calls (external services, webhooks)
- File operations (parsing, conversion, compression)
- Compute-intensive tasks (image processing, calculations)
- Workflow steps (chained processing with data passing)

## Job Structure

Complete job implementation:

```typescript
// jobs/ProcessDataJob.ts
import { BaseJob, IJob } from "#/jobs/BaseJob.js";

interface ProcessDataPayload {
  data: number[];
  operation: "sum" | "average" | "max";
}

export default class ProcessDataJob extends BaseJob implements IJob {
  async run(payload: ProcessDataPayload): Promise<any> {
    // 1. Validate input
    this.validatePayload(payload, {
      required: ["data", "operation"],
      types: {
        data: "array",
        operation: "string",
      },
    });

    // 2. Process data
    let result: number;
    switch (payload.operation) {
      case "sum":
        result = payload.data.reduce((a, b) => a + b, 0);
        break;
      case "average":
        result = payload.data.reduce((a, b) => a + b, 0) / payload.data.length;
        break;
      case "max":
        result = Math.max(...payload.data);
        break;
      default:
        return this.error("Invalid operation");
    }

    // 3. Return success
    return this.success({ result });
  }
}
```

## Job Types

### Simple Processing Job

Single operation, immediate result:

```typescript
export default class SimpleJob extends BaseJob implements IJob {
  async run(payload: { value: number }): Promise<any> {
    const doubled = payload.value * 2;
    return this.success({ result: doubled });
  }
}
```

### API Call Job

Fetch data from external service:

```typescript
export default class APICallJob extends BaseJob implements IJob {
  async run(payload: { url: string }): Promise<any> {
    try {
      const response = await fetch(payload.url);
      const data = await response.json();

      return this.success({ data, fetchedAt: new Date() });
    } catch (error) {
      return this.error(
        `API call failed: ${error}`,
        { url: payload.url }
      );
    }
  }
}
```

### File Processing Job

Read/process files:

```typescript
import { readFile } from "fs/promises";

export default class FileProcessJob extends BaseJob implements IJob {
  async run(payload: { filePath: string }): Promise<any> {
    try {
      const content = await readFile(payload.filePath, "utf-8");
      const lines = content.split("\n").length;

      return this.success({ lines, processedAt: new Date() });
    } catch (error) {
      return this.error(
        `File processing failed: ${error}`,
        { filePath: payload.filePath }
      );
    }
  }
}
```

### Workflow Step Job

Part of multi-step workflow with meta envelope:

```typescript
export default class WorkflowStepJob extends BaseJob implements IJob {
  async run(payload: any, context: JobExecutionContext): Promise<any> {
    if (!context.metaEnvelope) {
      context.metaEnvelope = {
        workflowId: payload.workflowId || "default",
        stepNumber: 1,
        previousResults: [],
        metadata: {},
      };
    }

    const stepResult = await this.processStep(payload);

    // Add to meta envelope
    context.metaEnvelope.previousResults.push(stepResult);
    context.metaEnvelope.stepNumber++;

    return this.success({
      stepResult,
      workflowProgress: context.metaEnvelope,
    });
  }

  private async processStep(payload: any): Promise<any> {
    // Step-specific logic
    return { step: "processing", success: true, data: payload };
  }
}
```

## Job Lifecycle

1. **Creation**: Job class defined, extends BaseJob
2. **Scheduling**: Job added to queue via `scheduleAndWait()`
3. **Queued**: Job waits in PENDING status
4. **Claimed**: Worker claims job, status → PROCESSING
5. **Executing**: Worker runs `run()` method
6. **Completed/Failed**: Job finishes, status updated
7. **Result Returned**: Result sent back to orchestrator
8. **Cleanup**: Old jobs cleaned up based on retention policy

## Error Handling Patterns

### Validation Errors

```typescript
async run(payload: any): Promise<any> {
  // Validate required fields
  if (!payload.userId) {
    return this.error("userId is required", { payload });
  }

  // Validate types
  if (typeof payload.userId !== "number") {
    return this.error("userId must be a number", { userId: payload.userId });
  }

  // Proceed with job
  return this.success({ processed: true });
}
```

### Runtime Errors

```typescript
async run(payload: any): Promise<any> {
  try {
    const result = await this.riskyOperation(payload);
    return this.success({ result });
  } catch (error) {
    // Return detailed error information
    return this.error(
      error instanceof Error ? error.message : "Unknown error",
      {
        payload,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      }
    );
  }
}

private async riskyOperation(payload: any): Promise<any> {
  // Operation that might fail
}
```

### Timeout Handling

```typescript
export default class LongRunningJob extends BaseJob implements IJob {
  private lastProgress = 0;

  async run(payload: { iterations: number }): Promise<any> {
    for (let i = 0; i < payload.iterations; i++) {
      // Report progress
      if (i % 100 === 0) {
        const progress = Math.round((i / payload.iterations) * 100);
        if (progress !== this.lastProgress) {
          console.log(`Progress: ${progress}%`);
          this.lastProgress = progress;
        }
      }

      // Do work
      await this.processItem(i);
    }

    return this.success({ iterationsCompleted: payload.iterations });
  }

  private async processItem(index: number): Promise<void> {
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
```
