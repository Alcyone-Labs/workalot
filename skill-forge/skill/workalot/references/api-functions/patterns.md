# API Functions Patterns

## Factory Lifecycle Pattern

Complete lifecycle with proper cleanup:

```typescript
class JobProcessor {
  private manager: TaskManager;

  async initialize() {
    this.manager = await createTaskManager("processor", {
      backend: "sqlite",
      databaseUrl: "./processor.db",
    });
  }

  async shutdown() {
    // Wait for queue to drain
    await whenFreeWith(this.manager, async () => {
      await destroyTaskManager("processor");
      console.log("Processor shutdown complete");
    });
  }

  async processJob(jobRequest: JobRequest): Promise<JobResult> {
    return await scheduleAndWaitWith(this.manager, jobRequest);
  }
}
```

## Multi-Instance Pattern

Manage multiple TaskManager instances for different job types:

```typescript
import { createTaskManager, scheduleAndWaitWith, destroyTaskManager } from "#/index.js";

class MultiQueueService {
  private mainManager: TaskManager;
  private priorityManager: TaskManager;
  private backgroundManager: TaskManager;

  async initialize() {
    // Create separate instances
    this.mainManager = await createTaskManager("main", {
      backend: "sqlite",
      databaseUrl: "./main.db",
    });

    this.priorityManager = await createTaskManager("priority", {
      backend: "sqlite",
      databaseUrl: "./priority.db",
    });

    this.backgroundManager = await createTaskManager("background", {
      backend: "memory", // Faster for background tasks
    });
  }

  async processMainJob(job: JobRequest): Promise<JobResult> {
    return await scheduleAndWaitWith(this.mainManager, job);
  }

  async processPriorityJob(job: JobRequest): Promise<JobResult> {
    return await scheduleAndWaitWith(this.priorityManager, job);
  }

  async processBackgroundJob(job: JobRequest): Promise<JobResult> {
    return await scheduleAndWaitWith(this.backgroundManager, job);
  }

  async shutdownAll() {
    await Promise.all([
      destroyTaskManager("main"),
      destroyTaskManager("priority"),
      destroyTaskManager("background"),
    ]);
  }
}
```

## Retry Pattern with Factory

Retry failed jobs with exponential backoff:

```typescript
async function executeWithRetry(
  manager: TaskManager,
  jobRequest: JobRequest,
  maxRetries: number = 3,
): Promise<JobResult> {
  let lastResult: JobResult | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await scheduleAndWaitWith(manager, jobRequest);

    if (lastResult.success) {
      return lastResult;
    }

    console.warn(`Attempt ${attempt}/${maxRetries} failed:`, lastResult.error);

    if (attempt < maxRetries) {
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  return lastResult!;
}
```

## Batch Processing Pattern

Schedule multiple jobs efficiently:

```typescript
import { scheduleWith } from "#/index.js";

async function scheduleBatch(manager: TaskManager, jobs: JobRequest[]): Promise<string[]> {
  // Fire and forget for maximum throughput
  const jobIds = await Promise.all(jobs.map((job) => scheduleWith(manager, job)));

  return jobIds;
}

// Usage
const batch = Array.from({ length: 100 }, (_, i) => ({
  jobFile: "jobs/ProcessItem.ts",
  jobPayload: { itemId: i },
}));

const jobIds = await scheduleBatch(manager, batch);

console.log(`Scheduled ${jobIds.length} jobs`);
```

## Job Chain Pattern

Chain jobs where output of one job feeds into next:

```typescript
async function executeJobChain(manager: TaskManager): Promise<any> {
  // Step 1: Extract
  const step1 = await scheduleAndWaitWith(manager, {
    jobFile: "jobs/ExtractJob.ts",
    jobPayload: { url: "https://api.example.com/data" },
  });

  // Step 2: Transform (uses step1 output)
  const step2 = await scheduleAndWaitWith(manager, {
    jobFile: "jobs/TransformJob.ts",
    jobPayload: {
      data: step1.result,
      transformation: "normalize",
    },
  });

  // Step 3: Load (uses step2 output)
  const step3 = await scheduleAndWaitWith(manager, {
    jobFile: "jobs/LoadJob.ts",
    jobPayload: {
      data: step2.result,
      destination: "database",
    },
  });

  return {
    extract: step1,
    transform: step2,
    load: step3,
  };
}
```

## Monitoring Pattern

Continuous monitoring with factory pattern:

