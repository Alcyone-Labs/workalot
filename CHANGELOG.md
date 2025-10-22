# Changelog

All notable changes to Workalot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - Unreleased

### Added

#### New Backend: Redis Queue
- **RedisQueue** implementation with atomic operations via Lua scripts
- Support for Redis Cluster and distributed deployments
- Pub/Sub notifications for real-time job updates
- TTL-based auto-cleanup for completed and failed jobs
- Upstash Redis support for edge computing (Cloudflare Workers)
- Expected performance: 10,000-50,000 jobs/second
- Atomic job claiming similar to PostgreSQL's FOR UPDATE SKIP LOCKED
- Connection pooling via ioredis
- Priority queue using Redis Sorted Sets

#### PostgreSQL Improvements
- Migrated from `pg` to `postgres` package for better performance
- Unified code paths for Bun and Node.js runtimes
- FOR UPDATE SKIP LOCKED optimization now works on both runtimes
- Improved connection handling and error recovery

#### Documentation
- Comprehensive Redis Queue documentation (`docs/REDIS_QUEUE.md`)
- Updated README with Redis backend information
- Backend comparison table with all 5 backends
- Production readiness checklist (`docs/PRODUCTION_READINESS.md`)
- Updated backend selection guide

#### Testing
- Redis test suite (`tests/redis.test.ts`)
- Automated tests with vitest
- Manual test scripts for all backends
- Concurrent job claiming tests

#### Benchmarking
- Redis benchmark configurations
- Support for 1k and 10k job benchmarks
- Multi-core scaling tests (2, 4, 6 cores)
- Backend comparison benchmarks

### Changed

#### Breaking Changes
- **PostgreSQL**: Replaced `pg` package with `postgres` package
  - Migration: Update imports and connection strings
  - Benefits: Better performance, unified API with Bun
- **Backend type**: Added `'redis'` to backend union type
  - All backend configurations now support 5 options: `'memory' | 'sqlite' | 'pglite' | 'postgresql' | 'redis'`

#### Improvements
- Cleaner repository structure (moved docs to `docs/` folder)
- Removed temporary markdown files from root
- Better .gitignore patterns for test artifacts
- Improved error messages across all backends

### Fixed
- PostgreSQL FOR UPDATE SKIP LOCKED now works correctly on Node.js
- Connection handling improvements in PostgreSQL backend
- Type safety improvements across all backends

### Performance
- Redis: 10,000-50,000 jobs/sec (new)
- PostgreSQL: Improved with `postgres` package
- SQLite: 10,000-50,000 jobs/sec (verified)
- PGLite: 1,000-10,000 jobs/sec (varies by config)
- Memory: 100,000+ jobs/sec (unchanged)

## [1.0.0] - Previous Release

### Features
- Memory backend (in-memory queue)
- SQLite backend (file-based persistence)
- PGLite backend (WebAssembly PostgreSQL)
- PostgreSQL backend (with TimescaleDB support)
- WebSocket-based distributed workers
- Channel routing for hierarchical messaging
- Meta envelope for workflow support
- Job recovery system
- Factory pattern for better testability
- TypeScript-first with full type safety

---

## Migration Guide: v1.x to v2.0

### PostgreSQL Users

If you're using PostgreSQL backend, you need to update your dependencies:

```bash
# Remove old package
npm uninstall pg @types/pg

# Install new package
npm install postgres
```

No code changes required - the API remains the same.

### Redis Users (New)

To use the new Redis backend:

```bash
npm install ioredis
```

```typescript
import { createTaskManager } from "@alcyone-labs/workalot";

const manager = await createTaskManager("main", {
  backend: "redis",
  databaseUrl: "redis://localhost:6379",
  redisConfig: {
    keyPrefix: "workalot",
    completedJobTTL: 86400, // 24 hours
    failedJobTTL: 604800, // 7 days
  },
});
```

### All Users

- Update TypeScript types if you're using backend type annotations
- Review backend selection based on new comparison table
- Consider Redis for high-throughput use cases

---

## Roadmap

### v2.1.0 (Planned)
- [ ] Scheduled jobs (cron-like)
- [ ] Job dependencies
- [ ] Dead letter queue
- [ ] Enhanced monitoring/metrics
- [ ] Prometheus metrics export

### v2.2.0 (Planned)
- [ ] Job result streaming
- [ ] Circuit breaker pattern
- [ ] Rate limiting
- [ ] Job priorities (enhanced)

### Future
- [ ] GraphQL API
- [ ] Web UI for monitoring
- [ ] Multi-tenant support
- [ ] Job versioning

