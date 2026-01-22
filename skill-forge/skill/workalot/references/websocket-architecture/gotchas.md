# WebSocket Architecture Gotchas

## Common Pitfalls

### Not Using Factory Pattern for Distributed Workers

**Problem**: Using singleton with SimpleOrchestrator causes state issues.

**Symptoms**: Jobs don't execute properly, workers confused about queue

**Fix**:

```typescript
// BAD - Singleton with distributed workers
await initializeTaskManager({ backend: "sqlite" });

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: { backend: "sqlite" }, // Different queue!
});

// GOOD - Use factory for orchestrator too
const factory = new TaskManagerFactory({ backend: "sqlite" });

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: factory.config, // Same config!
});
```

### Worker ID Collisions

**Problem**: Multiple workers use same workerId cause conflicts.

**Symptoms**: Jobs assigned to wrong worker, inconsistent behavior

**Fix**:

```typescript
// BAD - Duplicate worker IDs
const worker1 = new SimpleWorker({ workerId: 1 /* ... */ });
const worker2 = new SimpleWorker({ workerId: 1 /* ... */ }); // Collision!

// GOOD - Unique worker IDs
const workers = [];
for (let i = 0; i < numWorkers; i++) {
  workers.push(new SimpleWorker({ workerId: i + 1 /* ... */ }));
}

// Or use container/hostname-based IDs
const workerId = process.env.WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
```

### Blocking Worker Thread with Long-Running Jobs

**Problem**: Single long-running job blocks worker from processing other jobs.

**Symptoms**: Queue backlog grows, throughput degrades, workers appear stuck

**Fix**:

```typescript
// BAD - Blocking job
export default class BlockingJob extends BaseJob {
  async run(payload: any): Promise<any> {
    while (true) {
      // Infinite loop
      // Process forever - never yields!
    }
  }
}

// GOOD - Yield control periodically
export default class NonBlockingJob extends BaseJob {
  private readonly YIELD_INTERVAL = 100; // 100ms

  async run(payload: { count: number }): Promise<any> {
    for (let i = 0; i < payload.count; i++) {
      await this.processItem(i);

      // Yield to worker thread
      if (i % 10 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return this.success({ processed: payload.count });
  }
}
```

### Not Implementing Custom Worker Logic

**Problem**: Jobs use custom logic but SimpleWorker doesn't support it.

**Symptoms**: Custom job processing doesn't execute, errors

**Fix**:

```typescript
// BAD - Using SimpleWorker directly
const worker = new SimpleWorker({
  /* ... */
});
// Can't add custom message handling!

// GOOD - Extend SimpleWorker
class CustomWorker extends SimpleWorker {
  protected async handleMessage(message: WorkerMessage): Promise<void> {
    if (message.type === WorkerMessageType.EXECUTE_JOB) {
      // Custom job execution logic
      await this.executeCustomJob(message.payload);
    } else {
      await super.handleMessage(message);
    }
  }

  private async executeCustomJob(payload: any): Promise<void> {
    // Custom processing logic
  }
}

const worker = new CustomWorker({
  /* ... */
});
```

### Ignoring WebSocket Connection Events

**Problem**: Not handling connection loss, errors, reconnection.

**Symptoms**: Workers stop receiving jobs silently, orchestrator thinks workers are online

**Fix**:

```typescript
// BAD - No error handling
const worker = new SimpleWorker({
  /* ... */
});

await worker.start(); // If connection fails, throws!

// GOOD - Handle connection lifecycle
class RobustWorker extends SimpleWorker {
  private reconnectAttempts = 0;

  protected async start(): Promise<void> {
    while (this.reconnectAttempts < 10) {
      try {
        await super.start();
        this.reconnectAttempts = 0;
        return; // Connected successfully
      } catch (error) {
        this.reconnectAttempts++;
        const delay = 1000 * Math.pow(2, this.reconnectAttempts);

        console.warn(`Connection failed, retrying in ${delay}ms`, error);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.error("Failed to connect after 10 attempts");
    throw new Error("Connection failed");
  }
}
```

### Channel Route Conflicts

**Problem**: Multiple handlers registered for same channel pattern cause conflicts.

**Symptoms**: Unpredictable routing, some messages not handled

**Fix**:

```typescript
// BAD - Duplicate channel routes
server.registerChannelRoute({
  handler: (connection, message) => {
    /* handler 1 */
  },
});

server.registerChannelRoute({
  handler: (connection, message) => {
    /* handler 2 */
  }, // Conflicts!
});

// GOOD - Single handler with channel switching
server.registerChannelRoute({
  handler: (connection, message) => {
    switch (message.subChannel) {
      case "step-1":
        this.handleStep1(message);
        break;
      case "step-2":
        this.handleStep2(message);
        break;
      case "step-3":
        this.handleStep3(message);
        break;
    }
  },
});
```

### Not Sending Job Results

**Problem**: Jobs execute but results never sent back to orchestrator.

**Symptoms**: Jobs hang forever, marked as processing, queue stalls

**Fix**:

```typescript
// BAD - Forgets to send result
export default class SilentJob extends BaseJob {
  async run(payload: any): Promise<any> {
    const result = await process(payload);
    // Result never sent back!
    return this.success({ result });
  }
}

// GOOD - Send result explicitly
export default class ResponsiveJob extends BaseJob {
  async run(payload: any, context?: JobExecutionContext): Promise<any> {
    const result = await process(payload);

    // Send result via WebSocket client
    // SimpleWorker does this automatically
    return this.success({ result });
  }
}
```

