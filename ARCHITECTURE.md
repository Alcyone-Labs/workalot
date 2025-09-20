# Workalot Extensible Architecture

## Overview

Workalot has been redesigned from a standalone distributed job queue into a flexible framework for building custom task orchestration systems. This new architecture provides powerful base classes and components that you can extend to create sophisticated workflow engines, specialized processing systems, and distributed task orchestrators tailored to your specific needs.

## Key Architectural Changes

### 1. From Fixed to Extensible

**Before**: Workalot ran as an independent system where you could schedule jobs but had limited control over orchestration and worker behavior.

**Now**: Workalot provides extensible base classes (`BaseOrchestrator` and `BaseWorker`) that you can customize to implement complex orchestration logic, workflow scheduling, and specialized worker behaviors.

### 2. From PostMessage to WebSockets

**Before**: Inter-thread communication used a brittle postMessage system with no recovery mechanisms.

**Now**: A robust WebSocket server (using Elysia.js) acts as a central communication hub with:
- Message acknowledgment and recovery
- Automatic reconnection
- Custom message routing
- PING/PONG heartbeat mechanism
- Message queuing during disconnections

### 3. From Simple Queue to Production-Ready PostgreSQL

**Before**: PostgreSQL queue was just a stub.

**Now**: Full PostgreSQL implementation with:
- `SELECT ... FOR UPDATE SKIP LOCKED` for atomic job fetching
- LISTEN/NOTIFY for real-time updates
- Comprehensive indexing for performance
- Transaction-based updates
- Batch operations support

## Core Components

### BaseOrchestrator

The `BaseOrchestrator` class provides the foundation for building custom orchestrators:

```typescript
import { BaseOrchestrator } from '@alcyone-labs/workalot';

class MyOrchestrator extends BaseOrchestrator {
  // Lifecycle hooks
  protected async onStart(): Promise<void> {
    // Initialize custom resources
  }

  protected async onStop(): Promise<void> {
    // Cleanup resources
  }

  // Job lifecycle hooks
  protected async beforeJobSchedule(jobPayload: JobPayload): Promise<JobPayload> {
    // Validate or transform job payload
    return jobPayload;
  }

  protected async onJobCompleted(jobId: string, result: JobResult, workerId: number): Promise<void> {
    // Handle job completion (e.g., trigger next workflow step)
  }

  protected async onJobFailed(jobId: string, error: Error, workerId: number): Promise<void> {
    // Handle job failure (e.g., retry logic)
  }

  // Custom worker selection
  protected async selectWorker(context: JobDistributionContext): Promise<WorkerState | null> {
    // Implement custom worker selection logic
    // e.g., based on worker specialization, load, affinity rules
  }

  // Worker lifecycle
  protected onWorkerRegistered(workerId: number, state: WorkerState): void {
    // Handle new worker registration
  }

  protected onWorkerUnregistered(workerId: number, state: WorkerState): void {
    // Handle worker disconnection
  }
}
```

#### Key Features

- **Workflow Support**: Built-in workflow engine with dependency management
- **Custom Message Routing**: Register custom WebSocket message handlers
- **Flexible Distribution**: Implement custom job distribution strategies
- **Event-Driven**: Rich event system for monitoring and integration

### BaseWorker

The `BaseWorker` class enables custom worker behaviors:

```typescript
import { BaseWorker } from '@alcyone-labs/workalot';

class MySpecializedWorker extends BaseWorker {
  // Initialization hooks
  protected async onBeforeInitialize(): Promise<void> {
    // Setup custom resources
  }

  protected async onAfterInitialize(): Promise<void> {
    // Post-initialization setup
  }

  // Job execution hooks
  protected async beforeJobExecution(job: BatchJobContext): Promise<boolean> {
    // Return false to skip this job
    return true;
  }

  protected async onExecuteJob(job: BatchJobContext): Promise<any> {
    // Custom job execution logic
    // Can override default JobExecutor behavior
  }

  protected async afterJobExecution(job: BatchJobContext, result: any, processingTime: number): Promise<void> {
    // Post-execution tasks (metrics, cleanup, etc.)
  }

  // Queue management
  protected async beforeQueueFill(jobs: BatchJobContext[]): Promise<BatchJobContext[]> {
    // Filter or reorder jobs before adding to queue
    return jobs;
  }

  // Custom message handling
  protected async onCustomMessage(message: WorkerMessage): Promise<void> {
    // Handle custom messages from orchestrator
  }

  // Connection events
  protected onConnected(): void {
    // Handle connection to orchestrator
  }

  protected onDisconnected(): void {
    // Handle disconnection
  }
}
```

