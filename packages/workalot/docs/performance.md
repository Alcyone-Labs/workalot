# Performance Optimization

This guide covers techniques for optimizing Workalot performance across different scenarios.

## Benchmarking

Run built-in benchmarks to measure performance:

```bash
# Quick benchmark
pnpm run benchmark:quick

# Backend comparison
pnpm run benchmark:backends

# SQLite-specific
pnpm run benchmark:sqlite
```

## Backend Performance

### Memory Backend (Fastest)

```typescript
// Maximum throughput configuration
const manager = new TaskManager({
  backend: "memory",
  maxThreads: undefined, // Use all available cores
  silent: true,
  jobRecoveryEnabled: false,
});
```

**Expected throughput:** 100,000+ jobs/second

### Redis Backend

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: process.env.REDIS_URL,
  maxThreads: 12, // Scale with workload
});
```

**Expected throughput:** 10,000-100,000 jobs/second

**Tuning tips:**

- Use Redis Cluster for horizontal scaling
- Enable AOF persistence for durability
- Use pipelining for batch operations

### PostgreSQL Backend

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
  maxThreads: 8,
  silent: true,
});
```

**Expected throughput:** 5,000-50,000 jobs/second

**Tuning tips:**

- Use connection pooling (PgBouncer)
- Increase `max_connections` appropriately
- Use SSDs for storage
- Optimize query performance

### SQLite Backend

```typescript
const manager = new TaskManager({
  backend: "sqlite",
  databaseUrl: "./data/queue.db",
  enableWAL: true, // Enable WAL mode (default)
});
```

**Expected throughput:** 10,000-50,000 jobs/second

**Tuning tips:**

- Enable WAL mode (default)
- Use SSDs
- Periodic VACUUM

## Worker Configuration

### Optimal Thread Count

```typescript
import { cpus } from "node:os";

// For CPU-intensive jobs
const numCpus = cpus().length;
const maxThreads = numCpus - 2; // Reserve 2 cores

// For I/O-intensive jobs
const maxThreads = numCpus; // Use all cores
```

### Batch Processing

Enable batch processing for higher throughput:

```typescript
const scheduler = jobScheduler;

scheduler.setBatchConfig({
  batchSize: 100, // Jobs per batch
  enabled: true,
});
```

**Benefits:**

- Reduces queue contention
- Better cache utilization
- Lower per-job overhead

### Worker Queues

For ultra-high throughput, enable worker-local queues:

```typescript
const workerManager = new WorkerManager(queueOrchestrator, {
  numWorkers: 8,
});

const queueOrchestrator = new QueueOrchestrator({
  workerQueueSize: 50,
  queueThreshold: 10,
  ackTimeout: 5000,
  enableWorkerQueues: true,
});
```

**Trade-offs:**

- More complex failure handling
- Jobs bound to specific workers
- Higher memory usage

## Connection Pooling

### PostgreSQL with PgBouncer

```yaml
# docker-compose.yml
services:
  pgbouncer:
    image: pgbouncer/pgbouncer
    environment:
      DATABASES: "workalot_db=host=db port=5432 dbname=workalot"
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 100
      DEFAULT_POOL_SIZE: 20
```

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: "postgresql://user:pass@localhost:6432/workalot", // PgBouncer port
});
```

### Redis Connection Pool

```typescript
import { Pool } from "ioredis";

const pool = new Pool({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});
```

## Queue Monitoring

### Queue Depth Monitoring

```typescript
setInterval(async () => {
  const stats = await manager.getQueueStats();
  const workers = await manager.getWorkerStats();

  console.log({
    pending: stats.pending,
    processing: stats.processing,
    workersAvailable: workers.available,
    workersBusy: workers.busy,
    queueAge: stats.oldestPending ? Date.now() - stats.oldestPending.getTime() : null,
  });
}, 5000);
```

### Alerting Thresholds

```typescript
const ALERTS = {
  queueBacklog: {
    warning: 100, // Jobs pending
    critical: 1000, // Jobs pending
  },
  queueLatency: {
    warning: 5000, // 5 seconds
    critical: 30000, // 30 seconds
  },
  workerUtilization: {
    warning: 0.9, // 90% busy
    critical: 0.95, // 95% busy
  },
};

