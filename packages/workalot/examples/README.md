# Workalot Examples

This directory contains examples demonstrating various features and use cases of Workalot.

## Directory Structure

### 📁 `_jobs/`

Reusable job definitions used across examples:

- `PingJob.ts` - Simple ping job for testing
- `MathJob.ts` - Mathematical computation job
- `TimeSeriesJob.ts` - Time series data processing
- `WorkflowJob.ts` - Multi-step workflow job

### 📁 `in-memory/`

Simple in-memory examples for getting started:

- `quick-start.ts` - Minimal example to get started
- `basic-usage.ts` - Basic TaskManager usage
- `pglite-inmemory.ts` - In-memory PGLite backend

### 📁 `storage-adapters/`

Examples using different storage backends:

- `sqlite-backend.ts` - SQLite backend example
- `redis-example.ts` - Redis backend example
- `timescaledb-example.ts` - TimescaleDB backend example
- `timescaledb-benchmark.ts` - TimescaleDB performance testing

### 📁 `features/`

Feature-specific examples:

- `error-handling.ts` - Error handling patterns
- `factory-pattern.ts` - TaskManager factory pattern
- `channel-routing-example.ts` - Channel-based message routing
- `meta-envelope-example.ts` - Meta envelope messaging
- `custom-orchestration/` - Custom orchestrator implementation

### 📁 `multi-core/`

Multi-core and distributed examples:

- `performance-test.ts` - Performance testing
- `backend-comparison.ts` - Compare backend performance
- `basic-distributed/` - Basic distributed worker setup
- `websocket-distributed/` - WebSocket-based distributed workers

### 📁 `full-stack/`

Complete application examples:

- `sample-consumer/` - Full-stack job consumer application

### 📁 `aquaria-v3/`

Aquaria workflow engine (experimental):

- Advanced workflow orchestration
- Research agent workflows
- Human-in-the-loop patterns

## Running Examples

All examples can be run with Bun:

```bash
# In-memory quick start
bun run examples/in-memory/quick-start.ts

# Redis backend
bun run examples/storage-adapters/redis-example.ts

# Performance testing
bun run examples/multi-core/performance-test.ts
```

## Prerequisites

Some examples require additional setup:

**Redis examples:**

```bash
docker-compose up -d redis
```

**PostgreSQL/TimescaleDB examples:**

```bash
docker-compose up -d postgres
# or
docker-compose up -d timescaledb
```

## Building Examples

Examples are included in the TypeScript compilation:

```bash
pnpm run build
```

This compiles all examples to `dist/examples/`.
