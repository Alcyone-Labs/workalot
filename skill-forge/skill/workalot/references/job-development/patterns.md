# Job Development Patterns

## Idempotent Job Pattern

Job produces same result on duplicate runs:

```typescript
export default class IdempotentJob extends BaseJob implements IJob {
  async run(payload: { userId: number; action: string }): Promise<any> {
    // Check if already processed
    const cacheKey = `${payload.userId}-${payload.action}`;
    const cached = await this.checkCache(cacheKey);

    if (cached) {
      return this.success({
        message: "Already processed",
        result: cached,
        cached: true,
      });
    }

    // Process job
    const result = await this.processAction(payload);

    // Cache result
    await this.setCache(cacheKey, result);

    return this.success({
      message: "Processed",
      result,
      cached: false,
    });
  }

  private async checkCache(key: string): Promise<any | null> {
    // Cache check implementation (Redis, DB, etc.)
    return null;
  }

  private async setCache(key: string, value: any): Promise<void> {
    // Cache set implementation
  }

  private async processAction(payload: any): Promise<any> {
    // Business logic
    return { processed: true };
  }
}
```

## Batch Processing Pattern

Process multiple items efficiently:

```typescript
export default class BatchProcessJob extends BaseJob implements IJob {
  private readonly BATCH_SIZE = 100;

  async run(payload: { items: any[] }): Promise<any> {
    const results = [];
    const errors = [];

    // Process in batches
    for (let i = 0; i < payload.items.length; i += this.BATCH_SIZE) {
      const batch = payload.items.slice(i, i + this.BATCH_SIZE);

      try {
        const batchResults = await this.processBatch(batch);
        results.push(...batchResults);
      } catch (error) {
        errors.push({
          batchStart: i,
          error: error,
        });
        // Continue with next batch
      }
    }

    return this.success({
      totalItems: payload.items.length,
      processed: results.length,
      errors,
      processedAt: new Date().toISOString(),
    });
  }

  private async processBatch(batch: any[]): Promise<any[]> {
    // Batch processing logic
    return batch.map(item => ({ ...item, processed: true }));
  }
}
```

## Parallel Processing Pattern

Use Promise.all for concurrent operations:

```typescript
export default class ParallelProcessJob extends BaseJob implements IJob {
  async run(payload: { urls: string[] }): Promise<any> {
    // Process all URLs in parallel
    const results = await Promise.all(
      payload.urls.map(url => this.fetchUrl(url))
    );

    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    return this.success({
      total: payload.urls.length,
      succeeded: successes.length,
      failed: failures.length,
      results,
      processedAt: new Date().toISOString(),
    });
  }

  private async fetchUrl(url: string): Promise<{ success: boolean; data?: any; url: string }> {
    try {
      const response = await fetch(url);
      const data = await response.json();

      return { success: true, data, url };
    } catch (error) {
      return { success: false, url, error: error instanceof Error ? error.message : "Unknown" };
    }
  }
}
```

## Retry Pattern

Automatic retry with exponential backoff:

