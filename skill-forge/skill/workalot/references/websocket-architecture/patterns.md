# WebSocket Architecture Patterns

## Basic Orchestrator Setup

Simple WebSocket server for distributed job processing:

```typescript
import { SimpleOrchestrator } from "#/index.js";

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  distributionStrategy: "round-robin",
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./queue.db",
  },
});

// Start orchestrator
await orchestrator.start();

// Add job
const jobId = await orchestrator.addJob({
  id: "job-1",
  type: "ProcessData",
  payload: { data: [1, 2, 3] },
});

console.log("Job scheduled:", jobId);

// Shutdown
await orchestrator.shutdown();
```

## Worker Pool Pattern

Multiple workers connecting to same orchestrator:

```typescript
import { SimpleWorker } from "#/index.js";

const workers: SimpleWorker[] = [];
const numWorkers = 4;

for (let i = 1; i <= numWorkers; i++) {
  const worker = new SimpleWorker({
    workerId: i,
    wsUrl: "ws://localhost:8080/worker",
    projectRoot: process.cwd(),
  });

  await worker.start();
  workers.push(worker);
}

// Graceful shutdown
async function shutdownWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.shutdown()));
}
```

## Dynamic Worker Scaling

Add/remove workers based on queue load:

```typescript
class WorkerPool {
  private workers: SimpleWorker[] = [];
  private orchestrator: SimpleOrchestrator;

  constructor(orchestrator: SimpleOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async scaleUp(targetCount: number): Promise<void> {
    while (this.workers.length < targetCount) {
      const worker = new SimpleWorker({
        workerId: this.workers.length + 1,
        wsUrl: "ws://localhost:8080/worker",
        projectRoot: process.cwd(),
      });

      await worker.start();
      this.workers.push(worker);
    }
  }

  async scaleDown(targetCount: number): Promise<void> {
    const toRemove = this.workers.length - targetCount;

    for (let i = 0; i < toRemove; i++) {
      const worker = this.workers.pop();
      await worker.shutdown();
    }
  }
}

// Usage
const pool = new WorkerPool(orchestrator);

// Scale based on queue depth
setInterval(async () => {
  const stats = await getQueueStats();

  if (stats.pending > 100 && pool.workers.length < 8) {
    await pool.scaleUp(8);
  } else if (stats.pending < 10 && pool.workers.length > 4) {
    await pool.scaleDown(4);
  }
}, 30000); // Check every 30 seconds
```

## Job Result Aggregation

Collect results from multiple workers:

```typescript
class ResultCollector {
  private results: Map<string, any> = new Map();

  async runBatch(jobRequests: JobRequest[]): Promise<any[]> {
    // Schedule all jobs
    const jobIds = await Promise.all(jobRequests.map((req) => scheduleWith(manager, req)));

    // Wait for all results with event listeners
    const results = await this.waitForResults(jobIds);

    return Array.from(this.results.values());
  }

  private async waitForResults(jobIds: string[]): Promise<any[]> {
    return new Promise((resolve) => {
      let completed = 0;

      const checkComplete = () => {
        if (completed === jobIds.length) {
          resolve(Array.from(this.results.values()));
        }
      };

      // Listen for job completion events
      orchestrator.on("job-completed", (job) => {
        this.results.set(job.id, job);
        completed++;
        checkComplete();
      });
    });
  }
}
```

## Workflow Channel Pattern

Coordinate multi-step workflows with channels:

```typescript
// Workflow orchestrator
class WorkflowOrchestrator {
  async executeWorkflow(steps: WorkflowStep[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Schedule step job
      await scheduleAndWaitWith(manager, {
        jobFile: step.jobFile,
        jobPayload: {
          workflowId: step.workflowId,
          stepNumber: i + 1,
          data: step.data,
        },
      });

      // Wait for step completion via channel
      const stepComplete = await this.waitForChannelEvent(
        `workflow/${step.workflowId}/step/${i + 1}/complete`,
      );

      console.log(`Step ${i + 1} completed:`, stepComplete);
    }
  }

  private async waitForChannelEvent(event: string): Promise<any> {
    return new Promise((resolve) => {
      orchestrator.once(event, resolve);
    });
  }
}

// Usage
const workflow = [
  {
    workflowId: "wf-123",
    stepName: "extract",
    jobFile: "jobs/Extract.ts",
    data: { url: "https://..." },
  },
  { workflowId: "wf-123", stepName: "transform", jobFile: "jobs/Transform.ts", data: {} },
  { workflowId: "wf-123", stepName: "load", jobFile: "jobs/Load.ts", data: {} },
];

await executeWorkflow(workflow);
```

## Worker Health Check Pattern

Workers report status, orchestrator monitors health:

```typescript
class HealthyWorker extends SimpleWorker {
  protected async handleMessage(message: WorkerMessage): Promise<void> {
    if (message.type === WorkerMessageType.HEARTBEAT_REQUEST) {
      // Send health status
      this.wsClient.send({
        type: WorkerMessageType.HEARTBEAT_RESPONSE,
        payload: {
          workerId: this.workerId,
          status: "healthy",
          jobsProcessed: this.jobsProcessed,
          jobsFailed: this.jobsFailed,
          lastError: this.lastError,
        },
      });
    } else {
      await super.handleMessage(message);
    }
  }
}
```

