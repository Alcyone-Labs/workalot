# TypeScript Types

Complete reference for all TypeScript types in Workalot.

## Typing Your Jobs

This section explains how to properly type your job payloads and results for TypeScript safety.

### Defining Job Payload Types

Create a type for your job's input payload:

```typescript
// types/jobs.ts
export interface EmailJobPayload {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; content: string }>;
  priority?: "low" | "normal" | "high";
}

export interface DataProcessingJobPayload {
  inputPath: string;
  outputPath: string;
  options: {
    format: "json" | "csv" | "parquet";
    compression?: boolean;
  };
}
```

### Extending BaseJob with Type Safety

Use TypeScript generics for type-safe job definitions:

```typescript
import { BaseJob, JobExecutionContext } from "workalot";

// Define your job-specific types
interface EmailJobResult {
  messageId: string;
  sentAt: string;
  recipient: string;
}

export class EmailJob extends BaseJob {
  constructor() {
    super("EmailJob");
  }

  async run(payload: EmailJobPayload, context: JobExecutionContext): Promise<Record<string, any>> {
    this.validatePayload(payload, ["to", "subject", "body"]);

    const result = await this.sendEmail(payload);

    return this.createSuccessResult({
      messageId: result.messageId,
      sentAt: result.sentAt.toISOString(),
      recipient: payload.to,
    });
  }

  private async sendEmail(payload: EmailJobPayload): Promise<EmailJobResult> {
    // Implementation
  }
}
```

### Creating Type-Safe Scheduling Functions

Create wrapper functions with full type inference:

```typescript
import { JobPayload } from "workalot";

// Type-safe scheduling wrapper
type Scheduler<TPayload extends Record<string, any>> = {
  schedule: (payload: TPayload) => Promise<string>;
  scheduleAndWait: (payload: TPayload) => Promise<JobResult>;
};

function createTypedScheduler<TPayload extends Record<string, any>>(
  manager: any,
  jobFile: string,
): Scheduler<TPayload> {
  return {
    schedule: async (payload: TPayload) => {
      return manager.schedule({
        jobFile,
        jobPayload: payload,
      });
    },
    scheduleAndWait: async (payload: TPayload) => {
      return manager.scheduleAndWait({
        jobFile,
        jobPayload: payload,
      });
    },
  };
}

// Usage - TypeScript knows the exact shape of the payload
const emailScheduler = createTypedScheduler<EmailJobPayload>(manager, "jobs/EmailJob.ts");

// These are fully typed - TypeScript will error if fields are missing
await emailScheduler.scheduleAndWait({
  to: "user@example.com",
  subject: "Welcome!",
  body: "Thanks for signing up",
  // priority: "high", // Optional - can be omitted
});

// TypeScript error: Property 'invalidField' does not exist
await emailScheduler.scheduleAndWait({
  to: "user@example.com",
  subject: "Welcome!",
  body: "Thanks for signing up",
  invalidField: "oops", // Error!
});
```

### Using Generics for Better Type Inference

Create reusable generic types for your job definitions:

```typescript
// types/job-types.ts

/**
 * Base interface for all job payloads
 */
export interface JobDefinition<P extends Record<string, any>, R extends Record<string, any>> {
  payload: P;
  result: R;
}

/**
 * Email job definition
 */
export interface EmailJobDefinition extends JobDefinition<
  {
    to: string;
    subject: string;
    body: string;
    attachments?: Array<{ filename: string; content: string }>;
  },
  {
    messageId: string;
    sentAt: string;
    recipient: string;
  }
> {}

/**
 * Data processing job definition
 */
export interface DataProcessingJobDefinition extends JobDefinition<
  {
    inputPath: string;
    outputPath: string;
    options: {
      format: "json" | "csv" | "parquet";
      compression?: boolean;
    };
  },
  {
    recordsProcessed: number;
    outputSize: number;
    duration: number;
  }
> {}
```

### Type-Safe Job Factory

Create a factory pattern for strongly-typed job creation:

