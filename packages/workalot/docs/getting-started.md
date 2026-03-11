# Getting Started

This guide will help you install Workalot and create your first job.

## Installation

```bash
pnpm add workalot
```

## Prerequisites

- Node.js 18+ or Bun 1.0+
- TypeScript 5.0+

## Basic Usage

### 1. Create a Job

Create a file at `jobs/PingJob.ts`:

```typescript
import { BaseJob } from "workalot";

export class PingJob extends BaseJob {
  constructor() {
    super("PingJob");
  }

  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ["message"]);

    return this.createSuccessResult({
      echo: payload.message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

### 2. Create the Main Entry Point

Create `app.ts`:

```typescript
import { TaskManager } from "workalot";

async function main() {
  const manager = new TaskManager({
    backend: "memory",
    maxThreads: 4,
  });

  await manager.initialize();
  console.log("TaskManager initialized");

  const result = await manager.scheduleAndWait({
    jobFile: "jobs/PingJob.ts",
    jobPayload: { message: "Hello Workalot!" },
  });

  console.log("Job result:", result.results);

  await manager.shutdown();
  console.log("Shutdown complete");
}

main().catch(console.error);
```

### 3. Run

```bash
bun run app.ts
```

Output:

```
TaskManager initialized
Job result: { echo: "Hello Workalot!", timestamp: "2024-01-15T10:30:00.000Z" }
Shutdown complete
```

## Using the Factory Pattern

For applications requiring multiple isolated queues:

```typescript
import { TaskManagerFactory } from "workalot";

async function factoryExample() {
  const factory = new TaskManagerFactory();

  const mainQueue = await factory.create("main", {
    backend: "sqlite",
    databaseUrl: "./data/main.db",
  });

  const priorityQueue = await factory.create("priority", {
    backend: "memory",
  });

  await mainQueue.scheduleAndWait({
    jobFile: "jobs/BackgroundJob.ts",
    jobPayload: { task: "cleanup" },
  });

  await factory.destroyAll();
}

factoryExample().catch(console.error);
```

## Configuration Presets

Workalot provides presets for common scenarios:

```typescript
import { TaskManagerFactoryPresets } from "workalot";

const development = TaskManagerFactoryPresets.development();
const testing = TaskManagerFactoryPresets.testing();
const productionSQLite = TaskManagerFactoryPresets.productionSQLite("./queue.db");
const highPerformance = TaskManagerFactoryPresets.highPerformance();
```

## Next Steps

- Learn about [storage backends](storage-backends.md) to choose the right persistence layer
- Explore [worker configuration](worker-configuration.md) to optimize performance
- Read the [job creation guide](job-creation-guide.md) to build complex jobs
