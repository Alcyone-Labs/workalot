# WebSocket Distributed Workers

Workalot supports distributed job processing through WebSocket communication between an orchestrator and multiple workers. This allows you to scale job processing across multiple machines or processes.

## Architecture

The distributed system consists of:

1. **Orchestrator** - Central coordinator that manages the job queue and distributes jobs to workers
2. **Workers** - Distributed processes that connect to the orchestrator and execute assigned jobs
3. **WebSocket Communication** - Real-time communication channel between orchestrator and workers

## Implementation

### Orchestrator

The orchestrator is responsible for:

- Managing the job queue (using any supported backend: SQLite, PGLite, PostgreSQL)
- Tracking connected workers and their status
- Distributing jobs to available workers
- Collecting job results and updating queue status

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

### Workers

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

## Custom Job Processing

Workers can implement custom job processing logic by extending `SimpleWorker` and overriding the `handleMessage` method:

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

## Event Handling

Both orchestrators and workers emit events for monitoring and logging:

### Orchestrator Events

```typescript
orchestrator.on("worker-connected", (workerId: number) => {
  console.log(`Worker ${workerId} connected`);
});

orchestrator.on("worker-disconnected", (workerId: number) => {
  console.log(`Worker ${workerId} disconnected`);
});

orchestrator.on("job-added", (jobId: string) => {
  console.log(`Job ${jobId} added to queue`);
});

orchestrator.on("job-assigned", (workerId: number, jobId: string) => {
  console.log(`Job ${jobId} assigned to worker ${workerId}`);
});

orchestrator.on("job-completed", (result: any) => {
  console.log(`Job completed:`, result);
});

orchestrator.on("job-failed", (result: any) => {
  console.log(`Job failed:`, result);
});
```

### Worker Events

```typescript
worker.on("ready", () => {
  console.log(`Worker is ready and connected to orchestrator`);
});

worker.on("job-completed", (result: any) => {
  console.log(`Job completed successfully:`, result);
});

worker.on("job-failed", (result: any) => {
  console.log(`Job failed:`, result);
});
```

## Running the System

1. Start the orchestrator first
2. Start multiple workers in separate processes/terminals
3. Add jobs to the orchestrator queue
4. Workers will automatically receive and process jobs
5. Results are sent back to the orchestrator

## Benefits

- **Scalability** - Add more workers to handle increased load
- **Fault Tolerance** - If a worker fails, jobs can be reassigned to other workers
- **Resource Efficiency** - Distribute processing across multiple machines
- **Real-time Communication** - WebSocket provides low-latency job distribution
- **Flexible Job Types** - Workers can handle different types of jobs based on custom logic

## Example Usage

See `examples/basic-distributed/` for a complete working example of a distributed job processing system.