### Orchestrator Not Tracking Worker State

**Problem**: Orchestrator sends jobs to offline or busy workers.

**Symptoms**: Jobs timeout, workers marked as processing but not receiving messages

**Fix**:

```typescript
// BAD - Doesn't check worker state
class NaiveOrchestrator extends SimpleOrchestrator {
  async addJob(job: JobRequest): Promise<string> {
    // Sends to any worker without checking availability!
    return scheduleWith(this.manager, job);
  }
}

// GOOD - Check worker availability first
class SmartOrchestrator extends SimpleOrchestrator {
  private workerStatus: Map<number, "idle" | "busy"> = new Map();

  async addJob(job: JobRequest): Promise<string> {
    const availableWorker = this.getAvailableWorker();

    if (!availableWorker) {
      throw new Error("No available workers");
    }

    this.workerStatus.set(availableWorker, "busy");
    return this.sendToWorker(availableWorker, {
      type: WorkerMessageType.EXECUTE_JOB,
      payload: job,
    });
  }

  private getAvailableWorker(): number | undefined {
    for (const [workerId, status] of this.workerStatus) {
      if (status === "idle") {
        return workerId;
      }
    }
    return undefined;
  }
}
```

### Worker Timeout Handling Issues

**Problem**: Jobs timeout but worker doesn't handle gracefully, causes resource leaks.

**Symptoms**: Worker processes partial data, state corrupted, next job fails

**Fix**:

```typescript
// BAD - Ignores timeout
export default class TimeoutJob extends BaseJob {
  async run(payload: any): Promise<any> {
    // Job may timeout, but worker keeps processing!
    const result = await slowOperation(payload);
    return this.success({ result });
  }
}

// GOOD - Handle timeout cleanup
export default class CleanTimeoutJob extends BaseJob {
  private cleanup: Array<() => void> = [];

  async run(payload: any, context?: JobExecutionContext): Promise<any> {
    // Register cleanup function
    if (context) {
      context.cleanup = () => this.performCleanup();
    }

    try {
      const result = await this.withTimeout(
        () => slowOperation(payload),
        context?.jobTimeout || 30000
      );

      return this.success({ result });
    } catch (error) {
      // Cleanup on error
      this.performCleanup();
      return this.error(`Job failed: ${error}`);
    }
  }

  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout)
      ]);
    });
  }

  private performCleanup(): void {
    while (this.cleanup.length > 0) {
      const fn = this.cleanup.pop();
      fn();
    }
  }
}
```

### Not Implementing Heartbeat

**Problem**: Orchestrator marks workers as offline when connection is fine.

**Symptoms**: Workers disconnected unnecessarily, jobs fail with "worker offline"

**Fix**:

```typescript
// BAD - No heartbeat mechanism
// Worker gets marked offline after 60 seconds of inactivity

// GOOD - Implement heartbeat
class HeartbeatWorker extends SimpleWorker {
  private heartbeatInterval?: NodeJS.Timeout;

  protected async start(): Promise<void> {
    await super.start();

    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.wsClient.send({
        type: WorkerMessageType.HEARTBEAT,
        payload: {
          workerId: this.workerId,
          timestamp: new Date().toISOString(),
        },
      });
    }, 30000);
  }

  protected async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    await super.shutdown();
  }
}
```

### Mixing v1.x and v2.x Patterns

**Problem**: Using postMessage patterns with WebSocket architecture.

**Symptoms**: Messages not received, workers don't connect, errors

**Fix**:

```typescript
// BAD - v1.x postMessage
const worker = new Worker("./worker.js", {
  /* config */
});

// GOOD - v2.x WebSocket
const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
});
```

### Not Handling Message Serialization

**Problem**: Complex objects can't be sent over WebSocket or cause errors.

**Symptoms**: Message send failures, data corruption

**Fix**:

```typescript
// BAD - Sending complex object directly
this.wsClient.send({
  type: WorkerMessageType.JOB_RESULT,
  payload: {
    data: complexObject, // Circular references, functions, etc.
  },
});

// GOOD - Serialize to JSON
const message = {
  type: WorkerMessageType.JOB_RESULT,
  payload: {
    data: JSON.parse(JSON.stringify(simpleObject)), // Ensure plain JSON
  },
};

this.wsClient.send(JSON.stringify(message));
```

### WebSocket Buffer Overflow

**Problem**: Sending messages faster than worker can process causes buffer issues.

**Symptoms**: Memory usage grows, connection drops, delayed processing

**Fix**:

```typescript
// BAD - No flow control
for (let i = 0; i < 1000; i++) {
  this.wsClient.send(createMessage(i)); // Sends all at once!
}

// GOOD - Implement backpressure
class FlowControlledWorker extends SimpleWorker {
  private messageQueue: any[] = [];
  private sending = false;

  protected async start(): Promise<void> {
    await super.start();

    // Send queued messages
    setInterval(() => this.flushQueue(), 100);
  }

  private flushQueue(): void {
    if (this.sending || this.messageQueue.length === 0) return;

    this.sending = true;
    const message = this.messageQueue.shift();

    this.wsClient.send(JSON.stringify(message));

    this.wsClient.once("drain", () => {
      this.sending = false;
    });
  }

  protected async handleMessage(message: WorkerMessage): Promise<void> {
    // Add to queue instead of sending immediately
    this.messageQueue.push(message);
  }
}
```
