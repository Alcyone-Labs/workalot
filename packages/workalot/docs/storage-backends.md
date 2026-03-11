# Storage Backends

Workalot supports multiple storage backends for the job queue, each with different trade-offs between performance, persistence, and scalability.

## Overview

| Backend        | Performance       | Persistence | Scalability    | Best For                                       |
| -------------- | ----------------- | ----------- | -------------- | ---------------------------------------------- |
| **Memory**     | 100k+ jobs/sec    | None        | Single process | Development, testing, ephemeral workloads      |
| **SQLite**     | 10k-50k jobs/sec  | Good        | Single machine | Small-medium apps, desktop, edge computing     |
| **PGLite**     | 1k-5k jobs/sec    | Good        | Single machine | Development requiring PostgreSQL compatibility |
| **PostgreSQL** | 5k-50k jobs/sec   | Excellent   | Multi-machine  | Large-scale production, distributed systems    |
| **Redis**      | 10k-100k jobs/sec | Excellent   | Multi-machine  | High throughput, distributed deployments       |

## Memory Backend

In-process queue with no persistence.

### Configuration

```typescript
const manager = new TaskManager({
  backend: "memory",
});
```

### Characteristics

**Advantages:**

- Highest throughput
- Lowest latency
- No external dependencies
- Zero setup

**Disadvantages:**

- Jobs lost on restart
- Single-process only
- No durability guarantees

### Use Cases

- Development and testing
- Ephemeral workloads (data processing pipelines)
- Caching layers with reprocessing capability
- Single-instance applications

### Performance Tuning

```typescript
const manager = new TaskManager({
  backend: "memory",
  maxThreads: os.cpus().length, // All cores for workers
});
```

## SQLite Backend

File-based database with WAL mode for high performance.

### Configuration

```typescript
const manager = new TaskManager({
  backend: "sqlite",
  databaseUrl: "./data/queue.db", // File path
});

// In-memory SQLite
const manager = new TaskManager({
  backend: "sqlite",
  databaseUrl: "memory://",
});
```

### Characteristics

**Advantages:**

- File-based persistence
- Good performance with WAL mode
- No external server required
- Portable (single file)

**Disadvantages:**

- Single-machine only
- Slower than memory for high throughput
- File locking on some operating systems

### Performance Tuning

```typescript
const manager = new TaskManager({
  backend: "sqlite",
  databaseUrl: "./data/queue.db",
  enableWAL: true, // Enable WAL mode (default)
});
```

### File Structure

```
project/
├── data/
│   └── queue.db       # SQLite database file
│   └── queue.db-wal   # WAL file
│   └── queue.db-shm   # Shared memory file
```

### Docker Consideration

When using SQLite in Docker, mount the data directory:

```yaml
volumes:
  - ./data:/app/data
```

## PGLite Backend

WebAssembly PostgreSQL for local development with PostgreSQL compatibility.

### Configuration

```typescript
const manager = new TaskManager({
  backend: "pglite",
  databaseUrl: "./data/pglite", // Directory for data files
});

// In-memory PGLite
const manager = new TaskManager({
  backend: "pglite",
  databaseUrl: "memory://",
});
```

### Characteristics

**Advantages:**

- PostgreSQL wire protocol compatibility
- No external PostgreSQL server needed
- Good for development and testing
- Portable

**Disadvantages:**

- Lower performance than native backends
- Limited features vs full PostgreSQL
- Single-machine only

### Use Cases

- Development environments
- Testing PostgreSQL-specific queries
- CI/CD pipelines
- Desktop applications

## PostgreSQL Backend

Enterprise-grade database with full PostgreSQL features.

### Configuration

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: "postgresql://user:password@localhost:5432/workalot",
});
```

### Connection String Format

```
postgresql://[user[:password]@][host[:port]][/database][?params]
```

**Examples:**

| Connection String                           | Description                |
| ------------------------------------------- | -------------------------- |
| `postgresql://localhost:5432/workalot`      | Default credentials, local |
| `postgresql://user:pass@host:5432/db`       | With credentials           |
| `postgresql:///db?host=/var/run/postgresql` | Unix socket                |
| `postgresql://user@host/db?sslmode=require` | SSL required               |

### Environment Variable

```typescript
// Uses DATABASE_URL environment variable if databaseUrl not specified
const manager = new TaskManager({
  backend: "postgresql",
});
```

### Characteristics

**Advantages:**

- Excellent durability
- Multi-machine scalability
- Rich query capabilities
- Connection pooling support
- Replication support

**Disadvantages:**

- Requires PostgreSQL server
- Higher latency than memory/SQLite
- More complex setup

### Performance Tuning

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
  maxThreads: 8, // Match to your workload
});
```

### PostgreSQL Best Practices

1. **Use connection pooling** (PgBouncer)
2. **Enable SSL** in production
3. **Configure appropriate `max_connections`**
4. **Use SSDs** for storage
5. **Monitor query performance**

### TimescaleDB Support

Workalot supports TimescaleDB for time-series workloads:

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
  enableTimescaleDB: true,
  chunkTimeInterval: "1 hour",
  compressionInterval: "7 days",
  retentionInterval: "90 days",
});
```

