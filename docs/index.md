# Workalot v2.0.0 Documentation

Workalot is a high-performance, multi-backend job queue system designed for modern distributed applications. It provides a clean, type-safe API for scheduling and executing background jobs with support for multiple storage backends and worker configurations.

## Core Philosophy

Workalot follows several key design principles that guide its architecture and API design:

- **Multi-threaded Performance**: Uses worker threads for CPU-intensive jobs, maximizing throughput on modern multi-core systems.
- **Factory Pattern**: Prefer explicit instance creation over singletons for better testability and lifecycle management.
- **Type Safety**: Strict TypeScript with explicit types for all public APIs.
- **Backend Agnostic**: Memory, SQLite, PostgreSQL, Redis, and PGLite backends are interchangeable through a common interface.
- **Async/Await Only**: Eliminates callback hell with modern async patterns.
- **WebSocket Communication**: v2.x uses WebSocket for distributed worker communication.

## Quick Start

```typescript
import { TaskManager } from "workalot";

const manager = new TaskManager({ backend: "memory" });
await manager.initialize();

const result = await manager.scheduleAndWait({
  jobFile: "jobs/MyJob.ts",
  jobPayload: { data: "example" },
});

await manager.shutdown();
```

## Documentation Structure

| Document                                        | Description                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| [Getting Started](getting-started.md)           | Installation, basic concepts, and your first job            |
| [Architecture](architecture.md)                 | System design, component relationships, and data flow       |
| [API Reference](api-reference.md)               | Complete API documentation for all public interfaces        |
| [Job Creation Guide](job-creation-guide.md)     | How to create, validate, and structure job classes          |
| [Storage Backends](storage-backends.md)         | Comparison of Memory, SQLite, PostgreSQL, Redis, and PGLite |
| [Worker Configuration](worker-configuration.md) | Tuning workers for optimal performance                      |
| [Deployment Scenarios](deployment-scenarios.md) | Best practices for local, single-VM, and distributed setups |
| [TypeScript Types](typescript-types.md)         | Complete type definitions and interfaces                    |
| [Error Handling](error-handling.md)             | Patterns for handling failures, timeouts, and retries       |
| [Security Best Practices](security.md)          | Securing your Workalot deployment                           |
| [Performance Optimization](performance.md)      | Tuning for high throughput and low latency                  |
| [Migration Guide](migration-guide.md)           | Upgrading from v1.x to v2.x                                 |
