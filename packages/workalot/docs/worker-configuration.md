# Worker Configuration

Workers execute jobs in separate threads for CPU-intensive workloads. Proper configuration is crucial for optimal performance.

## Thread Allocation Strategy

The default thread count is calculated as:

```typescript
maxThreads = os.cpus().length - 2;
```

This reserves 2 CPU cores for the main thread (queue management, scheduling) and uses the rest for job execution.

### Recommendations by Machine Size

| Machine Size      | CPU Cores | Recommended maxThreads | Rationale                        |
| ----------------- | --------- | ---------------------- | -------------------------------- |
| Development       | 4-8       | 2-4                    | Leave headroom for dev tools     |
| Production Small  | 4         | 2                      | Reserve cores for OS and I/O     |
| Production Medium | 8-16      | 6-14                   | Balance queue and worker threads |
| Production Large  | 32+       | os.cpus() - 2          | Maximize worker throughput       |

## Configuration Options

### QueueConfig Worker Settings

```typescript
interface QueueConfig {
  maxThreads?: number; // Number of worker threads
  silent?: boolean; // Suppress worker console output
  jobRecoveryEnabled?: boolean; // Enable stalled job recovery
  healthCheckInterval?: number; // Health check frequency (ms)
}
```

### WorkerManagerConfig

```typescript
interface WorkerManagerConfig {
  numWorkers?: number; // Number of workers
  projectRoot?: string; // Project root directory
  silent?: boolean; // Silent mode
  wsPort?: number; // WebSocket server port
  wsHostname?: string; // WebSocket hostname
  enableHealthCheck?: boolean; // Enable health checks
  healthCheckInterval?: number; // Health check interval (ms)
  jobTimeout?: number; // Default job timeout (ms)
  batchTimeout?: number; // Batch job timeout (ms)
}
```

## Configuration Examples

### Development Configuration

```typescript
const manager = new TaskManager({
  backend: "memory",
  maxThreads: 2, // Reduce for IDE debugging
  silent: false, // See worker output
  jobRecoveryEnabled: false, // Faster iteration
});
```

### Production Configuration

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
  maxThreads: undefined, // Use system default (cpus - 2)
  silent: true, // Reduce log noise
  jobRecoveryEnabled: true,
  healthCheckInterval: 30000,
});
```

### High-Performance Configuration

```typescript
const manager = new TaskManager({
  backend: "memory",
  maxThreads: os.cpus().length, // All cores for workers
  silent: true,
});
```

## Using Presets

```typescript
import { TaskManagerFactoryPresets } from "workalot";

const development = TaskManagerFactoryPresets.development();
const testing = TaskManagerFactoryPresets.testing();
const productionSQLite = TaskManagerFactoryPresets.productionSQLite("./queue.db");
const highPerformance = TaskManagerFactoryPresets.highPerformance();
```

### Preset Configurations

| Preset               | Backend    | maxThreads     | Silent | Recovery |
| -------------------- | ---------- | -------------- | ------ | -------- |
| development          | memory     | 2              | false  | disabled |
| testing              | memory     | 1              | true   | disabled |
| productionSQLite     | sqlite     | system default | false  | enabled  |
| productionPostgreSQL | postgresql | system default | false  | enabled  |
| highPerformance      | memory     | all cores      | true   | disabled |

## Batch Processing

Workalot supports batch job processing for improved throughput:

```typescript
const scheduler = jobScheduler; // Access via TaskManager internals

scheduler.setBatchConfig({
  batchSize: 100, // Jobs per batch
  enabled: true, // Enable batch processing
});
```

**Batch Configuration:**

| Parameter | Default | Description             |
| --------- | ------- | ----------------------- |
| batchSize | 100     | Maximum jobs per batch  |
| enabled   | true    | Enable batch processing |

## Worker Queues (Advanced)

For ultra-high throughput scenarios, enable worker-local queues:

```typescript
const workerManager = new WorkerManager(queueOrchestrator, {
  numWorkers: 8,
});

const queueOrchestrator = new QueueOrchestrator({
  workerQueueSize: 50, // Jobs per worker queue
  queueThreshold: 10, // Refill threshold
  ackTimeout: 5000, // ACK timeout (ms)
  enableWorkerQueues: true, // Enable worker-local queues
});
```

**Benefits:**

- Reduces central queue contention
- Enables work stealing
- Better cache locality

**Trade-offs:**

- More complex failure handling
- Jobs assigned to specific workers

## Health Checks

Worker health checks detect stalled or disconnected workers:

```typescript
const manager = new WorkerManager({
  enableHealthCheck: true,
  healthCheckInterval: 30000, // 30 seconds
});
```

**Health Check Behavior:**

1. Sends PING message to all workers
2. Waits for PONG response
3. Marks non-responsive workers as stale
4. Stale workers are disconnected and replaced

## Monitoring Worker Status

```typescript
const workerStats = await manager.getWorkerStats();

console.log({
  total: workerStats.total,
  ready: workerStats.ready,
  available: workerStats.available,
  busy: workerStats.busy,
  workers: workerStats.workers.map((w) => ({
    id: w.id,
    busy: w.busy,
    currentJob: w.currentJob,
  })),
});
```

## Common Issues

### Workers Not Processing Jobs

**Symptoms:** Queue grows but workers remain idle

**Causes:**

1. Workers crashed silently
2. Jobs timing out
3. Deadlock in job execution

**Solution:**

```typescript
// Enable job recovery
const manager = new TaskManager({
  jobRecoveryEnabled: true,
  healthCheckInterval: 15000,
});

// Manually check worker status
const status = await manager.getStatus();
console.log(status.workers);

// If workers are stuck, restart
await manager.shutdown();
```

### Too Many Workers

**Symptoms:** High memory usage, context switching overhead

**Solution:**

```typescript
const manager = new TaskManager({
  maxThreads: Math.max(1, os.cpus().length - 4), // Reserve more cores
});
```

### Jobs Timing Out

**Symptoms:** Jobs fail with timeout errors

**Solution:**

```typescript
const result = await manager.scheduleAndWait({
  jobFile: "jobs/LongJob.ts",
  jobPayload: { data: "large" },
  jobTimeout: 120000, // 2 minutes
});
```

## Scaling Recommendations

### Single Machine

| Workload Type     | Backend    | Workers   | Notes                                |
| ----------------- | ---------- | --------- | ------------------------------------ |
| Development       | memory     | 2-4       | Fast iteration                       |
| Small Production  | sqlite     | 4-6       | File-based, good for single instance |
| Medium Production | postgresql | 6-12      | Better persistence                   |
| High Throughput   | memory     | all cores | Accept data loss on restart          |

### Distributed (Multiple VMs)

| Workload Type    | Backend    | Workers per VM | Notes                         |
| ---------------- | ---------- | -------------- | ----------------------------- |
| Web Service      | redis      | 4-8 per VM     | Shared queue across instances |
| Batch Processing | postgresql | 8-16 per VM    | Coordinator pattern           |
| Event Processing | redis      | 6-12 per VM    | Pub/sub pattern               |

## Best Practices

1. **Measure, don't guess**: Profile your workload before tuning
2. **Reserve headroom**: Always leave 1-2 cores for queue management
3. **Enable health checks**: Critical for production deployments
4. **Monitor queue depth**: Indicates if more workers are needed
5. **Test failure scenarios**: Verify job recovery works correctly
6. **Set appropriate timeouts**: Prevent stuck jobs from blocking workers