## Redis Backend

High-performance distributed queue using Redis.

### Configuration

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: "redis://localhost:6379",
});
```

### Connection String Format

```
redis://[password@]host[:port][/database]
```

**Examples:**

| Connection String                   | Description      |
| ----------------------------------- | ---------------- |
| `redis://localhost:6379`            | Default, no auth |
| `redis://:password@localhost:6379`  | With password    |
| `redis://localhost:6379/0`          | Database 0       |
| `redis://localhost:6379/0?ttl=3600` | With key TTL     |

### Environment Variable

```typescript
const manager = new TaskManager({
  backend: "redis",
});
// Uses REDIS_URL if available
```

### Characteristics

**Advantages:**

- Highest throughput for high-volume workloads
- Sub-millisecond latency
- Native pub/sub support
- Cluster mode support
- Excellent for distributed systems

**Disadvantages:**

- Requires Redis server
- Single-threaded Redis operations
- Memory usage for queue storage
- Less durable than PostgreSQL

### Performance Tuning

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: process.env.REDIS_URL,
  maxThreads: 12,
});
```

### Redis Best Practices

1. **Use Redis Cluster** for horizontal scaling
2. **Configure appropriate `maxmemory`**
3. **Enable AOF persistence** for durability
4. **Use connection pooling**
5. **Monitor memory usage**

### Redis Cluster Configuration

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: "redis://cluster-host:6379", // Use cluster client for multi-node
});
```

## Auto Backend Selection

Workalot automatically selects a backend based on environment:

```typescript
const manager = new TaskManager({});
// In test environment: SQLite memory
// With DATABASE_URL: PostgreSQL
// Otherwise: SQLite file-based
```

## Backend Comparison

### Latency Comparison

| Backend    | Queue Time (avg) | Notes              |
| ---------- | ---------------- | ------------------ |
| Memory     | < 1ms            | In-process         |
| Redis      | 1-5ms            | Network round-trip |
| SQLite     | 2-10ms           | File I/O           |
| PostgreSQL | 5-20ms           | Network + query    |
| PGLite     | 5-15ms           | WASM overhead      |

### Throughput Comparison

| Backend    | Jobs/Second    | Conditions       |
| ---------- | -------------- | ---------------- |
| Memory     | 100,000+       | No persistence   |
| Redis      | 10,000-100,000 | Network, key ops |
| SQLite     | 10,000-50,000  | WAL mode, SSD    |
| PostgreSQL | 5,000-50,000   | Query, network   |
| PGLite     | 1,000-5,000    | WASM             |

### Durability Comparison

| Backend    | Durability   | Restart Behavior |
| ---------- | ------------ | ---------------- |
| Memory     | None         | All jobs lost    |
| PGLite     | Good         | Jobs preserved   |
| SQLite     | Good         | Jobs preserved   |
| PostgreSQL | Excellent    | Jobs preserved   |
| Redis      | Configurable | AOF/None         |

## Choosing a Backend

### Decision Tree

```
Start
  │
  ├─► Development?
  │     └─► Use Memory or SQLite
  │
  ├─► Single machine?
  │     ├─► Need best performance?
  │     │     └─► Memory (with reprocessing)
  │     │
  │     └─► Need persistence?
  │           ├─► File-based?
  │           │     └─► SQLite
  │           │
  │           └─► PostgreSQL compatible?
  │                 └─► PGLite
  │
  └─► Multiple machines?
        ├─► Highest throughput?
        │     └─► Redis
        │
        └─► Maximum durability?
              └─► PostgreSQL
```

### Quick Reference

| Scenario                  | Recommended Backend         |
| ------------------------- | --------------------------- |
| Local development         | Memory or SQLite            |
| CI/CD testing             | Memory                      |
| Desktop application       | SQLite                      |
| Single-server web app     | SQLite or PostgreSQL        |
| Microservices             | Redis or PostgreSQL         |
| Event-driven architecture | Redis                       |
| Time-series workloads     | PostgreSQL + TimescaleDB    |
| High-frequency trading    | Memory (with checkpointing) |
| Batch processing          | PostgreSQL                  |

## Migration Between Backends

Moving from one backend to another:

```typescript
// Export from old backend
const oldManager = new TaskManager({ backend: "sqlite" });
const pendingJobs = await oldManager.getJobsByStatus("pending");

// Import to new backend
const newManager = new TaskManager({ backend: "postgresql" });
await newManager.initialize();

for (const job of pendingJobs) {
  await newManager.schedule({
    jobFile: job.jobPayload.jobFile,
    jobPayload: job.jobPayload.jobPayload,
  });
}

// Shutdown old manager
await oldManager.shutdown();
await newManager.shutdown();
```
