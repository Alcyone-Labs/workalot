# Error Handling

This guide covers patterns and best practices for handling errors in Workalot.

## Error Types

### JobTimeoutError

Thrown when a job exceeds its timeout limit.

```typescript
import { JobTimeoutError } from "workalot";

try {
  const result = await manager.scheduleAndWait({
    jobFile: "jobs/LongJob.ts",
    jobPayload: { data: "large" },
    jobTimeout: 5000, // 5 seconds
  });
} catch (error) {
  if (error.message.includes("timed out")) {
    console.log("Job timed out - consider increasing timeout");
  }
}
```

### JobExecutionError

Thrown when a job throws an error during execution.

```typescript
import { JobExecutionError } from "workalot";

try {
  await manager.scheduleAndWait({
    jobFile: "jobs/RiskyJob.ts",
    jobPayload: { data: "input" },
  });
} catch (error) {
  if (error instanceof JobExecutionError) {
    console.log("Job failed during execution:", error.message);
  }
}
```

### JobLoadError

Thrown when a job file cannot be loaded.

```typescript
import { JobLoadError } from "workalot";

try {
  await manager.scheduleAndWait({
    jobFile: "jobs/NonExistent.ts",
    jobPayload: {},
  });
} catch (error) {
  if (error instanceof JobLoadError) {
    console.log("Job file not found:", error.message);
  }
}
```

### JobValidationError

Thrown when job payload validation fails.

```typescript
import { JobValidationError } from "workalot";

try {
  await manager.scheduleAndWait({
    jobFile: "jobs/StrictJob.ts",
    jobPayload: { data: "test" }, // Missing required field
  });
} catch (error) {
  if (error instanceof JobValidationError) {
    console.log("Validation failed:", error.message);
  }
}
```

## Error Handling Patterns

### Try-Catch in Jobs

```typescript
import { BaseJob } from "workalot";

export class RobustJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    try {
      this.validatePayload(payload, ["requiredField"]);

      const result = await this.riskyOperation(payload);

      return this.createSuccessResult({ result });
    } catch (error) {
      // Log the error
      console.error("Operation failed:", error);

      // Return structured error result
      return this.createErrorResult("Operation failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}
```

### Result-Based Error Handling

```typescript
import { BaseJob } from "workalot";

export class ResultJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const validation = this.validateInput(payload);

    if (!validation.valid) {
      return this.createErrorResult("Invalid input", {
        errors: validation.errors,
        received: payload,
      });
    }

    // Continue processing...
  }

  private validateInput(payload: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!payload.email) {
      errors.push("email is required");
    }
    if (payload.age !== undefined && payload.age < 0) {
      errors.push("age must be non-negative");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
```

### Global Error Handler

```typescript
import { EventEmitter } from "events";

const errorHandler = new EventEmitter();

errorHandler.on("job-failed", (jobId: string, error: string) => {
  console.error(`Job ${jobId} failed:`, error);

  // Send to monitoring
  monitoringService.reportFailure(jobId, error);
});

errorHandler.on("job-completed", (jobId: string, result: any) => {
  monitoringService.reportSuccess(jobId);
});

// Attach to TaskManager
manager.on("job-failed", (jobId, error) => {
  errorHandler.emit("job-failed", jobId, error);
});

manager.on("job-completed", (jobId, result) => {
  errorHandler.emit("job-completed", jobId, result);
});
```

### Retry Pattern