## Load Balancing Pattern

Custom worker selection based on job type:

```typescript
class SmartOrchestrator extends SimpleOrchestrator {
  async addJob(job: JobRequest): Promise<string> {
    // Analyze job characteristics
    const jobType = this.classifyJob(job);

    // Select appropriate worker
    const workerId = this.selectWorker(jobType);

    // Send to specific worker (override default round-robin)
    this.sendToWorker(workerId, {
      type: WorkerMessageType.EXECUTE_JOB,
      payload: job,
    });

    return job.id || "custom-id";
  }

  private classifyJob(job: JobRequest): "cpu-intense" | "io-bound" | "network" {
    // Analyze job file or payload to determine type
    return "cpu-intense"; // Simplified
  }

  private selectWorker(jobType: string): number {
    // Return worker ID best suited for job type
    return 1; // Simplified
  }
}
```

## Reconnection Pattern

Robust worker reconnection with exponential backoff:

```typescript
class ResilientWorker extends SimpleWorker {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  protected override async start(): Promise<void> {
    return this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        await super.start();
        this.reconnectAttempts = 0;
        return; // Connected successfully
      } catch (error) {
        this.reconnectAttempts++;
        const delay = 1000 * Math.pow(2, this.reconnectAttempts - 1);

        console.warn(`Connection attempt ${this.reconnectAttempts} failed, retrying in ${delay}ms`);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.error("Max reconnection attempts reached, giving up");
    throw new Error("Failed to connect after 10 attempts");
  }
}
```

## Message Batching Pattern

Batch multiple jobs in single WebSocket message:

```typescript
// Orchestrator batches jobs for efficiency
class BatchingOrchestrator extends SimpleOrchestrator {
  private jobBuffer: JobRequest[] = [];
  private readonly BATCH_SIZE = 10;
  private batchInterval?: NodeJS.Timeout;

  async start(): Promise<void> {
    await super.start();

    // Start batch interval (100ms)
    this.batchInterval = setInterval(() => {
      if (this.jobBuffer.length >= this.BATCH_SIZE) {
        this.flushBatch();
      }
    }, 100);
  }

  private flushBatch(): void {
    if (this.jobBuffer.length === 0) return;

    const batch = this.jobBuffer.splice(0, this.BATCH_SIZE);

    // Send batch to next available worker
    const workerId = this.getNextWorker();

    this.sendToWorker(workerId, {
      type: WorkerMessageType.BATCH_EXECUTE_JOB,
      payload: {
        jobs: batch,
        count: batch.length,
      },
    });
  }

  private getNextWorker(): number {
    // Find available worker (round-robin)
    return 1; // Simplified
  }
}
```

## Worker Pool Load Balancing

Distribute jobs based on worker capacity:

```typescript
class CapacityAwareOrchestrator extends SimpleOrchestrator {
  private workerCapacity: Map<number, number> = new Map();

  constructor() {
    super();
    // Initialize worker capacity (jobs per minute)
    this.workerCapacity.set(1, 30); // Worker 1: 30 jobs/min
    this.workerCapacity.set(2, 25); // Worker 2: 25 jobs/min
    this.workerCapacity.set(3, 20); // Worker 3: 20 jobs/min
    this.workerCapacity.set(4, 15); // Worker 4: 15 jobs/min
  }

  private getLeastLoadedWorker(): number {
    let leastLoaded = -1;
    let lowestLoad = Infinity;

    for (const [workerId, load] of this.workerCapacity) {
      if (load < lowestLoad) {
        lowestLoad = load;
        leastLoaded = workerId;
      }
    }

    return leastLoaded;
  }
}
```

## Dead Letter Queue Pattern

Route failed jobs to dead letter queue:

```typescript
class DeadLetterHandler {
  async handleFailedJob(job: FailedJob): Promise<void> {
    // Log to dead letter storage
    await this.saveToDeadLetterQueue(job);

    // Attempt retry if retry count < threshold
    if (job.retryCount < 3) {
      console.log(`Retrying job ${job.jobId}, attempt ${job.retryCount + 1}`);

      await scheduleAndWaitWith(manager, {
        jobFile: job.jobFile,
        jobPayload: job.payload,
        // Increment retry count
        retryCount: job.retryCount + 1,
      });
    } else {
      // Max retries exceeded, escalate
      await this.escalateFailure(job);
    }
  }

  private async saveToDeadLetterQueue(job: FailedJob): Promise<void> {
    // Save to database, file system, or external service
    console.error("Dead letter:", job);
  }

  private async escalateFailure(job: FailedJob): Promise<void> {
    // Send alert to monitoring system
    console.error("Escalating failure:", job);

    // Slack, PagerDuty, email, etc.
    await sendAlert(job);
  }
}
```
