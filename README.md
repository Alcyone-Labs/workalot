# @alcyone-labs/workalot

A high-performance, flexible job queue system for Node.js with multiple backend options, WebSocket-based architecture, and extensible design.

## Key Features

- 🚀 **High Performance**: Linear scaling with worker count, optimized for throughput
- 🔄 **Multiple Backends**: Memory, SQLite, PGLite, PostgreSQL, and Redis options
- 🌐 **WebSocket Architecture**: Distributed worker support with real-time communication
- 📡 **Channel Routing**: Hierarchical WebSocket messaging with `{type, subChannel?, action, payload}` semantics
- 🎯 **Simple API**: Easy-to-use functions with progressive complexity options
- 🏗️ **Extensible Design**: Build custom workers and orchestrators
- 💾 **Flexible Persistence**: Choose the right backend for your needs
- 🔧 **TypeScript First**: Full type safety with excellent IDE support
- 🏭 **Factory Pattern**: Better testability and multiple instance support
- 🛡️ **Fault Tolerant**: Automatic job recovery and error handling
- 📋 **Workflow Support**: Meta envelope for passing structured data between job steps

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Architecture Overview](#architecture-overview)
- [API Documentation](#api-documentation)
  - [WebSocket Distributed Workers](#websocket-distributed-workers)
  - [Channel Routing](#channel-routing)
  - [Structured Message Routing](#structured-message-routing)
- [Queue Backends](#queue-backends)
  - [TimescaleDB Support](#timescaledb-support)
- [Creating Jobs](#creating-jobs)
  - [Workflow Jobs with Meta Envelope](#workflow-jobs-with-meta-envelope)
- [Examples](#examples)
- [Migration Guide](#migration-guide)
- [Best Practices](#best-practices)

## Quick Start

```typescript
import { createTaskManager, scheduleAndWaitWith } from "@alcyone-labs/workalot";

// Create a task manager instance
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
});

// Schedule and wait for a job
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/ProcessDataJob.ts",
  jobPayload: { data: [1, 2, 3, 4, 5] },
});

console.log("Job completed:", result);

// Clean up
await destroyTaskManager("main");
```

## Installation

```bash
npm install @alcyone-labs/workalot
```

### Optional Backend Dependencies

Depending on your chosen backend, you may need additional dependencies:

```bash
# For SQLite backend (Node.js)
npm install better-sqlite3

# For PostgreSQL backend
npm install postgres

# For PGLite backend (WebAssembly PostgreSQL)
npm install @electric-sql/pglite

# For Redis backend
npm install ioredis
```

**Note**: If using Bun runtime, SQLite is built-in and doesn't require additional dependencies.

## Architecture Overview

Workalot uses a modern WebSocket-based architecture that enables:

- **Distributed Workers**: Run workers on different machines or containers
- **Real-time Communication**: Instant job distribution and result reporting
- **Flexible Deployment**: Works in various environments (Node.js, Bun, containers)
- **Progressive Complexity**: Simple API for basic use, extensible for advanced needs

### Core Components

```
┌─────────────────────────────────────────────────┐
│                 User Application                 │
├─────────────────────────────────────────────────┤
│              Task Manager (Factory)              │
├─────────────────┬───────────────────────────────┤
│   Orchestrator  │        Workers                 │
│   (WebSocket)   │    (WebSocket Clients)         │
├─────────────────┴───────────────────────────────┤
│              Queue Backend                       │
│   (Memory/SQLite/PGLite/PostgreSQL/Redis)       │
└─────────────────────────────────────────────────┘
```

## API Documentation

### Factory Pattern (Recommended)

The factory pattern provides better testability and support for multiple instances:

```typescript
import { createTaskManager, scheduleAndWaitWith, destroyTaskManager } from "@alcyone-labs/workalot";

// Create a named instance
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
  maxThreads: 4,
});

// Use the instance
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "test" },
});

// Clean up when done
await destroyTaskManager("main");
```

### Factory Presets

Use pre-configured factories for common scenarios:

```typescript
import { TaskManagerFactoryPresets } from "@alcyone-labs/workalot";

// Development environment
const devFactory = TaskManagerFactoryPresets.development();
const devManager = await devFactory.create("dev");

// Production with SQLite
const prodFactory = TaskManagerFactoryPresets.productionSQLite("./prod.db");
const prodManager = await prodFactory.create("main");

// Production with PostgreSQL
const pgFactory = TaskManagerFactoryPresets.productionPostgreSQL(
  "postgresql://user:pass@localhost/db",
);
const pgManager = await pgFactory.create("main");
```

### Simple Components

For basic use cases, use the simplified orchestrator and worker:

```typescript
// orchestrator.ts
import { SimpleOrchestrator } from "@alcyone-labs/workalot";

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./queue.db",
  },
});

await orchestrator.start();

// Add jobs
await orchestrator.addJob({
  id: "job-1",
  type: "ProcessData",
  payload: { data: "test" },
});

// worker.ts (separate process)
import { SimpleWorker } from "@alcyone-labs/workalot";

const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
});

await worker.start();
```

### Core Functions

#### `scheduleAndWaitWith(manager, jobPayload)`

Schedule a job and wait for completion:

```typescript
const result = await scheduleAndWaitWith(manager, {
  jobFile: "jobs/ProcessDataJob.ts",
  jobPayload: { data: [1, 2, 3] },
  jobTimeout: 10000, // Optional timeout in ms
});
```

#### `scheduleWith(manager, jobPayload)`

Schedule a job without waiting (fire-and-forget):

```typescript
const jobId = await scheduleWith(manager, {
  jobFile: "jobs/BackgroundJob.ts",
  jobPayload: { task: "cleanup" },
});
```

#### `whenFreeWith(manager, callback)`

Register a callback for when the queue becomes empty:

```typescript
whenFreeWith(manager, () => {
  console.log("All jobs completed!");
});
```

### Configuration Options

```typescript
interface QueueConfig {
  backend?: "memory" | "sqlite" | "pglite" | "postgresql" | "redis";
  databaseUrl?: string;
  maxThreads?: number;
  persistenceFile?: string;
  healthCheckInterval?: number;
  silent?: boolean;
  jobRecoveryEnabled?: boolean;
  maxInMemoryAge?: number;
}
```

## Queue Backends

Workalot provides five backend options, each optimized for different use cases:

### TimescaleDB Support

Workalot also provides specialized support for TimescaleDB, enabling optimized time-series job processing with automatic compression and retention policies. See [TimescaleDB Integration](./docs/README-TimescaleDB.md) for detailed documentation.

### 1. Memory Backend

**Purpose**: Ultra-fast, in-process queue for development and temporary jobs

**Strengths**:

- ⚡ Blazing fast (100,000+ jobs/sec)
- 📦 Zero configuration
- 🔄 Microsecond latency
- 🧪 Perfect for testing

**Weaknesses**:

- ❌ No persistence
- 🔒 Single process only
- 💾 Limited by RAM
- ⚠️ Data loss on restart

**Configuration**:

```typescript
const manager = await createTaskManager("dev", {
  backend: "memory",
  maxInMemoryAge: 60 * 60 * 1000, // 1 hour retention
});
```

**Best For**: Development, testing, temporary processing, CI/CD pipelines

### 2. SQLite Backend

**Purpose**: Reliable file-based queue with excellent performance

**Strengths**:

- 🚀 High performance (10,000-50,000 jobs/sec)
- 💾 Automatic persistence
- 📁 Single file database
- 🔄 WAL mode for concurrency
- ✅ ACID compliant
- 🎯 Zero dependencies (with Bun)

**Weaknesses**:

- 🖥️ Single machine only
- ✍️ Single writer limitation
- 🔒 File locking on network filesystems
- 📈 Performance degrades with size

**Configuration**:

```typescript
const manager = await createTaskManager("prod", {
  backend: "sqlite",
  databaseUrl: "./queue.db", // or 'memory://' for in-memory
  sqliteConfig: {
    walMode: true, // Better concurrency
    busyTimeout: 5000, // Wait for locks
    synchronous: "NORMAL", // Balance safety/speed
  },
});
```

**Best For**: Single-server applications, edge computing, embedded systems, small to medium workloads

### 3. PGLite Backend

**Purpose**: PostgreSQL-compatible queue in WebAssembly

**Strengths**:

- 🐘 Full PostgreSQL compatibility
- 🔧 Advanced SQL features
- 📊 Rich data types
- 🏗️ No server required
- 🔍 Complex queries

**Weaknesses**:

- 🐌 WebAssembly overhead
- 💾 Higher memory usage
- ⏱️ Slow startup (1-2 seconds)
- 🧪 Experimental status
- 🔌 No network access

**Configuration**:

```typescript
const manager = await createTaskManager("test", {
  backend: "pglite",
  databaseUrl: "./data/pglite", // Directory for data
  pgliteConfig: {
    memory: true, // In-memory mode
    relaxedDurability: true, // Trade durability for speed
  },
});
```

**Best For**: PostgreSQL compatibility testing, offline-first apps, serverless environments

### 4. PostgreSQL Backend

**Purpose**: Enterprise-grade distributed queue

**Strengths**:

- 🏢 Enterprise features (replication, HA)
- 🌐 Horizontal scalability
- 📡 LISTEN/NOTIFY for real-time
- 🔒 Row-level locking
- 📊 Advanced monitoring
- 🔄 Point-in-time recovery
- ⏱️ TimescaleDB integration for time-series optimization

**Weaknesses**:

- 🔧 Complex setup
- 🌐 Network latency
- 💰 Infrastructure costs
- 📚 Maintenance overhead
- 🎯 Overkill for simple needs

**Configuration**:

```typescript
const manager = await createTaskManager("enterprise", {
  backend: "postgresql",
  databaseUrl: "postgresql://user:pass@localhost:5432/queue_db",
  postgresConfig: {
    poolSize: 20,
    enableListen: true, // LISTEN/NOTIFY
    enablePartitioning: true, // Table partitioning
    ssl: { rejectUnauthorized: true },
  },
  enableTimescaleDB: true, // Enable TimescaleDB features
  chunkTimeInterval: "1 hour", // Hypertable chunk size
  compressionInterval: "7 days", // Compress old chunks
  retentionInterval: "90 days", // Drop very old data
});
```

**Best For**: Production systems, distributed applications, high-availability requirements, time-series job processing

**TimescaleDB Integration**: When `enableTimescaleDB` is set to `true`, Workalot automatically converts the job queue table to a TimescaleDB hypertable with compression and retention policies. This provides 70-90% storage reduction for historical job data and optimized time-series queries. See [TimescaleDB Integration](./docs/README-TimescaleDB.md) for detailed documentation.

### 5. Redis Backend

**Purpose**: Ultra-high-performance distributed queue with atomic operations

**Strengths**:

- ⚡ Blazing fast (10,000-50,000 jobs/sec)
- 🔒 Atomic operations via Lua scripts
- 🌐 Horizontal scalability (Redis Cluster)
- 📡 Pub/Sub for real-time notifications
- 🔄 Connection pooling
- ☁️ Edge-compatible (Upstash, Cloudflare)
- 🎯 Priority queue with sorted sets
- 🧹 Auto-cleanup with TTL

**Weaknesses**:

- 💾 In-memory (higher costs at scale)
- 🔧 Requires Redis server
- 💰 Memory-based pricing
- 🔄 Persistence trade-offs (RDB/AOF)

**Configuration**:

```typescript
const manager = await createTaskManager("high-perf", {
  backend: "redis",
  databaseUrl: "redis://localhost:6379",
  redisConfig: {
    keyPrefix: "workalot",
    completedJobTTL: 86400, // 24 hours
    failedJobTTL: 604800, // 7 days
    enablePubSub: true, // Real-time notifications
  },
});

// Or with Upstash (Cloudflare-compatible)
const edgeManager = await createTaskManager("edge", {
  backend: "redis",
  databaseUrl: process.env.UPSTASH_REDIS_URL,
  redisConfig: {
    tls: { rejectUnauthorized: false },
  },
});
```

**Best For**: High-throughput systems, real-time processing, distributed workers, edge computing (with Upstash), microservices

**Performance**: Redis provides the highest throughput of all backends with atomic job claiming via Lua scripts (similar to PostgreSQL's FOR UPDATE SKIP LOCKED). Expected performance: 10,000-50,000 jobs/second on a single instance. See [Redis Queue Documentation](./docs/REDIS_QUEUE.md) for detailed information.

### Backend Selection Guide

```
┌──────────────────────────────────────────────────────┐
│ What's your primary requirement?                     │
│                                                      │
│  Development/Testing ──► Memory Backend             │
│                          (Fastest, no persistence)  │
│                                                      │
│  Single Machine ──► SQLite Backend                  │
│                    (Simple, reliable, persistent)   │
│                                                      │
│  High Throughput ──► Redis Backend                  │
│                     (10k-50k jobs/sec, distributed) │
│                                                      │
│  Enterprise/HA ──► PostgreSQL Backend               │
│                   (Replication, ACID, TimescaleDB)  │
│                                                      │
│  Edge Computing ──► Redis (Upstash) or PGLite      │
│                    (Cloudflare Workers compatible)  │
│                                                      │
│  PostgreSQL Testing ──► PGLite Backend              │
│                        (WebAssembly PostgreSQL)     │
└──────────────────────────────────────────────────────┘
```

### Backend Comparison Table

| Feature          | Memory     | SQLite        | PGLite     | PostgreSQL      | Redis        |
| ---------------- | ---------- | ------------- | ---------- | --------------- | ------------ |
| **Performance**  | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐      | ⭐⭐⭐     | ⭐⭐⭐⭐        | ⭐⭐⭐⭐⭐   |
| **Throughput**   | 100k+/s    | 10-50k/s      | 1-10k/s    | 10-50k/s        | 10-50k/s     |
| **Persistence**  | ❌         | ✅            | ✅         | ✅              | ✅           |
| **Distribution** | ❌         | ❌            | ❌         | ✅              | ✅           |
| **Atomic Ops**   | ✅         | ✅            | ✅         | ✅ (FOR UPDATE) | ✅ (Lua)     |
| **Setup**        | None       | Minimal       | Minimal    | Complex         | Medium       |
| **Edge Deploy**  | ✅         | ✅            | ✅         | ❌              | ✅ (Upstash) |
| **Memory Usage** | Low        | Low           | Medium     | Medium          | High         |
| **Best For**     | Dev/Test   | Single server | PG testing | Enterprise      | High perf    |

## Creating Jobs

Jobs are TypeScript/JavaScript classes that extend `BaseJob`:

### Basic Job Structure

```typescript
// jobs/ProcessDataJob.ts
import { BaseJob, IJob } from "@alcyone-labs/workalot";

interface ProcessDataPayload {
  data: number[];
  operation: "sum" | "average" | "max";
}

export default class ProcessDataJob extends BaseJob implements IJob {
  async run(payload: ProcessDataPayload): Promise<any> {
    // Validate input
    if (!Array.isArray(payload.data)) {
      return this.error("Invalid data: expected array");
    }

    // Process data
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

    // Return success
    return this.success({
      result,
      processedAt: new Date().toISOString(),
    });
  }
}
```

### Job with Error Handling

```typescript
import { BaseJob, IJob } from "@alcyone-labs/workalot";

export default class RobustJob extends BaseJob implements IJob {
  async run(payload: any): Promise<any> {
    try {
      // Validate payload
      this.validatePayload(payload, {
        required: ["userId", "action"],
        types: {
          userId: "number",
          action: "string",
        },
      });

      // Perform operation
      const result = await this.performAction(payload);

      return this.success(result);
    } catch (error) {
      // Detailed error reporting
      return this.error(error instanceof Error ? error.message : "Unknown error", {
        payload,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async performAction(payload: any) {
    // Your business logic here
    return { processed: true };
  }
}
```

### Job with Custom ID

```typescript
export default class CustomIdJob extends BaseJob implements IJob {
  getJobId(payload: any): string {
    // Generate deterministic ID based on payload
    return `user-${payload.userId}-${payload.action}-${Date.now()}`;
  }

  async run(payload: any): Promise<any> {
    // Job implementation
    return this.success({ processed: true });
  }
}
```

### Workflow Jobs with Meta Envelope

Jobs can pass structured data between workflow steps using the meta envelope:

```typescript
import { BaseJob, IJob, JobExecutionContext } from "@alcyone-labs/workalot";

export default class WorkflowStepJob extends BaseJob implements IJob {
  async run(payload: any, context: JobExecutionContext): Promise<any> {
    // Initialize meta envelope if not present
    if (!context.metaEnvelope) {
      context.metaEnvelope = {
        workflowId: payload.workflowId || "default",
        stepNumber: 1,
        previousResults: [],
        metadata: {},
      };
    }

    // Add current step result to meta envelope
    const stepResult = {
      step: "data-processing",
      timestamp: new Date().toISOString(),
      success: true,
      data: payload,
    };

    context.metaEnvelope.previousResults.push(stepResult);
    context.metaEnvelope.stepNumber++;

    // Store additional metadata
    context.metaEnvelope.metadata = {
      ...context.metaEnvelope.metadata,
      lastProcessedAt: new Date().toISOString(),
      processingTime: Date.now() - context.startTime,
    };

    return this.success({
      message: "Step completed successfully",
      stepResult,
      workflowProgress: context.metaEnvelope,
    });
  }
}
```

### Accessing Workflow Context

Subsequent jobs in a workflow can access the accumulated context:

```typescript
export default class ValidationJob extends BaseJob implements IJob {
  async run(payload: any, context: JobExecutionContext): Promise<any> {
    if (!context.metaEnvelope) {
      throw new Error("Meta envelope not found - this job should be part of a workflow");
    }

    const workflowId = context.metaEnvelope.workflowId;
    const stepNumber = context.metaEnvelope.stepNumber;
    const previousResults = context.metaEnvelope.previousResults;

    console.log(`Processing step ${stepNumber} of workflow ${workflowId}`);
    console.log(`Previous results: ${previousResults.length} steps completed`);

    // Add current step to the envelope
    const currentStep = {
      step: "validation",
      timestamp: new Date().toISOString(),
      success: true,
      validationResults: payload,
    };

    context.metaEnvelope.previousResults.push(currentStep);
    context.metaEnvelope.stepNumber++;

    return this.success({
      workflowId,
      stepNumber,
      currentStep,
      totalSteps: context.metaEnvelope.previousResults.length,
    });
  }
}
```

## Examples

Workalot provides several examples to help you get started:

- [Basic Usage](./examples/basic-usage.ts) - Simple job processing with different backends
- [Quick Start](./examples/quick-start.ts) - Minimal example to get up and running quickly
- [Basic Distributed](./examples/basic-distributed/) - Simple WebSocket-based distributed processing
- [WebSocket Distributed](./examples/websocket-distributed/) - More advanced distributed processing
- [Channel Routing](./examples/channel-routing-example.ts) - Hierarchical WebSocket messaging with channel routing
- [Meta Envelope](./examples/meta-envelope-example.ts) - Workflow jobs with structured data passing
- [TimescaleDB Integration](./examples/timescaledb-example.ts) - Time-series job processing with compression
- [Custom Orchestration](./examples/custom-orchestration/) - Building custom orchestrators
- [Error Handling](./examples/error-handling.ts) - Proper error handling in jobs
- [Factory Pattern](./examples/factory-pattern.ts) - Using the factory pattern for better testability

### High-Throughput Processing

```typescript
import { createTaskManager, scheduleWith } from "@alcyone-labs/workalot";

// Create high-performance manager
const manager = await createTaskManager("processor", {
  backend: "memory", // Maximum speed
  maxThreads: 8, // Use available cores
  silent: true, // Reduce logging overhead
});

// Schedule many jobs
const jobs = Array.from({ length: 10000 }, (_, i) => ({
  jobFile: "jobs/ProcessItem.ts",
  jobPayload: { itemId: i },
}));

// Fire and forget for maximum throughput
const promises = jobs.map((job) => scheduleWith(manager, job));
await Promise.all(promises);

console.log("All jobs scheduled");
```

### WebSocket Distributed Workers

Workalot supports distributed job processing through WebSocket communication between an orchestrator and multiple workers. This allows you to scale job processing across multiple machines or processes.

#### Orchestrator

The orchestrator manages the job queue and distributes jobs to workers:

```typescript
import { SimpleOrchestrator } from "@alcyone-labs/workalot";

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  wsHostname: "localhost",
  distributionStrategy: "round-robin", // or "random"
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./orchestrator-queue.db",
  },
});

await orchestrator.start();
```

#### Workers

Workers connect to the orchestrator and process jobs:

```typescript
import { SimpleWorker } from "@alcyone-labs/workalot";

const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
  defaultTimeout: 30000,
});

await worker.start();
```

#### Custom Job Processing

Workers can implement custom job processing logic by extending `SimpleWorker`:

```typescript
class CustomWorker extends SimpleWorker {
  protected async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case WorkerMessageType.EXECUTE_JOB:
        await this.executeCustomJob(message.payload as JobPayload);
        break;

      default:
        await super.handleMessage(message);
        break;
    }
  }

  private async executeCustomJob(jobPayload: JobPayload): Promise<void> {
    // Custom job execution logic based on job type
    // Send results back to orchestrator using this.wsClient.send()
  }
}
```

#### Channel Routing

Workalot supports hierarchical WebSocket messaging for complex workflows:

```typescript
import { WebSocketServer, ChannelMessage } from "@alcyone-labs/workalot";

// Send structured channel messages
server.sendChannelToWorker(workerId, {
  type: "data-processing",
  subChannel: "workflow",
  action: "step-complete",
  payload: { stepId: "transform", result: "success" },
});

// Register channel route handlers
server.registerChannelRoute({
  handler: (connection, message) => {
    console.log(`Received ${message.action} for ${message.type}`);
    // Handle workflow step completion
  },
});
```

#### Structured Message Routing

Register custom message filters beyond simple type matching:

```typescript
import { WorkerMessageType } from "@alcyone-labs/workalot";

// Register custom message filters
server.registerStructuredRoute(
  (message) => message.type === WorkerMessageType.JOB_RESULT && message.payload?.success === false,
  (connection, message) => {
    console.log("Handling failed job:", message.payload);
    // Custom logic for failed jobs
  },
);
```

See `examples/basic-distributed/` for a complete working example.

### Real-time Monitoring

```typescript
import { createTaskManager } from "@alcyone-labs/workalot";

const manager = await createTaskManager("monitor", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
});

// Monitor queue status
setInterval(async () => {
  const stats = await manager.getQueueStats();
  const workers = await manager.getWorkerStats();

  console.clear();
  console.log("Queue Status:");
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Processing: ${stats.processing}`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log("\nWorker Status:");
  console.log(`  Total: ${workers.totalWorkers}`);
  console.log(`  Available: ${workers.availableWorkers}`);
  console.log(`  Busy: ${workers.busyWorkers}`);
}, 1000);
```

### Testing with Factory Pattern

```typescript
import { TaskManagerFactory } from "@alcyone-labs/workalot";
import { beforeEach, afterEach, test, expect } from "vitest";

let factory: TaskManagerFactory;
let manager: TaskManager;

beforeEach(async () => {
  factory = new TaskManagerFactory({
    backend: "memory",
    silent: true,
  });
  manager = await factory.create("test");
});

afterEach(async () => {
  await factory.destroyAll();
});

test("should process job successfully", async () => {
  const result = await scheduleAndWaitWith(manager, {
    jobFile: "jobs/TestJob.ts",
    jobPayload: { test: true },
  });

  expect(result.success).toBe(true);
  expect(result.result).toEqual({ processed: true });
});
```

## Migration Guide

### Migrating from v1.x (postMessage) to v2.x (WebSocket)

The v2.0 release transitions from Node.js Worker threads to WebSocket architecture:

#### Before (v1.x)

```typescript
import { WorkerManager } from "workalot";

const workerManager = new WorkerManager(orchestrator, {
  numWorkers: 4,
});
```

#### After (v2.x)

```typescript
import { WorkerManagerWS } from "workalot";

const workerManager = new WorkerManagerWS(orchestrator, {
  numWorkers: 4,
  wsPort: 8080,
});
```

See [Migration Guide](./docs/migration-guide.md) for detailed instructions.

### Migrating from Singleton to Factory

#### Before (Singleton)

```typescript
import { initializeTaskManager, scheduleAndWait } from "workalot";

await initializeTaskManager({ backend: "sqlite" });
const result = await scheduleAndWait({
  /* ... */
});
```

#### After (Factory)

```typescript
import { createTaskManager, scheduleAndWaitWith } from "workalot";

const manager = await createTaskManager("main", { backend: "sqlite" });
const result = await scheduleAndWaitWith(manager, {
  /* ... */
});
```

## Best Practices

### 1. Choose the Right Backend

- **Development**: Use Memory backend for speed
- **Testing**: Use Memory or SQLite in-memory
- **Production (Single Server)**: Use SQLite with WAL
- **Production (Distributed)**: Use PostgreSQL
- **Special Cases**: Use PGLite for PostgreSQL compatibility without a server

### 2. Job Design

- Keep jobs idempotent when possible
- Use meaningful job IDs for tracking
- Validate input thoroughly
- Return structured results
- Handle errors gracefully

### 3. Performance Optimization

- Use batch operations for bulk processing
- Enable silent mode in production
- Configure appropriate worker counts
- Use connection pooling with PostgreSQL
- Regular maintenance (VACUUM for SQLite)

### 4. Error Handling

- Always validate job payloads
- Use try-catch in job implementations
- Return detailed error information
- Enable job recovery for critical tasks
- Monitor failed jobs

### 5. Testing

- Use factory pattern for isolated tests
- Mock WebSocket connections when needed
- Test job implementations separately
- Use in-memory backends for speed
- Clean up resources properly

### 6. Advanced Features

- **Channel Routing**: Use for complex workflows requiring hierarchical messaging
- **Structured Routing**: Implement custom message filters for specialized processing
- **Meta Envelope**: Use for workflow jobs that need to pass structured data between steps
- **Workflow Design**: Keep workflow steps idempotent and handle failures gracefully
- **Message Patterns**: Design clear message schemas for channel-based communication

## Performance Benchmarks

| Backend    | Throughput (jobs/sec) | Latency (ms) | Persistence | Scalability    |
| ---------- | --------------------- | ------------ | ----------- | -------------- |
| Memory     | 100,000+              | <1           | No          | Single Process |
| SQLite     | 10,000-50,000         | 1-5          | Yes         | Single Machine |
| PGLite     | 1,000-5,000           | 5-20         | Yes         | Single Machine |
| PostgreSQL | 5,000-50,000          | 2-10         | Yes         | Multi-Machine  |

_Benchmarks performed on MacBook Pro M1 with 8 workers_

**TimescaleDB**: When using the PostgreSQL backend with TimescaleDB features enabled, job processing performance remains similar to regular PostgreSQL, but storage requirements are reduced by 70-90% for historical job data through automatic compression.

## Requirements

- Node.js 18+ or Bun 1.0+
- TypeScript 5.0+ (for TypeScript projects)
- Optional backend dependencies (see Installation)

## License

MIT

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Support

- 📖 [Documentation](./docs)
- 🐛 [Issue Tracker](https://github.com/alcyone-labs/workalot/issues)
- 💬 [Discussions](https://github.com/alcyone-labs/workalot/discussions)
- 📧 [Email Support](mailto:support@alcyonelabs.com)

## Roadmap

### Current Release (v2.0)

- ✅ WebSocket architecture
- ✅ Factory pattern support
- ✅ Simplified components
- ✅ Multiple backend options
- ✅ Channel routing for hierarchical messaging
- ✅ Structured message routing
- ✅ Workflow support with meta envelope

### Upcoming (v2.x)

- 🔄 Browser worker support
- 🔄 Redis backend
- 🔄 Priority queues
- 🔄 Scheduled jobs
- 🔄 Job dependencies
- 🔄 Advanced workflow orchestration
- 🔄 Job batching and streaming

### Future (v3.0)

- 🔮 GraphQL API
- 🔮 Admin dashboard
- 🔮 Cluster mode
- 🔮 Cloud-native features

---

Built with ❤️ by [Alcyone Labs](https://alcyonelabs.com)