```typescript
import { BaseJob } from "workalot";

export class RetryJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const maxRetries = payload.maxRetries || 3;
    const delayMs = payload.retryDelay || 1000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.attemptOperation(payload);
        return this.createSuccessResult({
          result,
          attempts: attempt,
        });
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${attempt} failed:`, lastError.message);

        if (attempt < maxRetries) {
          await this.sleep(delayMs * attempt); // Exponential backoff
        }
      }
    }

    return this.createErrorResult(`Failed after ${maxRetries} attempts`, {
      error: lastError?.message,
      attempts: maxRetries,
    });
  }

  private async attemptOperation(payload: Record<string, any>): Promise<any> {
    // Risky operation
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### Circuit Breaker Pattern

```typescript
import { EventEmitter } from "events";

class CircuitBreaker {
  private failures = 0;
  private lastFailure: Date | null = null;
  private threshold = 5;
  private resetTimeout = 60000; // 1 minute

  constructor(
    private name: string,
    private onTrip: (name: string) => void,
    private onReset: (name: string) => void,
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error(`Circuit breaker ${this.name} is open`);
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private isOpen(): boolean {
    if (this.failures >= this.threshold) {
      const timeSinceFailure = Date.now() - (this.lastFailure?.getTime() || 0);
      if (timeSinceFailure > this.resetTimeout) {
        this.reset();
        return false;
      }
      return true;
    }
    return false;
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.failures === this.threshold) {
      this.onTrip(this.name);
    }
  }

  private recordSuccess(): void {
    if (this.failures > 0) {
      this.failures--;
    }
    if (this.failures === 0) {
      this.onReset(this.name);
    }
  }

  private reset(): void {
    this.failures = 0;
    this.lastFailure = null;
  }
}

// Usage
const breaker = new CircuitBreaker(
  "external-api",
  (name) => console.log(`Circuit ${name} tripped`),
  (name) => console.log(`Circuit ${name} reset`),
);

export class ExternalJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    return breaker.execute(async () => {
      const response = await fetch(payload.url);
      return response.json();
    });
  }
}
```

## Job Recovery

Workalot automatically recovers stalled jobs:

```typescript
const manager = new TaskManager({
  jobRecoveryEnabled: true,
  healthCheckInterval: 30000, // Check every 30 seconds
  // Default stalled timeout is 5 minutes
});
```

### Manual Recovery Check

```typescript
const scheduler = jobScheduler; // Access internally

// Trigger manual recovery check
await scheduler.recoverStalledJobs();

// Get stalled jobs
const stalled = await queueBackend.getStalledJobs(300000); // 5 minutes
console.log(`Found ${stalled.length} stalled jobs`);
```

## Error Logging

```typescript
import { createLogger } from "pino";

const logger = createLogger({
  name: "workalot",
  level: "info",
});

manager.on("job-failed", (jobId, error) => {
  logger.error({ jobId, error }, "Job failed");
});

manager.on("job-completed", (jobId, result) => {
  logger.info({ jobId, executionTime: result.executionTime }, "Job completed");
});
```

## Monitoring Error Rates

```typescript
class ErrorMonitor {
  private errors: Map<string, number> = new Map();
  private windowMs = 60000; // 1 minute

  recordError(jobType: string): void {
    const count = this.errors.get(jobType) || 0;
    this.errors.set(jobType, count + 1);

    // Reset after window
    setTimeout(() => {
      const current = this.errors.get(jobType) || 0;
      this.errors.set(jobType, Math.max(0, current - 1));
    }, this.windowMs);
  }

  getErrorRate(jobType: string): number {
    return this.errors.get(jobType) || 0;
  }

  isHighErrorRate(jobType: string, threshold: number = 10): boolean {
    return this.getErrorRate(jobType) > threshold;
  }
}

const monitor = new ErrorMonitor();

manager.on("job-failed", (jobId, error) => {
  const jobType = extractJobType(jobId);
  monitor.recordError(jobType);

  if (monitor.isHighErrorRate(jobType)) {
    alertService.sendAlert(`High error rate for ${jobType}`);
  }
});
```

## Best Practices

1. **Return structured errors** - Use `createErrorResult()` for consistent error formats
2. **Log with context** - Include job ID, payload, and timestamps
3. **Implement retry logic** - Transient errors should be retried
4. **Use circuit breakers** - Protect against cascading failures
5. **Monitor error rates** - Detect issues before they become critical
6. **Set appropriate timeouts** - Prevent jobs from blocking forever
7. **Distinguish error types** - Validation errors vs runtime errors
8. **Preserve error context** - Include original error messages and stacks