```typescript
export default class RetryJob extends BaseJob implements IJob {
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 1000; // 1 second

  async run(payload: { endpoint: string }): Promise<any> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const result = await this.callEndpoint(payload.endpoint);
        return this.success({
          endpoint: payload.endpoint,
          attempt,
          result,
          processedAt: new Date().toISOString(),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.MAX_RETRIES) {
          const delay = this.BASE_DELAY * Math.pow(2, attempt - 1);
          console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`);

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    return this.error(
      `Failed after ${this.MAX_RETRIES} attempts`,
      {
        endpoint: payload.endpoint,
        lastError: lastError?.message,
        attempts: this.MAX_RETRIES,
      }
    );
  }

  private async callEndpoint(endpoint: string): Promise<any> {
    // External API call
    const response = await fetch(endpoint);
    return await response.json();
  }
}
```

## Pipeline Pattern

Chain multiple processing steps:

```typescript
export default class PipelineJob extends BaseJob implements IJob {
  async run(payload: { data: any }): Promise<any> {
    try {
      // Step 1: Validate
      const validated = await this.validateInput(payload.data);

      // Step 2: Transform
      const transformed = await this.transformData(validated);

      // Step 3: Enrich
      const enriched = await this.enrichData(transformed);

      // Step 4: Save
      const saved = await this.saveData(enriched);

      return this.success({
        stepsCompleted: 4,
        result: saved,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.error(`Pipeline failed: ${error}`, {
        pipelineStep: "unknown",
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  private async validateInput(data: any): Promise<any> {
    // Validation logic
    return data;
  }

  private async transformData(data: any): Promise<any> {
    // Transformation logic
    return { ...data, transformed: true };
  }

  private async enrichData(data: any): Promise<any> {
    // Enrichment logic
    return { ...data, enriched: true };
  }

  private async saveData(data: any): Promise<any> {
    // Save logic
    return { ...data, saved: true };
  }
}
```

## Workflow Pattern with Meta Envelope

Multi-step workflow with context passing:

```typescript
// Workflow orchestrator
class WorkflowOrchestrator {
  constructor(private manager: TaskManager) {}

  async executeWorkflow(initialData: any): Promise<any> {
    // Initialize meta envelope
    let metaEnvelope = {
      workflowId: `wf-${Date.now()}`,
      stepNumber: 1,
      previousResults: [],
      metadata: { startedAt: new Date().toISOString() },
    };

    // Step 1: Extract
    const step1 = await scheduleAndWaitWith(this.manager, {
      jobFile: "jobs/ExtractJob.ts",
      jobPayload: {
        metaEnvelope,
        data: initialData,
      },
    });

    metaEnvelope = step1.result.workflowProgress;

    // Step 2: Transform
    const step2 = await scheduleAndWaitWith(this.manager, {
      jobFile: "jobs/TransformJob.ts",
      jobPayload: {
        metaEnvelope,
        data: step1.result.data,
      },
    });

    metaEnvelope = step2.result.workflowProgress;

    // Step 3: Load
    const step3 = await scheduleAndWaitWith(this.manager, {
      jobFile: "jobs/LoadJob.ts",
      jobPayload: {
        metaEnvelope,
        data: step2.result.data,
      },
    });

    metaEnvelope = step3.result.workflowProgress;

    // Finalize workflow
    return {
      workflowId: metaEnvelope.workflowId,
      stepsCompleted: metaEnvelope.stepNumber - 1,
      finalResult: step3.result.data,
      metadata: metaEnvelope.metadata,
    };
  }
}
```

## Circuit Breaker Pattern

Stop calling failing service temporarily:

```typescript
class CircuitBreakerJob extends BaseJob {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_TIMEOUT = 60000; // 1 minute

  async run(payload: { service: string }): Promise<any> {
    // Check circuit breaker state
    if (this.isCircuitOpen()) {
      return this.error("Circuit breaker is open, service unavailable", {
        service: payload.service,
        failures: this.failures,
        lastFailure: new Date(this.lastFailureTime).toISOString(),
      });
    }

    try {
      const result = await this.callService(payload.service);

      // Reset on success
      this.failures = 0;

      return this.success({
        service: payload.service,
        result,
        circuitOpen: false,
      });
    } catch (error) {
      // Track failure
      this.failures++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (this.failures >= this.FAILURE_THRESHOLD) {
        console.warn(`Circuit breaker opened for ${payload.service}`);
      }

      throw error;
    }
  }

  private isCircuitOpen(): boolean {
    return (
      this.failures >= this.FAILURE_THRESHOLD &&
      Date.now() - this.lastFailureTime < this.RECOVERY_TIMEOUT
    );
  }

  private async callService(service: string): Promise<any> {
    // Service call implementation
    const response = await fetch(service);
    return await response.json();
  }
}
```

## Progressive Loading Pattern

Load data progressively with checkpoints:

```typescript
export default class ProgressiveLoadJob extends BaseJob {
  private readonly CHECKPOINT_INTERVAL = 1000;

  async run(payload: { totalRecords: number }): Promise<any> {
    const startTime = Date.now();
    let loaded = 0;
    let lastCheckpoint = 0;

    try {
      while (loaded < payload.totalRecords) {
        // Load next batch
        const batchSize = Math.min(1000, payload.totalRecords - loaded);
        const records = await this.loadRecords(loaded, batchSize);

        loaded += records.length;

        // Report checkpoint
        if (loaded - lastCheckpoint >= this.CHECKPOINT_INTERVAL) {
          const progress = Math.round((loaded / payload.totalRecords) * 100);
          const elapsed = Date.now() - startTime;

          console.log(`Checkpoint: ${loaded}/${payload.totalRecords} (${progress}%) in ${elapsed}ms`);

          lastCheckpoint = loaded;
        }
      }

      return this.success({
        totalLoaded: loaded,
        totalRecords: payload.totalRecords,
        completedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      });
    } catch (error) {
      return this.error(`Loading failed at ${loaded}/${payload.totalRecords}`, {
        totalLoaded: loaded,
        totalRecords: payload.totalRecords,
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  private async loadRecords(offset: number, limit: number): Promise<any[]> {
    // Data loading implementation
    // Simulate loading
    await new Promise(resolve => setTimeout(resolve, 10));

    return Array.from({ length: limit }, (_, i) => ({
      id: offset + i,
      data: `record-${offset + i}`,
    }));
  }
}
```

## Dead Letter Pattern

Handle failed jobs separately:

```typescript
export default class DeadLetterJob extends BaseJob {
  async run(payload: { failedJobId: string; error: string }): Promise<any> {
    try {
      // Log to dead letter queue/database
      await this.saveToDeadLetterQueue({
        jobId: payload.failedJobId,
        error: payload.error,
        failedAt: new Date().toISOString(),
        retryCount: 3, // Number of retries before sending here
      });

      // Notify monitoring
      await this.notifyMonitoring(payload.failedJobId, payload.error);

      return this.success({
        jobId: payload.failedJobId,
        handledAs: "dead-letter",
        handledAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.error(`Failed to handle dead letter: ${error}`, {
        originalJobId: payload.failedJobId,
        originalError: payload.error,
        handlerError: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  private async saveToDeadLetterQueue(entry: any): Promise<void> {
    // Save to dead letter storage
    // Database, file system, external service
  }

  private async notifyMonitoring(jobId: string, error: string): Promise<void> {
    // Send alert to monitoring system
    // Slack, PagerDuty, email, etc.
  }
}
```
