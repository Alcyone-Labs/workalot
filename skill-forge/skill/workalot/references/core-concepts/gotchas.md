# Core Concepts Gotchas

## Common Pitfalls

### Singleton in Tests

**Problem**: Using singleton causes test isolation issues.

```typescript
// BAD - Tests share state
import { scheduleAndWait } from "#/index.js";

test("test 1", async () => {
  const result = await scheduleAndWait({ /* job */ });
  // Test 2 sees this job!
});

// GOOD - Each test gets fresh instance
import { createTaskManager, scheduleAndWaitWith } from "#/index.js";

beforeEach(async () => {
  manager = await createTaskManager("test", { backend: "memory" });
});

afterEach(async () => {
  await destroyTaskManager("test");
});
```

### Mixing v1.x and v2.x Code

**Problem**: postMessage (v1.x) doesn't work with WebSocket (v2.x).

```typescript
// BAD - v1.x pattern
import { WorkerManager } from "workalot";
const workerManager = new WorkerManager(orchestrator, { numWorkers: 4 });

// GOOD - v2.x pattern
import { WorkerManagerWS } from "workalot";
const workerManager = new WorkerManagerWS(orchestrator, {
  numWorkers: 4,
  wsPort: 8080,
});
```

### Missing Shutdown

**Problem**: Unclosed connections cause resource leaks.

```typescript
// BAD - Never shutdown
async function process() {
  const manager = await createTaskManager("main", { backend: "sqlite" });
  // Process jobs...
  // Manager never shut down!
}

// GOOD - Always cleanup
async function process() {
  const manager = await createTaskManager("main", { backend: "sqlite" });
  try {
    // Process jobs...
  } finally {
    await destroyTaskManager("main");
  }
}
```

### Callback Hell

**Problem**: Workalot removed callbacks in v2.x.

```typescript
// BAD - v1.x callbacks
manager.addJob(payload, (err, result) => {
  if (err) console.error(err);
  else console.log(result);
});

// GOOD - v2.x async/await
try {
  const result = await scheduleAndWaitWith(manager, payload);
  console.log(result);
} catch (error) {
  console.error(error);
}
```

### Hardcoded Database URLs

**Problem**: Security risk, deployment issues.

```typescript
// BAD - Hardcoded
const manager = await createTaskManager("prod", {
  backend: "postgresql",
  databaseUrl: "postgresql://user:pass123@localhost/db",
});

// GOOD - Environment variable
const manager = await createTaskManager("prod", {
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
});
```

### Memory Backend in Production

**Problem**: Data loss on restart.

```typescript
// BAD - Production with memory
const manager = await createTaskManager("prod", {
  backend: "memory", // Jobs lost on restart!
});

// GOOD - Production with persistence
const manager = await createTaskManager("prod", {
  backend: "sqlite", // or postgresql/redis
  databaseUrl: "./queue.db",
});
```

### Race Conditions in getNextPendingJob

**Problem**: Without transactions, multiple workers can claim same job.

**Issue**: Fixed in SQLiteQueue v2.0+ - now uses `db.transaction()` for both Bun and better-sqlite3.

**Before fix (v2.0.0-alpha)**:
```typescript
// BUGGY - Separate operations, not atomic
const row = selectStmt.get(); // Job A
updateStmt.run(row.id); // Job A claimed
// Another worker also sees Job A before update!
```

**After fix (current)**:
```typescript
// CORRECT - Atomic transaction
const transaction = this.db.transaction(() => {
  const row = selectStmt.get(); // Job A
  updateStmt.run(row.id); // Job A claimed atomically
  return row;
});
```

### Stalled Job Recovery Counting

**Problem**: SQLite UPDATE trigger changes count.

**Issue**: `update_jobs_last_updated` trigger doubles the count in v2.0.0-alpha.

**Fix**: Use COUNT query before UPDATE.

```typescript
// BUGGY - Returns 2x actual count
const result = updateStmt.run(cutoffDate);
return result.changes || 0;

// CORRECT - Count first
const transaction = this.db.transaction(() => {
  const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM jobs WHERE ...");
  const countResult = countStmt.get(cutoffDate);
  const count = countResult.count || 0;
  updateStmt.run(cutoffDate);
  return count;
});
```

### Wrong Worker Distribution Strategy

**Problem**: Round-robin vs random selection.

```typescript
// Use round-robin for equal distribution
new SimpleOrchestrator({
  distributionStrategy: "round-robin", // Workers 1, 2, 3, 1, 2, 3...

// Use random for better load balancing with varying job durations
new SimpleOrchestrator({
  distributionStrategy: "random", // Workers 2, 1, 3, 1, 3, 2...
```

### Missing Job Validation

**Problem**: Invalid payloads cause crashes.

```typescript
// BAD - No validation
async run(payload: any): Promise<any> {
  return process(payload.data); // Crashes if payload.data undefined!
}

// GOOD - Validate
async run(payload: any): Promise<any> {
  this.validatePayload(payload, {
    required: ["data"],
    types: { data: "array" },
  });
  return process(payload.data);
}
```

### Forgetting to Run Migrations

**Problem**: Tables don't exist or schema mismatch.

```typescript
// BAD - No migrations
const queue = new SQLiteQueue({ databaseUrl: "./queue.db" });
await queue.initialize(); // Errors if tables don't exist!

// GOOD - Auto-migrate (default)
const queue = new SQLiteQueue({
  databaseUrl: "./queue.db",
  autoMigrate: true, // Default
});
await queue.initialize();
```

### WAL Mode on Network Filesystem

**Problem**: SQLite WAL fails on NFS/SMB.

```typescript
// BAD - WAL on network drive
const queue = new SQLiteQueue({
  databaseUrl: "/mnt/nfs/queue.db",
  sqliteConfig: { walMode: true }, // Fails on NFS!
});

// GOOD - Disable WAL on network
const queue = new SQLiteQueue({
  databaseUrl: "/mnt/nfs/queue.db",
  sqliteConfig: { walMode: false }, // Use normal journal
});
```

### PostgreSQL Connection Pool Exhaustion

**Problem**: Too many workers for pool size.

```typescript
// BAD - 100 workers with pool size 10
const manager = await createTaskManager("prod", {
  backend: "postgresql",
  maxThreads: 100, // Exceeds pool!
  postgresConfig: { poolSize: 10 },
});

// GOOD - Match workers to pool
const manager = await createTaskManager("prod", {
  backend: "postgresql",
  maxThreads: 8,
  postgresConfig: { poolSize: 20 }, // Pool > workers
});
```
