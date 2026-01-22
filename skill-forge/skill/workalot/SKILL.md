---
name: workalot
description: High-performance job queue system with multi-backend support and WebSocket distributed workers
references:
  - core-concepts
  - queue-backends
  - job-development
  - api-functions
  - websocket-architecture
---

## When to Apply

Use Workalot when you need:

- High-throughput job processing (100K+ jobs/sec with Memory backend)
- Multi-backend persistence options (Memory/SQLite/PGLite/PostgreSQL/Redis)
- Distributed worker scaling across machines or containers
- Real-time job distribution via WebSocket
- Fault tolerance with automatic job recovery
- Progressive complexity from simple to advanced use cases

## Rules

**Always Follow**:

- Use factory pattern (`createTaskManager`) over singleton for testability and multiple instances
- Extend jobs from `BaseJob` and implement `IJob` interface
- Use `scheduleAndWaitWith(manager)` for explicit manager control
- Use async/await exclusively (no callbacks in v2.x)
- Set reasonable timeouts for jobs (default: 5000ms)
- Validate job payloads using `this.validatePayload()`
- Return results via `this.success()` and errors via `this.error()`
- Use environment variables for database URLs and sensitive config
- Call `shutdown()` and `destroyTaskManager()` for cleanup
- Use WebSocket architecture (`SimpleOrchestrator` + `SimpleWorker`) for distributed workers
- Enable job recovery for production deployments
- Choose backend based on use case: Memory (dev/test), SQLite (single-machine), PostgreSQL (enterprise), Redis (high-throughput)

**Never**:

- Use singleton pattern in tests (creates shared state)
- Mix v1.x `postMessage` with v2.x WebSocket patterns
- Hardcode database URLs or secrets
- Use Memory backend in production (data loss on restart)
- Block worker threads with synchronous operations
- Ignore job recovery in production (stalled jobs accumulate)
- Use callbacks instead of async/await
- Exceed connection pool size for PostgreSQL/Redis
- Use custom job IDs without implementing `getJobId()`
- Skip validation of job payloads

## Workflow

### Job Scheduling Flow

```
Determine API Pattern
  ├─ Need multiple instances? → Use Factory Pattern
  │                    createTaskManager(name, config)
  │                    scheduleAndWaitWith(manager, jobRequest)
  │                    destroyTaskManager(name)
  │
  └─ Single instance OK? → Use Singleton (legacy)
                         scheduleAndWait(jobRequest)
```

### Backend Selection Decision Tree

```
Select Backend
  ├─ Development/Testing → Memory Backend
  │                        (fastest, no persistence)
  │
  ├─ Single Machine Production → SQLite Backend
  │                            (WAL mode, ACID)
  │
  ├─ Enterprise/Distributed → PostgreSQL Backend
  │                            (LISTEN/NOTIFY, TimescaleDB)
  │
  ├─ High-Throughput → Redis Backend
  │                       (atomic ops, pub/sub, edge)
  │
  └─ PostgreSQL Testing → PGLite Backend
                        (WASM PG, no server)
```

### Worker Architecture Decision Tree

```
Choose Worker Type
  ├─ Local processing → WorkerManager (in-process threads)
  │
  └─ Distributed workers → SimpleOrchestrator + SimpleWorker
                          WebSocket communication
                          wsPort: 8080
                          round-robin/random distribution
```

### Job Development Flow

```
Create Job
  1. Extend BaseJob class
  2. Implement IJob interface
  3. Implement async run() method
  4. Validate payload with validatePayload()
  5. Return success/error via this.success()/this.error()
  6. Optional: Override getJobId() for custom IDs
  7. Optional: Use context.metaEnvelope for workflows
```

### Testing Flow

```
Test Development
  1. Use factory pattern: createTaskManager("test", { backend: "memory" })
  2. Isolate tests: create fresh instance in beforeEach()
  3. Cleanup: destroyTaskManager("test") in afterEach()
  4. Use scheduleAndWaitWith() for explicit manager control
  5. Test job logic independently of Workalot internals
```

