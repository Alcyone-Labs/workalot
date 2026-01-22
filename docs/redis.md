# Redis Queue Backend

High-performance job queue implementation using Redis as the storage backend.

## Features

- ✅ **Atomic job claiming** - Lua scripts prevent race conditions
- ✅ **Priority support** - Jobs ordered by priority + timestamp
- ✅ **Stalled job recovery** - Automatic recovery of stuck jobs
- ✅ **Auto-cleanup** - TTL-based cleanup of old jobs
- ✅ **Pub/Sub notifications** - Optional real-time updates
- ✅ **Redis Cluster support** - Horizontal scaling
- ✅ **Connection pooling** - High performance
- ✅ **Works with Upstash** - Cloudflare-compatible Redis

## Installation

```bash
pnpm add ioredis
```

## Quick Start

### Local Redis

```typescript
import { RedisQueue } from "@alcyone-labs/workalot";

const queue = new RedisQueue({
  redisUrl: "redis://localhost:6379",
  keyPrefix: "workalot",
  debug: true,
});

await queue.initialize();
```

### Upstash (Cloudflare-compatible)

```typescript
import { RedisQueue } from "@alcyone-labs/workalot";

const queue = new RedisQueue({
  redisUrl: process.env.UPSTASH_REDIS_URL,
  redisOptions: {
    tls: {
      rejectUnauthorized: false,
    },
  },
  keyPrefix: "workalot",
});

await queue.initialize();
```

## Configuration

```typescript
interface RedisQueueConfig {
  // Connection
  redisUrl?: string; // Redis connection URL
  redisOptions?: RedisOptions; // ioredis options

  // Queue settings
  keyPrefix?: string; // Default: 'workalot'
  completedJobTTL?: number; // Default: 86400 (24 hours)
  failedJobTTL?: number; // Default: 604800 (7 days)
  enablePubSub?: boolean; // Default: false
  debug?: boolean; // Default: false
}
```

## Data Structure

Redis uses optimized data structures for high performance:

```
workalot:jobs:{jobId}          → Hash (job data)
  ├─ id: string
  ├─ payload: JSON
  ├─ status: pending|processing|completed|failed
  ├─ workerId: number
  ├─ result: JSON
  ├─ error: string
  ├─ requestedAt: timestamp
  ├─ startedAt: timestamp
  └─ completedAt: timestamp

workalot:queue:pending         → Sorted Set
  └─ score = (priority * 1e13) + timestamp
     (higher priority + older jobs = lower score = first)

workalot:queue:processing      → Hash
  └─ jobId → workerId:startTime

workalot:queue:completed       → Set (with TTL)
workalot:queue:failed          → Set (with TTL)

workalot:stats                 → Hash
  ├─ total: number
  ├─ pending: number
  ├─ processing: number
  ├─ completed: number
  └─ failed: number
```

## Atomic Operations