```typescript
// jobs/job-factories.ts
import { BaseJob, JobExecutionContext, JobPayload } from "workalot";

type JobClass<P extends Record<string, any>, R extends Record<string, any>> = {
  new (): {
    run(payload: P, context: JobExecutionContext): Promise<R>;
  };
};

function createTypedJob<P extends Record<string, any>, R extends Record<string, any>>(
  name: string,
  JobClass: JobClass<P, R>,
) {
  return class extends BaseJob {
    constructor() {
      super(name);
    }

    async run(payload: P, context: JobExecutionContext): Promise<Record<string, any>> {
      // Runtime validation
      this.validatePayload(
        payload,
        Object.keys(
          new JobClass().run(payload, {} as JobExecutionContext).then((r: any) => r),
        ) as string[],
      );

      const job = new JobClass();
      const result = await job.run(payload, context);

      return this.createSuccessResult(result);
    }
  };
}

// Define your jobs with full type safety
export class EmailJob {
  run(
    payload: {
      to: string;
      subject: string;
      body: string;
    },
    _context: JobExecutionContext,
  ): Promise<{
    messageId: string;
    sentAt: string;
  }> {
    return Promise.resolve({
      messageId: "msg-123",
      sentAt: new Date().toISOString(),
    });
  }
}

export const TypedEmailJob = createTypedJob("EmailJob", EmailJob);
```

### Extracting Types from Job Definitions

Utility types for extracting types from job classes:

```typescript
// types/utility-types.ts

/**
 * Extract the payload type from a job class
 */
export type PayloadOf<T> = T extends {
  run: (payload: infer P, ...args: any[]) => any;
}
  ? P
  : never;

/**
 * Extract the result type from a job class
 */
export type ResultOf<T> = T extends {
  run: (...args: any[]) => infer R;
}
  ? R extends Promise<infer PR>
    ? PR
    : R
  : never;

/**
 * Usage example
 */
type EmailJobPayload = PayloadOf<EmailJob>;
// Result: { to: string; subject: string; body: string }

type EmailJobResult = ResultOf<EmailJob>;
// Result: { messageId: string; sentAt: string }
```

### Complete Example: Type-Safe Job Scheduling

```typescript
// jobs/scheduler.ts
import { TaskManager } from "workalot";

// Define your job types
interface ProcessOrderPayload {
  orderId: string;
  items: Array<{ productId: string; quantity: number }>;
  customerEmail: string;
  priority: "standard" | "express";
}

interface ProcessOrderResult {
  orderId: string;
  processedAt: string;
  totalAmount: number;
  trackingNumber?: string;
}

// Create typed scheduler
function createOrderScheduler(manager: TaskManager) {
  return {
    scheduleAndWait: async (payload: ProcessOrderPayload): Promise<ProcessOrderResult> => {
      const result = await manager.scheduleAndWait({
        jobFile: "jobs/ProcessOrderJob.ts",
        jobPayload: payload,
      });
      return result.results as ProcessOrderResult;
    },
    schedule: async (payload: ProcessOrderPayload): Promise<string> => {
      return manager.schedule({
        jobFile: "jobs/ProcessOrderJob.ts",
        jobPayload: payload,
      });
    },
  };
}

// Usage - fully typed
const orderScheduler = createOrderScheduler(manager);

// TypeScript knows exactly what fields are required
const result = await orderScheduler.scheduleAndWait({
  orderId: "ORD-12345",
  items: [
    { productId: "PROD-001", quantity: 2 },
    { productId: "PROD-002", quantity: 1 },
  ],
  customerEmail: "customer@example.com",
  priority: "express",
});

console.log(`Order ${result.orderId} processed at ${result.processedAt}`);
console.log(`Total: $${result.totalAmount}`);
console.log(`Tracking: ${result.trackingNumber}`);
```

### Zod Integration for Runtime Validation

Combine Zod with TypeScript for end-to-end type safety:

```typescript
import { z } from "zod";

// Define schema with Zod
export const EmailJobSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});

// Infer TypeScript type from schema
export type EmailJobPayload = z.infer<typeof EmailJobSchema>;

export class EmailJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Runtime validation with Zod
    const result = EmailJobSchema.safeParse(payload);

    if (!result.success) {
      return this.createErrorResult("Invalid payload", {
        errors: result.error.errors,
      });
    }

    // payload is now fully typed as EmailJobPayload
    const validPayload: EmailJobPayload = result.data;

    // Process with typed payload...
    return this.createSuccessResult({ sent: true });
  }
}
```