#### Key Features

- **Job Specialization**: Workers can declare specializations for specific job types
- **Custom Processing**: Override job execution with custom logic
- **Local Queue Management**: Control how jobs are queued and processed
- **Caching Support**: Implement job result caching
- **Metrics Collection**: Built-in support for custom metrics

### WebSocket Communication

The new WebSocket layer provides reliable, extensible communication:

```typescript
// WebSocket Server (used by orchestrator)
const wsServer = new WebSocketServer({
  port: 8080,
  hostname: 'localhost',
  messageTimeout: 5000,
  maxRetries: 3,
  pingInterval: 30000,
  enableMessageRecovery: true,
  enableHeartbeat: true
});

// Register custom message routes
wsServer.registerRoute({
  pattern: 'CUSTOM_MESSAGE',
  handler: async (connection, message) => {
    // Handle custom message
  },
  priority: 100
});

// WebSocket Client (used by workers)
const wsClient = new WebSocketClient({
  url: 'ws://localhost:8080/worker',
  workerId: 1,
  reconnectInterval: 5000,
  maxReconnectAttempts: Infinity,
  enableAutoReconnect: true
});
```

#### Features

- **Automatic Reconnection**: Workers automatically reconnect on disconnection
- **Message Recovery**: Failed messages are retried with exponential backoff
- **Custom Routing**: Register handlers for custom message types
- **Connection Management**: Track worker connections and health
- **Message Queuing**: Messages are queued when disconnected

### PostgreSQL Queue

Production-ready PostgreSQL queue implementation:

```typescript
const queue = new PostgreSQLQueue({
  host: 'localhost',
  port: 5432,
  database: 'workalot',
  user: 'postgres',
  password: 'password',
  enableNotifications: true,
  tableName: 'jobs',
  retentionDays: 30
});

// Subscribe to real-time notifications
queue.onJobUpdate((event) => {
  console.log('Job update:', event);
});

// Atomic job fetching with row-level locking
const job = await queue.getNextPendingJob(); // Uses FOR UPDATE SKIP LOCKED

// Batch operations
const jobIds = await queue.batchAddJobs([
  { payload: jobPayload1 },
  { payload: jobPayload2 }
]);

// Job recovery
const recovered = await queue.recoverStalledJobs(300000); // 5 minutes
```

#### Features

- **LISTEN/NOTIFY**: Real-time job status notifications
- **Row-Level Locking**: `FOR UPDATE SKIP LOCKED` for concurrent access
- **Optimized Indexes**: Performance-tuned for high throughput
- **Batch Operations**: Efficient bulk job operations
- **Automatic Cleanup**: Configurable retention policies

## Building Custom Solutions

### Example 1: Workflow Orchestrator

```typescript
class WorkflowOrchestrator extends BaseOrchestrator {
  private workflows = new Map<string, WorkflowDefinition>();

  protected async onJobCompleted(jobId: string, result: JobResult, workerId: number) {
    // Check if job is part of a workflow
    if (result.__workflow) {
      const { workflowId, stepId } = result.__workflow;

      // Mark step as complete
      const workflow = this.workflows.get(workflowId);
      workflow.completedSteps.add(stepId);

      // Schedule dependent steps
      for (const [nextStepId, step] of workflow.steps) {
        if (this.areDependenciesMet(workflow, step)) {
          await this.scheduleJob(step.jobPayload);
        }
      }

      // Check if workflow is complete
      if (workflow.completedSteps.size === workflow.steps.size) {
        this.emit('workflow-completed', workflowId);
      }
    }
  }

  async startWorkflow(definition: WorkflowDefinition) {
    this.workflows.set(definition.id, definition);

    // Schedule initial steps (no dependencies)
    for (const [stepId, step] of definition.steps) {
      if (!step.dependencies || step.dependencies.length === 0) {
        await this.scheduleJob(step.jobPayload);
      }
    }
  }
}
```

### Example 2: Specialized Worker Pool

