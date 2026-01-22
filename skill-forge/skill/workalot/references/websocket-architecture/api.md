# WebSocket Architecture API

## SimpleOrchestrator API

```typescript
import { SimpleOrchestrator } from "#/index.js";

const orchestrator = new SimpleOrchestrator(config: {
  wsPort: number; // Default: 8080
  wsHostname?: string; // Default: "localhost"
  distributionStrategy?: "round-robin" | "random"; // Default: "round-robin"
  queueConfig: QueueConfig; // Queue backend configuration
});

// Methods
await orchestrator.start(): Promise<void>;
await orchestrator.shutdown(): Promise<void>;
await orchestrator.addJob(job: object): Promise<string>; // Returns job ID
orchestrator.on("job-completed", (job) => {}); // Event listeners
```

## SimpleWorker API

```typescript
import { SimpleWorker } from "#/index.js";

const worker = new SimpleWorker(config: {
  workerId: number; // Required
  wsUrl: string; // Required, format: "ws://host:port/worker"
  projectRoot: string; // Required, for job file resolution
  defaultTimeout?: number; // Default: 30000 (30 seconds)
});

// Methods
await worker.start(): Promise<void>;
await worker.shutdown(): Promise<void>;
worker.on("job-completed", (result) => {}); // Event listeners
```

## WebSocketServer API

```typescript
import { WebSocketServer } from "#/index.js";

const server = new WebSocketServer(config: {
  wsPort: number;
  wsHostname?: string;
});

// Methods
server.sendToWorker(workerId: number, message: WorkerMessage): void;
server.sendChannelToWorker(workerId: number, message: ChannelMessage): void;
server.broadcastToAllWorkers(message: WorkerMessage): void;
server.registerChannelRoute(config: ChannelRouteConfig): void;
server.registerStructuredRoute(config: StructuredRouteConfig): void;
server.getConnectedWorkerCount(): number;
server.on(event: string, handler: Function): void;
```

## Channel Routing API

### registerChannelRoute

Register handler for channel-based messages:

```typescript
interface ChannelRouteConfig {
  handler: (connection: any, message: ChannelMessage) => void;
}

server.registerChannelRoute({
  handler: (connection, message) => {
    console.log(`Channel: ${message.type}/${message.subChannel}`);
    console.log(`Action: ${message.action}`);
  },
});
```

### sendChannelToWorker

Send channel-routed message to specific worker:

```typescript
server.sendChannelToWorker(workerId, {
  type: "workflow",
  subChannel: "step-1",
  action: "complete",
  payload: { result: "success" },
});
```

### ChannelMessage Interface

```typescript
interface ChannelMessage {
  type: string; // Main message type
  subChannel?: string; // Sub-channel for routing
  action: string; // Specific action within sub-channel
  payload: any; // Action-specific payload
}
```

## Structured Routing API

### registerStructuredRoute

Register custom message filter for advanced routing:

```typescript
interface StructuredRouteConfig {
  filter: (message: WorkerMessage) => boolean;
  handler: (connection: any, message: WorkerMessage) => void;
}

server.registerStructuredRoute(
  // Filter: Only match specific messages
  (message) =>
    message.type === WorkerMessageType.JOB_RESULT &&
    message.payload?.success === false,

  // Handler: Process matched messages
  (connection, message) => {
    console.error("Job failed:", message.payload.error);
    // Handle failed jobs separately
  },
);
```

## Worker Message Types API

### WorkerMessageType Enum

```typescript
enum WorkerMessageType {
  EXECUTE_JOB = "execute-job",
  JOB_RESULT = "job-result",
  HEARTBEAT = "heartbeat",
  WORKER_READY = "worker-ready",
  WORKER_SHUTDOWN = "worker-shutdown",
}
```

### WorkerMessage Interface

```typescript
interface WorkerMessage {
  type: WorkerMessageType;
  payload?: any;
  workerId?: number;
  timestamp?: number;
}
```

### JobResultPayload Interface

```typescript
interface JobResultPayload {
  jobId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime?: number;
  retryCount?: number;
}
```

### ExecuteJobPayload Interface

```typescript
interface ExecuteJobPayload {
  jobId: string;
  jobFile: string;
  jobPayload: any;
  timeout?: number;
}
```

## WebSocketClient API

### Send Message

```typescript
client.send(message: WorkerMessage): void;
client.sendChannel(message: ChannelMessage): void;
```

### Event Listeners

```typescript
client.on(event: string, handler: (data: any) => void): void;

// Available events
client.on("open", () => {});
client.on("close", () => {});
client.on("error", (error) => {});
client.on("message", (data) => {});
client.on("job-completed", (result) => {});
```

## Orchestator Events

### Event Types

```typescript
"job-scheduled" // Job added to queue
"job-started" // Job claimed by worker
"job-completed" // Job finished (success or failure)
"worker-connected" // New worker connected
"worker-disconnected" // Worker disconnected
"worker-ready" // Worker ready for jobs
```

### Event Listener Registration

```typescript
orchestrator.on("job-completed", (job) => {
  console.log(`Job ${job.id} completed:`, job.success);
});

orchestrator.on("worker-connected", (workerId) => {
  console.log(`Worker ${workerId} connected`);
});
```

## Worker Events

### Event Types

```typescript
"job-received" // Job received from orchestrator
"job-started" // Job execution started
"job-completed" // Job execution finished
"error" // Error occurred
```

### Event Listener Registration

```typescript
worker.on("job-completed", (result) => {
  console.log("Job completed:", result);
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});
```

## Connection Management API

### getConnectedWorkerCount

Get number of connected workers:

```typescript
const count = server.getConnectedWorkerCount();
```

### Worker State

Orchestrator tracks worker availability:

- **Available**: Worker ready for jobs
- **Busy**: Worker currently processing job
- **Offline**: Worker disconnected

### Heartbeat API

Workers send periodic heartbeat to maintain connection:

```typescript
// Workers send heartbeat automatically
// Orchestrator monitors worker last seen time
// Workers with no heartbeat for 60 seconds marked as offline
```