## Core Types

### JobStatus

```typescript
enum JobStatus {
  PENDING = "pending", // Job is queued, waiting to be processed
  PROCESSING = "processing", // Job is currently being executed
  COMPLETED = "completed", // Job finished successfully
  FAILED = "failed", // Job failed with an error
}
```

### JobPayload

```typescript
interface JobPayload {
  /**
   * Path to the job file relative to project root
   * @example "jobs/EmailJob.ts"
   */
  jobFile: string | PathLike;

  /**
   * Data passed to the job's run method
   */
  jobPayload: Record<string, any>;

  /**
   * Job-specific timeout in milliseconds
   * @default 5000
   */
  jobTimeout?: number;

  /**
   * Workflow metadata for chaining jobs
   */
  metaEnvelope?: MetaEnvelope;
}
```

### JobResult

```typescript
interface JobResult {
  /**
   * The job's return value
   */
  results: Record<string, any>;

  /**
   * Time spent executing the job in milliseconds
   */
  executionTime: number;

  /**
   * Time spent waiting in queue in milliseconds
   */
  queueTime: number;

  /**
   * Jobs scheduled by this job (for workflow chaining)
   */
  schedulingRequests?: JobSchedulingRequest[];
}
```

### JobExecutionContext

```typescript
interface JobExecutionContext extends BaseJobExecutionContext {
  /**
   * Unique job identifier
   */
  jobId: string;

  /**
   * Timestamp when job started processing
   */
  startTime: number;

  /**
   * Time spent waiting in queue
   */
  queueTime: number;

  /**
   * Job timeout in milliseconds
   */
  timeout: number;

  /**
   * Schedule a job and wait for it to complete
   * @param jobPayload - Job configuration and data
   * @returns Job ID
   */
  scheduleAndWait(jobPayload: JobPayload): Promise<string>;

  /**
   * Schedule a job without waiting (fire-and-forget)
   * @param jobPayload - Job configuration and data
   * @returns Job ID
   */
  schedule(jobPayload: JobPayload): string;

  /**
   * Workflow metadata passed from previous jobs
   */
  metaEnvelope?: MetaEnvelope;
}

interface BaseJobExecutionContext {
  jobId: string;
  startTime: number;
  queueTime: number;
  timeout: number;
}
```

### QueueConfig

```typescript
interface QueueConfig {
  /**
   * Storage backend type
   * @default "sqlite" (with auto-selection)
   */
  backend?: "memory" | "pglite" | "postgresql" | "sqlite" | "redis";

  /**
   * Database connection URL
   * - Memory: ignored
   * - SQLite: file path or "memory://"
   * - PGLite: directory path or "memory://"
   * - PostgreSQL: connection string
   * - Redis: connection string
   */
  databaseUrl?: string;

  /**
   * Maximum worker threads
   * @default os.cpus().length - 2
   */
  maxThreads?: number;

  /**
   * Suppress worker console output
   * @default false
   */
  silent?: boolean;

  /**
   * Enable automatic job recovery
   * @default true
   */
  jobRecoveryEnabled?: boolean;

  /**
   * Health check interval in milliseconds
   * @default 5000
   */
  healthCheckInterval?: number;

  /**
   * Maximum age for in-memory job data in milliseconds
   * @default 86400000 (24 hours)
   */
  maxInMemoryAge?: number;

  // TimescaleDB Configuration (PostgreSQL only)

  /**
   * Enable TimescaleDB-specific features
   */
  enableTimescaleDB?: boolean;

  /**
   * Time interval for hypertable chunks
   * @example "1 hour"
   */
  chunkTimeInterval?: string;

  /**
   * Compress chunks older than this interval
   * @example "7 days"
   */
  compressionInterval?: string;

  /**
   * Drop data older than this interval
   * @example "90 days"
   */
  retentionInterval?: string;
}
```