```typescript
class MLWorker extends BaseWorker {
  private model: any;
  private cache = new Map<string, any>();

  protected async onBeforeInitialize() {
    // Load ML model
    this.model = await loadModel('sentiment-analysis');

    // Register specializations
    await this.sendMessage({
      type: 'UPDATE_SPECIALIZATIONS',
      payload: {
        workerId: this.config.workerId,
        specializations: ['MLInferenceJob', 'ModelTrainingJob']
      }
    });
  }

  protected async onExecuteJob(job: BatchJobContext) {
    const jobType = this.extractJobType(job);

    if (jobType === 'MLInferenceJob') {
      // Check cache
      const cacheKey = this.getCacheKey(job);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // Run inference
      const result = await this.model.predict(job.jobPayload.jobPayload.input);

      // Cache result
      this.cache.set(cacheKey, result);

      return result;
    }

    // Fall back to default execution
    return super.onExecuteJob(job);
  }

  protected async beforeJobExecution(job: BatchJobContext): Promise<boolean> {
    // Only accept ML jobs when GPU is available
    const jobType = this.extractJobType(job);
    if (jobType.startsWith('ML') && !this.isGPUAvailable()) {
      return false; // Skip this job
    }
    return true;
  }
}
```

### Example 3: Priority-Based Distribution

```typescript
class PriorityOrchestrator extends BaseOrchestrator {
  protected async selectWorker(context: JobDistributionContext): Promise<WorkerState | null> {
    const { job, availableWorkers } = context;
    const priority = job.jobPayload.jobPayload?.priority || 0;

    if (priority > 90) {
      // High priority: select least loaded worker
      return availableWorkers.reduce((min, worker) =>
        worker.status.pendingJobs < min.status.pendingJobs ? worker : min
      );
    } else if (priority > 50) {
      // Medium priority: consider specialization
      const jobType = this.extractJobType(job);
      const specialized = availableWorkers.filter(w =>
        w.customMetadata?.specializations?.includes(jobType)
      );

      if (specialized.length > 0) {
        return specialized[0];
      }
    }

    // Low priority: round-robin or random
    return availableWorkers[Math.floor(Math.random() * availableWorkers.length)];
  }
}
```

## Migration Guide

### From Current Workalot to Extensible Architecture

1. **Update Dependencies**
   ```bash
   npm install @alcyone-labs/workalot@latest
   ```

2. **Replace QueueOrchestrator with BaseOrchestrator**
   ```typescript
   // Before
   const orchestrator = new QueueOrchestrator(config);

   // After
   class MyOrchestrator extends BaseOrchestrator {
     // Add custom logic
   }
   const orchestrator = new MyOrchestrator(config);
   ```

3. **Update Worker Creation**
   ```typescript
   // Before - Workers created internally
   const manager = new WorkerManager(config);

   // After - Create custom workers
   class MyWorker extends BaseWorker {
     // Add custom behavior
   }
   const worker = new MyWorker(config);
   await worker.initialize();
   ```

4. **Switch to WebSocket Communication**
   - Workers automatically connect via WebSocket
   - No changes needed for basic usage
   - Custom messages can be added via `registerRoute()`

5. **Upgrade to PostgreSQL Queue**
   ```typescript
   const queue = new PostgreSQLQueue({
     connectionString: 'postgresql://user:pass@localhost/db',
     enableNotifications: true
   });
   ```

## Best Practices

1. **Worker Specialization**
   - Use specializations for job-type affinity
   - Implement caching for expensive operations
   - Monitor worker performance metrics

2. **Orchestration Patterns**
   - Implement retry logic in `onJobFailed()`
   - Use workflow definitions for complex pipelines
   - Add custom message routes for control plane

3. **Queue Management**
   - Enable PostgreSQL notifications for real-time updates
   - Use batch operations for bulk job scheduling
   - Implement job recovery for reliability

4. **Performance Optimization**
   - Tune worker queue sizes based on job complexity
   - Use priority-based distribution for SLA management
   - Implement job result caching where appropriate

5. **Monitoring & Observability**
   - Listen to orchestrator and worker events
   - Collect custom metrics in workers
   - Use WebSocket health endpoints

## Conclusion

The new Workalot architecture transforms it from a simple job queue into a powerful framework for building custom task orchestration systems. By extending the base classes and leveraging the robust communication and queue layers, you can build sophisticated distributed processing systems tailored to your specific requirements.
