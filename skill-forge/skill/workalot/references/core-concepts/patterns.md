# Core Concepts Patterns

## Factory Pattern Implementation

Complete factory pattern for isolated test environments and production deployments:

```typescript
import {
  createTaskManager,
  scheduleAndWaitWith,
  destroyTaskManager,
  whenFreeWith,
  getQueueStatsWith,
} from "#/index.js";

class JobProcessor {
  private manager: TaskManager;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    this.manager = await createTaskManager("processor", {
      backend: "sqlite",
      databaseUrl: "./processor.db",
      maxThreads: 4,
      jobRecoveryEnabled: true,
    });
  }

  async processJob(jobFile: string, payload: any) {
    const result = await scheduleAndWaitWith(this.manager, {
      jobFile,
      jobPayload: payload,
      jobTimeout: 30000,
    });
    return result;
  }

  async processBatch(jobs: Array<{ file: string; payload: any }>) {
    const promises = jobs.map(job =>
      scheduleAndWaitWith(this.manager, {
        jobFile: job.file,
        jobPayload: job.payload,
      })
    );
    return Promise.all(promises);
  }

  async monitorQueue() {
    const stats = await getQueueStatsWith(this.manager);
    console.log(`Pending: ${stats.pending}, Processing: ${stats.processing}`);
  }

  async waitForCompletion(callback: () => void) {
    return whenFreeWith(this.manager, callback);
  }

  async shutdown() {
    await destroyTaskManager("processor");
  }
}
```

## Multi-Instance Pattern

Run multiple isolated TaskManager instances:

```typescript
import { createTaskManager, destroyTaskManager } from "#/index.js";

const priorityManager = await createTaskManager("priority", {
  backend: "sqlite",
  databaseUrl: "./priority.db",
});

const backgroundManager = await createTaskManager("background", {
  backend: "sqlite",
  databaseUrl: "./background.db",
});

// Use appropriate manager based on job type
async function routeJob(job: JobRequest) {
  if (job.priority === "high") {
    return scheduleAndWaitWith(priorityManager, job);
  } else {
    return scheduleAndWaitWith(backgroundManager, job);
  }
}

// Cleanup both
await Promise.all([
  destroyTaskManager("priority"),
  destroyTaskManager("background"),
]);
```

## Progressive Complexity Pattern

Start simple, add features as needed:

```typescript
// Level 1: Basic singleton
import { scheduleAndWait } from "#/index.js";
const result = await scheduleAndWait({ jobFile: "jobs/Job.ts", jobPayload: {} });

// Level 2: Add factory
import { createTaskManager, scheduleAndWaitWith } from "#/index.js";
const manager = await createTaskManager("main", { backend: "memory" });
const result = await scheduleAndWaitWith(manager, { /* job */ });

// Level 3: Add persistence
const manager = await createTaskManager("main", {
  backend: "sqlite",
  databaseUrl: "./queue.db",
});

// Level 4: Add distributed workers
const manager = await createTaskManager("main", { backend: "postgresql" });
// Separate orchestrator process
const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: { backend: "postgresql" },
});
await orchestrator.start();

// Level 5: Add channel routing
server.registerChannelRoute({
  type: "workflow",
  subChannel: "step-complete",
  handler: (connection, message) => { /* handle */ },
});
```

## Graceful Shutdown Pattern

Ensure all resources cleaned up properly:

```typescript
class Service {
  private manager: TaskManager;

  async start() {
    this.manager = await createTaskManager("service", {
      backend: "sqlite",
      databaseUrl: "./service.db",
    });
  }

  async stop() {
    // Stop accepting new jobs
    // Wait for processing jobs to complete
    await whenFreeWith(this.manager, async () => {
      await destroyTaskManager("service");
      console.log("Service stopped gracefully");
    });
  }
}

// Handle process signals
const service = new Service();
await service.start();

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down...");
  await service.stop();
  process.exit(0);
});
```

## Environment-Specific Configuration Pattern

```typescript
function getConfig(): QueueConfig {
  const env = process.env.NODE_ENV || "development";

  switch (env) {
    case "development":
      return {
        backend: "memory",
        maxThreads: 2,
        silent: false,
        jobRecoveryEnabled: false,
      };

    case "testing":
      return {
        backend: "memory",
        maxThreads: 1,
        silent: true,
        jobRecoveryEnabled: false,
      };

    case "production":
      return {
        backend: process.env.DB_TYPE || "sqlite",
        databaseUrl: process.env.DATABASE_URL || "./queue.db",
        maxThreads: undefined, // System default
        silent: true,
        jobRecoveryEnabled: true,
        // Add backend-specific config
        ...(process.env.DB_TYPE === "postgresql" && {
          postgresConfig: {
            poolSize: 20,
            enableListen: true,
          },
        }),
      };

    default:
      throw new Error(`Unknown environment: ${env}`);
  }
}

const manager = await createTaskManager("prod", getConfig());
```
