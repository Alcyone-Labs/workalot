# Queue Backends

## Overview

Workalot provides 5 pluggable queue backends with identical API - swap backends without code changes.

**Backends**: Memory | SQLite | PGLite | PostgreSQL | Redis

## When to Use Each Backend

### Memory Backend

- **Use**: Development, testing, CI/CD, high-throughput temp processing
- **Avoid**: Production persistence, distributed systems, restart scenarios
- **Throughput**: 100,000+ jobs/sec
- **Persistence**: ❌ No

### SQLite Backend

- **Use**: Single-machine production, edge computing, embedded systems
- **Avoid**: Multi-machine distributed, high-concurrency writes (>10 concurrent)
- **Throughput**: 10,000-50,000 jobs/sec
- **Persistence**: ✅ File-based

### PGLite Backend

- **Use**: PostgreSQL compatibility testing, offline-first apps, serverless
- **Avoid**: High-performance needs, production with large datasets
- **Throughput**: 1,000-5,000 jobs/sec
- **Persistence**: ✅ WASM-based

### PostgreSQL Backend

- **Use**: Production distributed, enterprise HA, time-series processing
- **Avoid**: Simple single-machine needs, low-resource environments
- **Throughput**: 5,000-50,000 jobs/sec
- **Persistence**: ✅ Server-based

### Redis Backend

- **Use**: High-throughput distributed, edge computing (Upstash), microservices
- **Avoid**: Large data payloads (>1MB), strict persistence requirements
- **Throughput**: 10,000-50,000 jobs/sec
- **Persistence**: ✅ In-memory with RDB/AOF

## Backend Selection Decision Tree

```
Need persistence?
  ├─ No → Memory Backend
  └─ Yes → Need distribution?
            ├─ No → SQLite Backend
            └─ Yes → High throughput required?
                    ├─ Yes → Redis Backend
                    └─ No → PostgreSQL Backend (or PGLite for WASM)
```

## Backend-Specific Configuration

### Memory Backend

```typescript
const config = {
  backend: "memory",
  maxInMemoryAge: 60 * 60 * 1000, // 1 hour retention
  maxThreads: 8,
  silent: false,
};
```

**Optimizations**:

- No database setup
- Microsecond latency
- Perfect for unit tests
- Jobs lost on process restart

### SQLite Backend

```typescript
const config = {
  backend: "sqlite",
  databaseUrl: "./queue.db", // or "memory://" for in-memory
  sqliteConfig: {
    walMode: true, // Better concurrency
    busyTimeout: 5000, // Wait for locks
    synchronous: "NORMAL", // Speed vs durability balance
  },
  autoMigrate: true, // Run schema migrations
  enableWAL: true, // WAL mode for performance
};
```

**Optimizations**:

- WAL mode for concurrent reads/writes
- Batch operations for bulk jobs
- Regular VACUUM for compaction
- Avoid network filesystems for WAL

### PGLite Backend

```typescript
const config = {
  backend: "pglite",
  databaseUrl: "./data/pglite", // Directory for data
  pgliteConfig: {
    memory: true, // In-memory mode (faster)
    relaxedDurability: true, // Trade durability for speed
  },
};
```

**Caveats**:

- 1-2 second startup time (WASM compilation)
- Higher memory usage than SQLite
- Experimental status
- No network access

### PostgreSQL Backend

```typescript
const config = {
  backend: "postgresql",
  databaseUrl: "postgresql://user:pass@localhost:5432/db",
  postgresConfig: {
    poolSize: 20, // Connection pool size
    enableListen: true, // LISTEN/NOTIFY for real-time
    enablePartitioning: true, // Table partitioning for scale
    ssl: { rejectUnauthorized: true },
  },
  enableTimescaleDB: false, // Enable for time-series optimization
};
```

**TimescaleDB Optimization**:

```typescript
const config = {
  backend: "postgresql",
  enableTimescaleDB: true,
  chunkTimeInterval: "1 hour", // Hypertable chunk size
  compressionInterval: "7 days", // Compress old chunks
  retentionInterval: "90 days", // Drop very old data
};
```

**Benefits**: 70-90% storage reduction for historical data

### Redis Backend

```typescript
const config = {
  backend: "redis",
  databaseUrl: "redis://localhost:6379",
  redisConfig: {
    keyPrefix: "workalot",
    completedJobTTL: 86400, // 24 hours
    failedJobTTL: 604800, // 7 days
    enablePubSub: true, // Real-time notifications
    tls: { rejectUnauthorized: false }, // For TLS connections
  },
};
```

**Upstash/Cloudflare**:

```typescript
const config = {
  backend: "redis",
  databaseUrl: process.env.UPSTASH_REDIS_URL,
  redisConfig: {
    tls: { rejectUnauthorized: false },
  },
};
```

**Optimizations**:

- Lua scripts for atomic operations
- Sorted sets for priority queues
- Pub/sub for real-time updates
- Auto-cleanup with TTL

## Performance Comparison

| Backend    | Throughput      | Latency | Setup   | Edge Deploy | Best For       |
| ---------- | --------------- | ------- | ------- | ----------- | -------------- |
| Memory     | 100,000+/s      | <1ms    | None    | ✅          | Dev/Test       |
| SQLite     | 10,000-50,000/s | 1-5ms   | Minimal | ✅          | Single server  |
| PGLite     | 1,000-5,000/s   | 5-20ms  | Minimal | ✅          | PG testing     |
| PostgreSQL | 5,000-50,000/s  | 2-10ms  | Complex | ❌          | Enterprise     |
| Redis      | 10,000-50,000/s | 1-3ms   | Medium  | ✅          | High perf/dist |

_Benchmarks: MacBook Pro M1, 8 workers_