### QueueStats

```typescript
interface QueueStats {
  /**
   * Total jobs in queue (all statuses)
   */
  total: number;

  /**
   * Jobs waiting to be processed
   */
  pending: number;

  /**
   * Jobs currently being executed
   */
  processing: number;

  /**
   * Jobs that completed successfully
   */
  completed: number;

  /**
   * Jobs that failed
   */
  failed: number;

  /**
   * Oldest pending job timestamp
   */
  oldestPending?: Date;
}
```

## Workflow Types

### MetaEnvelope

```typescript
interface MetaEnvelope {
  /**
   * Unique workflow identifier
   * @example "wf-2024-01-15-abc123"
   */
  workflowId?: string;

  /**
   * Step number in workflow sequence
   */
  stepNumber?: number;

  /**
   * Sequence number for ordering
   */
  sequenceNo?: number;

  /**
   * Results from previous workflow steps
   */
  previousResults?: Array<{
    step: string;
    timestamp: string;
    success: boolean;
    [key: string]: any;
  }>;

  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;

  /**
   * Custom fields
   */
  [key: string]: any;
}
```

### JobSchedulingRequest

```typescript
interface JobSchedulingRequest {
  /**
   * Type of scheduling request
   */
  type: "schedule" | "scheduleAndWait";

  /**
   * The job payload
   */
  jobPayload: JobPayload;

  /**
   * Unique request identifier
   */
  requestId: string;
}
```

## Batch Processing Types

### BatchJobContext

```typescript
interface BatchJobContext {
  /**
   * Job identifier
   */
  jobId: string;

  /**
   * Job payload
   */
  jobPayload: JobPayload;

  /**
   * Execution context
   */
  context: BaseJobExecutionContext;
}
```

### BatchExecutionResult

```typescript
interface BatchExecutionResult {
  /**
   * Unique batch identifier
   */
  batchId: string;

  /**
   * Results for each job in the batch
   */
  results: BatchJobResult[];

  /**
   * Total jobs in batch
   */
  totalJobs: number;

  /**
   * Number of successful jobs
   */
  successCount: number;

  /**
   * Number of failed jobs
   */
  failureCount: number;
}
```

### BatchJobResult

```typescript
interface BatchJobResult {
  /**
   * Job identifier
   */
  jobId: string;

  /**
   * Whether job succeeded
   */
  success: boolean;

  /**
   * Job result (if successful)
   */
  result?: JobResult;

  /**
   * Error message (if failed)
   */
  error?: string;
}
```

## Worker Types

### WorkerState

```typescript
interface WorkerState {
  /**
   * Worker identifier
   */
  id: number;

  /**
   * Whether worker is currently processing a job
   */
  busy: boolean;

  /**
   * Whether worker is ready to accept jobs
   */
  ready: boolean;

  /**
   * Current job identifier (if busy)
   */
  currentJobId?: string;

  /**
   * Last ping timestamp
   */
  lastPing?: Date;
}
```

### WorkerQueueStatus

```typescript
interface WorkerQueueStatus {
  /**
   * Worker identifier
   */
  workerId: number;

  /**
   * Jobs waiting in worker queue
   */
  pendingJobs: number;

  /**
   * Jobs currently processing
   */
  processingJobs: number;

  /**
   * Jobs completed
   */
  completedJobs: number;

  /**
   * Total jobs processed
   */
  totalProcessed: number;

  /**
   * Queue utilization percentage
   */
  queueUtilization: number;

  /**
   * Whether worker needs more jobs
   */
  needsMoreJobs: boolean;
}
```

### WorkerQueueConfig

```typescript
interface WorkerQueueConfig {
  /**
   * Maximum jobs per worker queue
   */
  workerQueueSize: number;

  /**
   * Refill threshold
   */
  queueThreshold: number;

  /**
   * ACK timeout in milliseconds
   */
  ackTimeout: number;

  /**
   * Enable worker-local queues
   */
  enableWorkerQueues: boolean;
}
```

## Event Types

### TaskManagerEvents

