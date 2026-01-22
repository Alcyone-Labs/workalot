# WebSocket Architecture

## Overview

Workalot v2.x uses WebSocket-based distributed architecture replacing Node.js worker threads (`postMessage`) from v1.x.

**Key Components**:
- **Orchestrator**: WebSocket server managing job queue and worker distribution
- **Workers**: WebSocket clients connecting to orchestrator for job processing
- **Channel Routing**: Hierarchical messaging for complex workflows
- **Message Types**: Structured communication between orchestrator and workers

## When to Use WebSocket Architecture

Use WebSocket workers when you need:
- Multi-machine job distribution (horizontal scaling)
- Independent worker processes (isolation, fault tolerance)
- Real-time job distribution across containers/nodes
- Process isolation (worker crashes don't affect orchestrator)
- Dynamic worker scaling (add/remove workers at runtime)

## Architecture Flow

```
┌─────────────────────────────────────────────┐
│         Application Layer                   │
│    (TaskManager / SimpleOrchestrator)   │
└──────────────┬───────────────────────────┘
               │ WebSocket (ws://host:8080/worker)
               │
       ┌───────┴──────────┐
       │  Orchestrator      │
       │  - Job Queue       │
       │  - Worker Manager   │
       │  - WebSocket Server  │
       └───────┬──────────┘
         WebSocket Connections
    ┌───────┼──────────┐
    │ Worker 1 │ Worker 2 ... Worker N
    │ (Thread) │ (Thread)       │ (Thread)
    └───────┴──────────┘
       Worker Processes
```

## Message Flow

1. **Job Scheduling**: App → TaskManager → Queue Backend
2. **Job Distribution**: Orchestrator → Worker (EXECUTE_JOB message)
3. **Job Execution**: Worker runs job in worker thread
4. **Job Result**: Worker → Orchestrator (JOB_RESULT message)
5. **Status Update**: Orchestrator → Queue Backend (job status: processing → completed)

## Orchestrator

### SimpleOrchestrator

Basic orchestrator with round-robin or random worker distribution:

```typescript
import { SimpleOrchestrator } from "#/index.js";

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  wsHostname: "localhost", // or "0.0.0.0" for all interfaces
  distributionStrategy: "round-robin", // or "random"
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./orchestrator.db",
  },
});

// Add jobs
await orchestrator.addJob({
  id: "job-1",
  type: "ProcessData",
  payload: { data: [1, 2, 3] },
});

// Start orchestrator
await orchestrator.start();

// Shutdown
await orchestrator.shutdown();
```

**Configuration Options**:
- `wsPort`: WebSocket server port (default: 8080)
- `wsHostname`: Server hostname (default: "localhost")
- `distributionStrategy`: "round-robin" | "random" (default: "round-robin")
- `queueConfig`: Queue backend configuration

## Workers

### SimpleWorker

Basic worker connecting to orchestrator:

```typescript
import { SimpleWorker } from "#/index.js";

const worker = new SimpleWorker({
  workerId: 1, // Unique worker identifier
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(), // Root for job file resolution
  defaultTimeout: 30000, // Default job timeout (ms)
});

await worker.start();

// Shutdown
await worker.shutdown();
```

**Configuration Options**:
- `workerId`: Unique worker number (1, 2, 3, ...)
- `wsUrl`: WebSocket server URL
- `projectRoot`: Project root directory for job file resolution
- `defaultTimeout`: Default timeout for all jobs (ms)

### Custom Worker

Extend SimpleWorker for custom job processing:

```typescript
import { SimpleWorker, WorkerMessageType } from "#/index.js";

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
    // Custom job execution logic
    const result = await this.processJob(jobPayload);

    // Send result back to orchestrator
    this.wsClient.send({
      type: WorkerMessageType.JOB_RESULT,
      payload: {
        jobId: jobPayload.jobId,
        success: true,
        result,
      },
    });
  }

  private async processJob(payload: any): Promise<any> {
    // Job-specific processing logic
    return { processed: true };
  }
}

const worker = new CustomWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
});

await worker.start();
```

## Channel Routing

Hierarchical messaging for complex workflows:

```typescript
import { WebSocketServer, ChannelMessage } from "#/index.js";

// Send structured channel messages
server.sendChannelToWorker(workerId, {
  type: "workflow",
  subChannel: "step-complete",
  action: "transform-data",
  payload: {
    workflowId: "wf-123",
    stepNumber: 2,
    result: { data: "processed" },
  },
});

// Register channel route handlers
server.registerChannelRoute({
  handler: (connection, message) => {
    console.log(`Received ${message.action} on ${message.subChannel}`);

    // Handle workflow step completion
    if (message.action === "step-complete") {
      // Schedule next step...
    }
  },
});
```

**Channel Message Format**:
```typescript
interface ChannelMessage {
  type: string; // Main message type
  subChannel?: string; // Sub-channel for routing
  action: string; // Specific action
  payload: any; // Message payload
}
```

## Worker Message Types

### Core Message Types

```typescript
enum WorkerMessageType {
  EXECUTE_JOB = "execute-job",
  JOB_RESULT = "job-result",
  HEARTBEAT = "heartbeat",
  WORKER_READY = "worker-ready",
  WORKER_SHUTDOWN = "worker-shutdown",
}

interface WorkerMessage {
  type: WorkerMessageType;
  payload?: any;
  workerId?: number;
}
```

### EXECUTE_JOB

Orchestrator sends job to worker:

```typescript
{
  type: WorkerMessageType.EXECUTE_JOB,
  payload: {
    jobId: "01KFHR1234567890",
    jobFile: "jobs/ProcessDataJob.ts",
    jobPayload: { data: [1, 2, 3] },
  },
}
```

### JOB_RESULT

Worker sends result back to orchestrator:

```typescript
{
  type: WorkerMessageType.JOB_RESULT,
  payload: {
    jobId: "01KFHR1234567890",
    success: true,
    result: { processed: true },
    executionTime: 1234,
    retryCount: 0,
  },
}
```

### HEARTBEAT

Periodic worker health check:

```typescript
{
  type: WorkerMessageType.HEARTBEAT,
  payload: {
    workerId: 1,
    timestamp: new Date().toISOString(),
    jobsProcessed: 123,
    jobsFailed: 2,
  },
}
```

## Connection Lifecycle

### Worker Connection Flow

1. **Connect**: Worker → `ws://host:8080/worker`
2. **Handshake**: Worker sends WORKER_READY message
3. **Job Receipt**: Orchestrator assigns worker ID
4. **Job Processing**: Orchestrator sends EXECUTE_JOB messages
5. **Job Completion**: Worker sends JOB_RESULT messages
6. **Reconnection**: Worker reconnects if connection lost

### Orchestrator Worker Management

Orchestrator tracks worker state:
- **Idle**: Available for new jobs
- **Busy**: Currently processing job
- **Offline**: Disconnected from WebSocket

## Error Handling

### Connection Loss Recovery

Workers automatically reconnect on connection loss:

```typescript
// SimpleWorker handles reconnection automatically
// Exponential backoff: 1s, 2s, 4s, 8s, 16s max
```

### Worker Timeout Handling

Jobs that exceed timeout are marked as failed:

```typescript
// Orchestrator tracks job timeout
// Worker receives timeout error
// Job marked as failed in queue
```

### Orchestorator Startup Failure

If WebSocket server fails to start:

```typescript
try {
  await orchestrator.start();
} catch (error) {
  console.error("Failed to start orchestrator:", error);
  // Fallback or alert
  process.exit(1);
}
```

## Performance Considerations

### Worker Scaling

**Optimal worker count**: `os.cpus().length - 2`

- **Development**: 2-4 workers
- **Testing**: 1 worker
- **Production**: System default or custom
- **High-throughput**: All cores minus 1-2

### Job Distribution Strategies

**Round-Robin**: Workers 1, 2, 3, 1, 2, 3...
- Predictable distribution
- Good for equal job durations
- Fair load balancing

**Random**: Workers 2, 1, 3, 2, 1, 3...
- Better for variable job durations
- Averages out processing times
- Simple implementation

### Network Considerations

**Latency**: WebSocket adds ~1-5ms latency vs in-memory worker threads

**Throughput**: Still high (10K-50K jobs/sec) due to async nature

**Bandwidth**: Minimal for small payloads (<1KB), larger payloads need optimization