Redis uses Lua scripts for atomic job claiming (similar to PostgreSQL's FOR UPDATE SKIP LOCKED):

```lua
-- Atomically claim a job
local pendingKey = KEYS[1]
local processingKey = KEYS[2]
local jobKeyPrefix = KEYS[3]
local workerId = ARGV[1]
local startTime = ARGV[2]

-- Pop lowest score (highest priority, oldest) job
local result = redis.call('ZPOPMIN', pendingKey, 1)
if #result == 0 then
  return nil
end

local jobId = result[1]
local jobKey = jobKeyPrefix .. jobId

-- Update job status
redis.call('HSET', jobKey, 'status', 'processing', 'workerId', workerId, 'startedAt', startTime)

-- Add to processing hash
redis.call('HSET', processingKey, jobId, workerId .. ':' .. startTime)

return jobId
```

## Performance

| Operation         | Complexity | Expected Performance   |
| ----------------- | ---------- | ---------------------- |
| addJob            | O(log N)   | 10,000-50,000 ops/sec  |
| getNextPendingJob | O(log N)   | 10,000-50,000 ops/sec  |
| getJob            | O(1)       | 50,000-100,000 ops/sec |
| updateJobStatus   | O(log N)   | 10,000-50,000 ops/sec  |
| getStats          | O(1)       | 50,000-100,000 ops/sec |

**Expected throughput**: 10,000-50,000 jobs/second on a single Redis instance.

## Usage Examples

### Basic Usage

```typescript
import { RedisQueue } from "@alcyone-labs/workalot";

const queue = new RedisQueue({
  redisUrl: "redis://localhost:6379",
});

await queue.initialize();

// Add a job
const jobId = await queue.addJob({
  jobFile: "./jobs/process-data.js",
  jobPayload: { data: "hello" },
});

// Get next pending job (atomic)
const job = await queue.getNextPendingJob();

// Update job status
await queue.updateJobStatus(job.id, JobStatus.COMPLETED, {
  results: { success: true },
  executionTime: 100,
  queueTime: 50,
});

// Get stats
const stats = await queue.getStats();
console.log(stats);

// Cleanup
await queue.shutdown();
```

### Batch Operations

```typescript
// Batch add jobs
const jobIds = await queue.batchAddJobs([
  { payload: { jobFile: "job1.js", jobPayload: { task: 1 } } },
  { payload: { jobFile: "job2.js", jobPayload: { task: 2 } } },
  { payload: { jobFile: "job3.js", jobPayload: { task: 3 } } },
]);

console.log(`Added ${jobIds.length} jobs`);
```

### Stalled Job Recovery

```typescript
// Find stalled jobs (processing > 5 minutes)
const stalledJobs = await queue.getStalledJobs(300000);
console.log(`Found ${stalledJobs.length} stalled jobs`);

// Recover stalled jobs
const recoveredCount = await queue.recoverStalledJobs(300000);
console.log(`Recovered ${recoveredCount} jobs`);
```

### Pub/Sub Notifications

```typescript
const queue = new RedisQueue({
  redisUrl: "redis://localhost:6379",
  enablePubSub: true,
});

await queue.initialize();

queue.on("notification", (message) => {
  console.log("Notification:", message);
  // { type: 'job-added', jobId: '...' }
  // { type: 'job-updated', jobId: '...', status: 'completed' }
});
```

## Deployment Options

### Local Development

```bash
docker run -d -p 6379:6379 redis:alpine
```

### Production

- **AWS ElastiCache** - Managed Redis
- **Upstash** - Serverless Redis (Cloudflare-compatible)
- **Redis Cloud** - Managed Redis with clustering
- **Self-hosted** - Redis Cluster for horizontal scaling

### Cloudflare Workers + Upstash

```typescript
import { RedisQueue } from "@alcyone-labs/workalot";

const queue = new RedisQueue({
  redisUrl: env.UPSTASH_REDIS_URL,
  redisOptions: {
    tls: { rejectUnauthorized: false },
  },
});
```

## Testing

```bash
# Start Redis
docker run -d -p 6379:6379 redis:alpine

# Run test
bun run tests/redis-manual-test.ts

# Stop Redis
docker stop $(docker ps -q --filter ancestor=redis:alpine)
```

## Comparison with Other Backends

| Feature      | Redis      | PostgreSQL    | SQLite          | PGLite          |
| ------------ | ---------- | ------------- | --------------- | --------------- |
| Performance  | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐      | ⭐⭐⭐          | ⭐⭐⭐          |
| Atomic ops   | ✅ Lua     | ✅ FOR UPDATE | ⚠️ Transactions | ⚠️ Transactions |
| Clustering   | ✅ Native  | ✅ Complex    | ❌ No           | ❌ No           |
| Persistence  | ✅ RDB/AOF | ✅ ACID       | ✅ ACID         | ✅ ACID         |
| Edge deploy  | ✅ Upstash | ❌ No         | ✅ Yes          | ✅ Yes          |
| Memory usage | High       | Medium        | Low             | Low             |

## Best Practices

1. **Use connection pooling** - ioredis handles this automatically
2. **Set appropriate TTLs** - Prevent unbounded growth
3. **Monitor memory** - Redis is in-memory
4. **Use Redis Cluster** - For horizontal scaling
5. **Enable persistence** - RDB or AOF for durability
6. **Monitor stalled jobs** - Run recovery periodically

## Troubleshooting

### Connection refused

- Ensure Redis is running
- Check connection URL
- Verify firewall rules

### High memory usage

- Reduce TTLs for completed/failed jobs
- Run cleanup more frequently
- Consider Redis Cluster

### Slow performance

- Check Redis memory usage
- Monitor network latency
- Consider connection pooling
- Use pipelining for batch operations