function checkAlerts(stats: QueueStats, workerStats: any): void {
  if (stats.pending > ALERTS.queueBacklog.critical) {
    alert("CRITICAL: Queue backlog exceeds 1000 jobs");
  }

  const utilization = workerStats.busy / workerStats.total;
  if (utilization > ALERTS.workerUtilization.critical) {
    alert("CRITICAL: Workers at 95% capacity");
  }
}
```

## Performance Patterns

### Job Batching

Instead of scheduling many small jobs, batch them:

```typescript
// Instead of
for (const item of items) {
  await manager.scheduleAndWait({
    jobFile: "jobs/ProcessItem.ts",
    jobPayload: { item },
  });
}

// Do this
await manager.scheduleAndWait({
  jobFile: "jobs/ProcessBatch.ts",
  jobPayload: { items },
});
```

### Parallel Scheduling

```typescript
async function processAll(items: any[]): Promise<void> {
  const promises = items.map((item) =>
    manager.schedule({
      jobFile: "jobs/ProcessItem.ts",
      jobPayload: { item },
    }),
  );

  const jobIds = await Promise.all(promises);

  // Wait for completion
  await manager.whenIdle();
}
```

### Caching Job Results

```typescript
import LRU from "lru-cache";

const resultCache = new LRU<string, any>({
  max: 1000,
  ttl: 60000, // 1 minute
});

export class CachedJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const cacheKey = JSON.stringify(payload);

    const cached = resultCache.get(cacheKey);
    if (cached) {
      return this.createSuccessResult({ cached: true, data: cached });
    }

    const result = await this.compute(payload);

    resultCache.set(cacheKey, result);

    return this.createSuccessResult({ cached: false, data: result });
  }
}
```

## Resource Tuning

### Memory

```typescript
// Reduce memory footprint
const manager = new TaskManager({
  backend: "memory",
  maxInMemoryAge: 3600000, // 1 hour (clean up older jobs)
  maxThreads: 4, // Fewer workers = less memory
});
```

### CPU

```typescript
// Maximize CPU utilization
const manager = new TaskManager({
  backend: "memory", // Fastest backend
  maxThreads: os.cpus().length, // All cores
  silent: true, // Reduce logging overhead
});
```

### I/O

```typescript
// Optimize for I/O-bound workloads
const manager = new TaskManager({
  backend: "redis", // Fast network I/O
  maxThreads: os.cpus().length * 2, // More workers for async I/O
});
```

## Common Bottlenecks

### Slow Jobs

**Symptom:** Queue backs up, workers idle

**Solution:**

```typescript
// Increase timeout for slow jobs
await manager.scheduleAndWait({
  jobFile: "jobs/SlowJob.ts",
  jobPayload: { data },
  jobTimeout: 60000, // 1 minute
});

// Or scale workers
const manager = new TaskManager({
  maxThreads: 16, // More workers
});
```

### Database Connection Exhaustion

**Symptom:** New jobs hang, connection errors

**Solution:**

```typescript
// Use connection pooling
const pool = new Pool({
  max: 20, // Max pool size
});

// Reduce concurrent workers
const manager = new TaskManager({
  maxThreads: 4,
});
```

### High Memory Usage

**Symptom:** Out of memory errors, slow performance

**Solution:**

```typescript
const manager = new TaskManager({
  maxThreads: Math.max(2, os.cpus().length - 4), // Fewer workers
  maxInMemoryAge: 300000, // 5 minutes (clean up faster)
});

// Use persistent backend
const manager = new TaskManager({
  backend: "sqlite", // Persistent, less memory
});
```

## Performance Checklist

- [ ] Choose appropriate backend for workload
- [ ] Configure optimal thread count
- [ ] Enable batch processing
- [ ] Use connection pooling for databases
- [ ] Monitor queue depth and latency
- [ ] Implement alerting for bottlenecks
- [ ] Batch small jobs into larger ones
- [ ] Cache expensive operations
- [ ] Tune timeouts appropriately
- [ ] Profile and benchmark regularly

## Monitoring Tools

```typescript
import { metrics } from "@opentelemetry/api";

// Create custom metrics
const queueDepth = metrics.getMeter("workalot").createHistogram("queue_depth", {
  unit: "jobs",
  description: "Number of pending jobs",
});

const jobDuration = metrics.getMeter("workalot").createHistogram("job_duration", {
  unit: "ms",
  description: "Job execution duration",
});

// Record metrics
queueDepth.record(stats.pending);
jobDuration.record(result.executionTime);
```
