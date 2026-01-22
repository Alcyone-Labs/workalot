# Workalot Core Concepts

## Overview

Workalot v2.0 is a high-performance, multi-threaded job queue system for Node.js/Bun.js with WebSocket-based distributed architecture.

**Core Philosophy**:
- Multi-threaded performance over single-threaded simplicity
- Factory pattern over singleton for testability
- Backend-agnostic design (Memory/SQLite/PGLite/PostgreSQL/Redis)
- WebSocket communication for distributed workers (v2.x)
- TypeScript-first with strict typing

## When to Use

Use Workalot when you need:
- High-throughput job processing (100K+ jobs/sec with Memory backend)
- Multi-backend persistence options
- Distributed worker scaling across machines
- Real-time job distribution via WebSocket
- Fault tolerance with automatic job recovery
- Progressive complexity from simple to advanced use cases

## Architecture Components

```
┌─────────────────────────────────────────────┐
│         User Application                 │
├─────────────────────────────────────────────┤
│     Task Manager (Factory)              │
├──────────────┬──────────────────────────┤
│  Orchestrator │      Workers (WS Clients)  │
│  (WebSocket)  │    (Worker Threads)       │
├──────────────┴──────────────────────────┤
│      Queue Backend                      │
│  (Memory/SQLite/PG/PostgreSQL/Redis)   │
└─────────────────────────────────────────────┘
```

## Key Decisions

**Choose Worker Architecture**:
- Local (same process): Use `WorkerManager` with in-process worker threads
- Distributed (multi-machine): Use `WorkerManagerWS` with WebSocket + `SimpleOrchestrator`

**Choose Backend**:
- Development/Testing: Memory backend (fastest, no persistence)
- Single machine prod: SQLite (file-based, WAL mode)
- Distributed prod: PostgreSQL (enterprise features, replication)
- High-throughput: Redis (atomic ops, 10K-50K jobs/sec)
- Edge computing: Redis (Upstash) or PGLite (WASM PostgreSQL)

**Choose Pattern**:
- Simple use: `scheduleAndWait()` with default singleton
- Multiple instances: `createTaskManager(name, config)` factory pattern
- Testing: Factory with isolated instances, in-memory backend
- Production: Factory with persistent backend + job recovery enabled

## Migration Path

**v1.x → v2.x**:
- `WorkerManager` (postMessage) → `WorkerManagerWS` (WebSocket)
- `initializeTaskManager()` → `createTaskManager(name, config)`
- Singleton pattern → Factory pattern (recommended)

## Core Workflows

### Basic Job Scheduling
```typescript
import { scheduleAndWait } from "#/index.js";
const result = await scheduleAndWait({
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "value" },
});
```

### Factory Pattern (Recommended)
```typescript
import { createTaskManager, scheduleAndWaitWith } from "#/index.js";
const manager = await createTaskManager("main", { backend: "sqlite" });
const result = await scheduleAndWaitWith(manager, { /* job */ });
await destroyTaskManager("main");
```

### Distributed Setup
```typescript
// Orchestrator
import { SimpleOrchestrator } from "#/index.js";
const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: { backend: "sqlite", databaseUrl: "./queue.db" },
});
await orchestrator.start();

// Worker (separate process)
import { SimpleWorker } from "#/index.js";
const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(),
});
await worker.start();
```

## Common Pitfalls

- Don't use singleton in tests (use factory for isolation)
- Don't mix postMessage v1.x code with WebSocket v2.x code
- Don't forget to call `shutdown()` on queues/workers
- Don't use callbacks (use async/await only)
- Don't hardcode database URLs (use environment variables)
- Don't rely on Memory backend for production persistence