### Production Deployment Flow

```
Production Setup
  1. Choose backend (SQLite/PostgreSQL/Redis)
  2. Enable job recovery: jobRecoveryEnabled: true
  3. Use environment variables: DATABASE_URL, REDIS_URL
  4. Configure worker count: maxThreads (system default or custom)
  5. Enable health checks: healthCheckInterval: 30000-60000
  6. Use silent mode: silent: true (reduce logging overhead)
  7. Set persistence: SQLite file path, PostgreSQL connection string
  8. Configure timeouts: reasonable jobTimeout values
  9. Monitor queue: getQueueStatsWith() every 30-60 seconds
  10. Graceful shutdown: wait for queue to drain before destroy
```

## Examples

### Example 1: Basic Job Scheduling (Singleton)

```typescript
import { scheduleAndWait } from "#/index.js";

const result = await scheduleAndWait({
  jobFile: "jobs/ProcessDataJob.ts",
  jobPayload: { data: [1, 2, 3, 4, 5] },
});

if (result.success) {
  console.log("Result:", result.result);
} else {
  console.error("Error:", result.error);
}
```

**Output**: Job completes, result returned

---

### Example 2: Factory Pattern with Multiple Queues

```typescript
import { createTaskManager, scheduleAndWaitWith, destroyTaskManager } from "#/index.js";

// Create separate instances
const mainQueue = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./main.db",
});

const priorityQueue = await createTaskManager("priority", {
  backend: "sqlite",
  databaseUrl: "./priority.db",
});

// Use appropriate queue
const urgentJob = await scheduleAndWaitWith(priorityQueue, {
  jobFile: "jobs/UrgentJob.ts",
  jobPayload: { priority: "high", data: "critical" },
});

const normalJob = await scheduleAndWaitWith(mainQueue, {
  jobFile: "jobs/NormalJob.ts",
  jobPayload: { priority: "normal", data: "standard" },
});

// Cleanup both
await Promise.all([destroyTaskManager("main"), destroyTaskManager("priority")]);
```

**Output**: Jobs routed to appropriate queues, both cleaned up

---

### Example 3: Distributed Workers

```typescript
import { SimpleOrchestrator, SimpleWorker } from "#/index.js";

// Orchestrator process
const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  distributionStrategy: "round-robin",
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./orchestrator.db",
  },
});

await orchestrator.start();

// Add job
const jobId = await orchestrator.addJob({
  id: "job-1",
  type: "ProcessData",
  payload: { data: [1, 2, 3] },
});

console.log("Job scheduled:", jobId);

// Worker processes (separate file)
// workers.ts
const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
});

await worker.start();
```

**Output**: Job scheduled on orchestrator, worker processes job, result returned

---

### Example 4: Complete Job with Workflow Meta Envelope

```typescript
import { BaseJob, IJob, JobExecutionContext } from "#/jobs/BaseJob.js";

interface WorkflowPayload {
  workflowId: string;
  step: string;
  data: any;
}

export default class WorkflowStepJob extends BaseJob implements IJob {
  async run(payload: WorkflowPayload, context?: JobExecutionContext): Promise<any> {
    // Initialize or access meta envelope
    if (!context?.metaEnvelope) {
      context.metaEnvelope = {
        workflowId: payload.workflowId,
        stepNumber: 1,
        previousResults: [],
        metadata: { startedAt: new Date().toISOString() },
      };
    }

    // Process current step
    const stepResult = {
      step: payload.step,
      timestamp: new Date().toISOString(),
      data: await this.processData(payload.data),
    };

    // Add to meta envelope
    context.metaEnvelope.previousResults.push(stepResult);
    context.metaEnvelope.stepNumber++;

    return this.success({
      stepResult,
      workflowProgress: context.metaEnvelope,
    });
  }

  private async processData(data: any): Promise<any> {
    // Step-specific processing logic
    return { processed: true };
  }
}
```

**Output**: Workflow job processes step, adds result to meta envelope, passes to next step
