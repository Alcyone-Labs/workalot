# Job Development API

## BaseJob Class

```typescript
import { BaseJob, IJob } from "#/jobs/BaseJob.js";

export default class MyJob extends BaseJob implements IJob {
  async run(payload: any): Promise<any> {
    // Job implementation
  }
}
```

## Methods

### `validatePayload(payload: any, options: ValidationOptions): void`

Validate payload before processing.

**Parameters**:

- `payload`: Job payload object
- `options`: Validation configuration
  - `required?: string[]` - Required field names
  - `types?: Record<string, string>` - Expected types for fields

**Throws**: Error if validation fails

**Example**:

```typescript
this.validatePayload(payload, {
  required: ["userId", "action"],
  types: {
    userId: "number",
    action: "string",
    data: "object",
  },
});
```

### `success(result: any, metadata?: any): any`

Return successful job result.

**Parameters**:

- `result`: Job result data
- `metadata`: Optional additional metadata

**Returns**: Formatted success result object

**Example**:

```typescript
return this.success({
  processed: true,
  processedAt: new Date().toISOString(),
});
```

### `error(message: string, metadata?: any): any`

Return failed job result with error details.

**Parameters**:

- `message`: Error message
- `metadata`: Optional additional error context

**Returns**: Formatted error result object

**Example**:

```typescript
return this.error("Processing failed", {
  payload,
  stack: error instanceof Error ? error.stack : undefined,
});
```

### `getJobId(payload: any): string`

Override to provide custom job ID generation.

**Parameters**:

- `payload`: Job payload

**Returns**: Custom job ID string

**Example**:

```typescript
getJobId(payload: { userId: number; action: string }): string {
  return `user-${payload.userId}-${payload.action}-${Date.now()}`;
}
```

## JobExecutionContext Interface

```typescript
interface JobExecutionContext {
  metaEnvelope?: MetaEnvelope;
  startTime: number;
  jobTimeout: number;
}
```

## MetaEnvelope Interface

```typescript
interface MetaEnvelope {
  workflowId: string;
  stepNumber: number;
  previousResults: any[];
  metadata: Record<string, any>;
}
```

## ValidationOptions Interface

```typescript
interface ValidationOptions {
  required?: string[];
  types?: Record<string, string>;
  optional?: string[];
}
```

## IJob Interface

```typescript
interface IJob {
  run(payload: any, context?: JobExecutionContext): Promise<any>;
}
```

## Complete Job Example

```typescript
import { BaseJob, IJob, JobExecutionContext } from "#/jobs/BaseJob.js";

interface MyJobPayload {
  userId: number;
  action: string;
  data?: any;
}

interface MyJobResult {
  success: boolean;
  processedAt: string;
  data?: any;
}

export default class MyJob extends BaseJob implements IJob {
  async run(payload: MyJobPayload, context?: JobExecutionContext): Promise<any> {
    // Validate payload
    this.validatePayload(payload, {
      required: ["userId", "action"],
      types: {
        userId: "number",
        action: "string",
      },
    });

    // Check if part of workflow
    if (context?.metaEnvelope) {
      console.log(
        `Step ${context.metaEnvelope.stepNumber} of workflow ${context.metaEnvelope.workflowId}`,
      );
    }

    try {
      // Process job
      const result = await this.processAction(payload);

      // Update meta envelope if workflow
      if (context?.metaEnvelope) {
        context.metaEnvelope.previousResults.push({
          step: payload.action,
          timestamp: new Date().toISOString(),
          success: true,
          data: result,
        });
        context.metaEnvelope.stepNumber++;
      }

      // Return success
      return this.success({
        processedAt: new Date().toISOString(),
        data: result,
      });
    } catch (error) {
      // Return error with context
      return this.error(error instanceof Error ? error.message : "Unknown error", {
        payload,
        stack: error instanceof Error ? error.stack : undefined,
        workflowContext: context?.metaEnvelope,
      });
    }
  }

  private async processAction(payload: MyJobPayload): Promise<any> {
    // Implement business logic
    return { action: payload.action, status: "completed" };
  }
}
```

## Job Loading

Jobs are loaded dynamically by file path:

```typescript
// Scheduler calls JobLoader to load jobs
const jobClass = await JobLoader.loadJob("jobs/MyJob.ts");

// Job must export default class
export default class MyJob extends BaseJob implements IJob {
  // ...
}
```

## Job Registration (Optional)

For non-dynamic job loading, register jobs manually:

```typescript
import { JobRegistry } from "#/jobs/JobRegistry.js";
import { MyJob } from "./jobs/MyJob";

// Register job
JobRegistry.register("my-job", MyJob);

// Schedule with registered job name
await scheduleAndWait({
  jobFile: "my-job", // Uses registered class
  jobPayload: {
    /* ... */
  },
});
```