```typescript
class QueueMonitor {
  private manager: TaskManager;
  private interval?: NodeJS.Timeout;

  async initialize(manager: TaskManager) {
    this.manager = manager;

    // Monitor every 10 seconds
    this.interval = setInterval(async () => {
      await this.checkQueue();
    }, 10000);
  }

  private async checkQueue(): Promise<void> {
    const stats = await getQueueStatsWith(this.manager);

    console.log("Queue Status:");
    console.log(`  Total: ${stats.total}`);
    console.log(`  Pending: ${stats.pending}`);
    console.log(`  Processing: ${stats.processing}`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Failed: ${stats.failed}`);

    // Alert on issues
    if (stats.pending > 1000) {
      console.warn("⚠️  Queue buildup!");
      await this.sendAlert("Queue buildup detected");
    }

    if (stats.failed > 100) {
      console.error("❌ High failure rate!");
      await this.sendAlert("High failure rate");
    }
  }

  private async sendAlert(message: string): Promise<void> {
    // Send alert (Slack, email, PagerDuty, etc.)
    console.error("ALERT:", message);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}

// Usage
const monitor = new QueueMonitor();
const manager = await createTaskManager("main", { backend: "sqlite" });
await monitor.initialize(manager);
```

## Dynamic Backend Switching

Change backends at runtime based on conditions:

```typescript
async function createDynamicManager(): Promise<TaskManager> {
  const backend = process.env.DB_TYPE || "memory";

  const config = {
    maxThreads: 4,
    jobRecoveryEnabled: true,
  };

  if (backend === "sqlite") {
    return await createTaskManager("dynamic", {
      ...config,
      backend: "sqlite",
      databaseUrl: "./queue.db",
      sqliteConfig: { walMode: true },
    });
  } else if (backend === "postgresql") {
    return await createTaskManager("dynamic", {
      ...config,
      backend: "postgresql",
      databaseUrl: process.env.POSTGRES_URL!,
      postgresConfig: { poolSize: 20 },
    });
  } else {
    return await createTaskManager("dynamic", {
      ...config,
      backend: "memory",
    });
  }
}
```

## Environment-Aware Initialization

Configure based on NODE_ENV:

```typescript
import { createTaskManager, destroyTaskManager } from "#/index.js";

let manager: TaskManager;

async function initializeManager(): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  switch (env) {
    case "production":
      manager = await createTaskManager("prod", {
        backend: "postgresql",
        databaseUrl: process.env.DATABASE_URL!,
        maxThreads: undefined,
        silent: true,
        jobRecoveryEnabled: true,
      });
      break;

    case "testing":
      manager = await createTaskManager("test", {
        backend: "memory",
        maxThreads: 1,
        silent: true,
        jobRecoveryEnabled: false,
      });
      break;

    default: // development
      manager = await createTaskManager("dev", {
        backend: "memory",
        maxThreads: 2,
        silent: false,
        jobRecoveryEnabled: false,
      });
  }

  console.log(`Manager initialized for ${env} environment`);
}
```

## Graceful Shutdown Pattern

Ensure all jobs complete before shutdown:

```typescript
class Service {
  private manager: TaskManager;
  private shutdownRequested = false;

  async initialize() {
    this.manager = await createTaskManager("service", {
      backend: "sqlite",
      databaseUrl: "./service.db",
    });
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    // Stop accepting new jobs
    console.log("Shutdown requested, draining queue...");

    // Wait for queue to empty
    await whenFreeWith(this.manager, async () => {
      console.log("Queue drained, shutting down...");

      await destroyTaskManager("service");
      console.log("Shutdown complete");
    });
  }

  async processJob(job: JobRequest): Promise<void> {
    if (this.shutdownRequested) {
      throw new Error("Shutdown in progress, cannot accept new jobs");
    }

    await scheduleAndWaitWith(this.manager, job);
  }
}

// Handle signals
const service = new Service();
await service.initialize();

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM");
  await service.shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT");
  await service.shutdown();
  process.exit(0);
});
```

## Worker Pool Scaling Pattern

Scale workers based on queue load:

```typescript
class ScalingWorkerPool {
  private manager: TaskManager;
  private targetUtilization = 0.7;
  private checkInterval?: NodeJS.Timeout;

  async initialize(manager: TaskManager) {
    this.manager = manager;

    // Check every 30 seconds
    this.checkInterval = setInterval(async () => {
      await this.adjustWorkers();
    }, 30000);
  }

  private async adjustWorkers(): Promise<void> {
    const stats = await getQueueStatsWith(this.manager);
    const currentWorkers = stats.processing;
    const pending = stats.pending;

    // Calculate desired workers
    let desiredWorkers: number;

    if (pending > 100) {
      // Scale up
      desiredWorkers = Math.min(16, Math.ceil(pending / 10));
    } else if (currentWorkers > 4 && pending < 10) {
      // Scale down
      desiredWorkers = Math.max(2, Math.ceil(pending / 10));
    } else {
      // Maintain
      desiredWorkers = currentWorkers;
    }

    if (desiredWorkers !== currentWorkers) {
      console.log(`Adjusting workers: ${currentWorkers} → ${desiredWorkers}`);

      // Would need to recreate manager with new maxThreads
      // In current implementation, monitor and restart
    }
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
```