```typescript
interface TaskManagerEvents {
  /**
   * Emitted when TaskManager is initialized and ready
   */
  ready: () => void;

  /**
   * Emitted when a job is scheduled
   */
  "job-scheduled": (jobId: string) => void;

  /**
   * Emitted when a job completes successfully
   */
  "job-completed": (jobId: string, result: JobResult) => void;

  /**
   * Emitted when a job fails
   */
  "job-failed": (jobId: string, error: string) => void;

  /**
   * Emitted when queue becomes empty
   */
  "queue-empty": () => void;

  /**
   * Emitted when queue receives new jobs
   */
  "queue-not-empty": () => void;

  /**
   * Emitted when all workers are busy
   */
  "all-workers-busy": () => void;

  /**
   * Emitted when workers become available
   */
  "workers-available": () => void;
}
```

### JobSchedulerEvents

```typescript
interface JobSchedulerEvents {
  "job-scheduled": (jobId: string) => void;
  "job-started": (jobId: string, workerId: number) => void;
  "job-completed": (jobId: string, result: JobResult) => void;
  "job-failed": (jobId: string, error: string) => void;
  "scheduler-idle": () => void;
  "scheduler-busy": () => void;
}
```

## Message Types

### WorkerMessage

```typescript
interface WorkerMessage {
  /**
   * Message type
   */
  type: WorkerMessageType;

  /**
   * Message identifier
   */
  id?: string;

  /**
   * Message payload
   */
  payload?: any;

  /**
   * Error message (if error type)
   */
  error?: string;
}
```

### WorkerMessageType

```typescript
enum WorkerMessageType {
  PING = "ping",
  PONG = "pong",
  EXECUTE_JOB = "execute_job",
  EXECUTE_BATCH_JOBS = "execute_batch_jobs",
  JOB_RESULT = "job_result",
  BATCH_RESULT = "batch_result",
  JOB_ERROR = "job_error",
  WORKER_READY = "worker_ready",
  WORKER_ERROR = "worker_error",
  FILL_QUEUE = "fill_queue",
  REQUEST_JOBS = "request_jobs",
  JOB_ACK = "job_ack",
  QUEUE_STATUS = "queue_status",
  QUEUE_RESULT = "queue_result",
  CHANNEL = "channel",
}
```

### ChannelMessage

```typescript
interface ChannelMessage {
  /**
   * Message type
   */
  type: string;

  /**
   * Sub-channel for hierarchical routing
   */
  subChannel?: string;

  /**
   * Action to perform
   */
  action: string;

  /**
   * Message payload
   */
  payload?: any;
}
```

## Queue Item Type

### QueueItem

```typescript
interface QueueItem {
  /**
   * Unique job identifier
   */
  id: string;

  /**
   * Original job payload
   */
  jobPayload: JobPayload;

  /**
   * Current job status
   */
  status: JobStatus;

  /**
   * Last status update timestamp
   */
  lastUpdated: Date;

  /**
   * When job was queued
   */
  requestedAt: Date;

  /**
   * When job started processing (if processing/completed)
   */
  startedAt?: Date;

  /**
   * When job completed (if completed/failed)
   */
  completedAt?: Date;

  /**
   * Job result (if completed)
   */
  result?: JobResult;

  /**
   * Error (if failed)
   */
  error?: Error;

  /**
   * Worker that processed the job
   */
  workerId?: number;
}
```

## Callback Types

### WhenFreeCallback

```typescript
type WhenFreeCallback = () => void;
```

## Utility Types

### JobPromiseResolver

```typescript
interface JobPromiseResolver {
  resolve: (result: JobResult) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}
```

### JobDistributionContext

```typescript
interface JobDistributionContext {
  jobId: string;
  payload: JobPayload;
  timestamp: Date;
}
```

### WorkflowDefinition

```typescript
interface WorkflowDefinition {
  /**
   * Workflow identifier
   */
  id: string;

  /**
   * Workflow steps
   */
  steps: WorkflowStep[];
}

interface WorkflowStep {
  /**
   * Step identifier
   */
  id: string;

  /**
   * Job file path
   */
  jobFile: string;

  /**
   * Step configuration
   */
  config?: Record<string, any>;
}
```
