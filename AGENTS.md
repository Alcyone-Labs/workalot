# Workalot Development Guidelines

Current Framework Version: 2.0.0
Private: false (open-source library)

## Development Philosophy

**Workalot Golden Rules**

- Multi-threaded performance over single-threaded simplicity - Use worker threads for CPU-intensive jobs
- Factory pattern over singleton - TaskManagerFactory provides better testability and lifecycle management
- Type safety over flexibility - Strict TypeScript with explicit types for all public APIs
- Backend-agnostic design - Support memory, SQLite, PostgreSQL, Redis, PGLite backends interchangeably
- No callbacks, async/await only - Eliminate callback hell with modern async patterns
- WebSocket over postMessage - v2.x uses WebSocket for distributed worker communication

## MCP, Tools and Debug Guidelines

### Sequential Thinking

If you need to structure your thoughts, make use of Sequential Thinking MCP tool.

### Chrome Devtools

If you need to debug a browser-facing feature, make sure to use Chrome DevTools MCP tools to fetch debug information (check the tools list for all the 26 tools).
It is configured to use Helium as a browser so you may point playwright to run on `/Applications/Helium.app/Contents/MacOS/Helium` or simply use `navigate_page` to open the page, then "list_console_message" to fetch console logs.

### Image Understanding

If you need to understand what is in an image, or understand a design to implement it, you can use "zap-mcp-server" MCP tool "analyze_image".

### Web Search

If you need to search something on the web, you may use "ollama_web_search_and_fetch" tool "web_search", it's very good.

### Documentation

If you need to fetch documentation for a public code library, use "mcp-server-context7" MCP, fetch the library ID with "resolve-library-id", then "fetch-library-docs" with the ID you got from the first call.

## Toolchain & Workflow

**Development Tools**

- pnpm - Primary package manager for dependency management and script execution
- Bun.js - Preferred runtime for development and production (Node.js compatible)
- TypeScript - Strict compilation with ES2022 target and bundler module resolution
- Vitest - Testing framework with globals enabled and V8 coverage provider
- tsc-alias - Resolves TypeScript path mapping during build process
- Docker Compose - Local PostgreSQL/TimescaleDB and Redis development setup

## Code Architecture

**Code Standards**

- PascalCase - Classes, interfaces, types (BaseJob, TaskManager, QueueConfig)
- camelCase - Variables, functions, methods (scheduleAndWait, jobPayload)
- UPPER_SNAKE_CASE - Constants and enums (WorkerMessageType, JobStatus)
- Explicit types - All function parameters and returns must be typed
- Factory pattern - TaskManagerFactory for instance creation and lifecycle
- Error boundaries - Custom error classes extending base Error
- ULID generation - Time-sortable unique identifiers for job IDs

## Project Organization

**Repository Structure**

workalot/

- src/ - Core source code
  - api/ - Main API surface (TaskManager, Factory, Singleton)
  - jobs/ - Job system (BaseJob, JobRegistry, JobLoader)
  - queue/ - Queue backends (PostgreSQL, SQLite, Redis, PGLite, Memory)
  - workers/ - Worker management (WorkerManager, JobScheduler, Recovery)
  - orchestration/ - Distributed orchestration (BaseOrchestrator, SimpleOrchestrator)
  - communication/ - WebSocket layer for distributed workers
  - types/ - TypeScript type definitions and interfaces
- tests/ - Vitest test suites
  - \*.test.ts - Unit tests for all major components
  - fixtures/ - Test data and mock objects
- benchmarks/ - Performance testing suite
  - run-benchmarks.ts - Main benchmark runner
  - benchmark-config.ts - Configuration and metrics collection
- examples/ - Usage examples and demos
  - \_jobs/ - Example job implementations
  - features/ - Feature-specific examples
  - full-stack/ - Complete application examples
  - storage-adapters/ - Backend-specific examples
- docs/ - Project documentation
  - Production readiness guide
  - Backend comparison analysis
  - Migration guides between versions
- dist/ - Compiled output (gitignored)
  - Generated JavaScript and type definitions

## Development Workflow

1. Initialize development environment with `pnpm install`
2. Use `pnpm run build` to compile TypeScript and copy migrations
3. Run `pnpm test` for development testing with watch mode
4. Use Bun.js runtime: `bun run examples/in-memory/quick-start.ts`
5. Benchmark with `pnpm run benchmark:quick` for performance validation
6. Test multiple backends using docker-compose services
7. Follow factory pattern - avoid TaskManagerSingleton in new code

## Deployment Guidelines

**Production Setup**

- PostgreSQL - Use TimescaleDB for high-volume scenarios with automatic partitioning
- Redis - For distributed deployments with multiple worker nodes
- SQLite - Single-machine production with file-based persistence
- Memory - High-performance scenarios that can tolerate job loss on restart

**Configuration Presets**

- Development - Memory backend, 2 threads, job recovery disabled
- Testing - Memory backend, 1 thread, silent mode enabled
- Production - PostgreSQL/SQLite backend, system default threads, job recovery enabled
- High Performance - Memory backend, all CPU cores, minimal logging

## Security Considerations

- Database URLs - Use environment variables, never hardcode connection strings
- Worker isolation - Jobs run in separate worker threads for security
- Input validation - BaseJob.validatePayload() enforces required fields
- Timeout protection - Default 5-second job timeout prevents infinite loops
- Error sanitization - Job errors are captured without exposing system details

## Performance Guidelines

- Worker scaling - Default to `os.cpus().length - 2` for optimal performance
- Backend selection - Memory < SQLite < PostgreSQL < Redis (performance order)
- Job batching - Use batch operations for high-throughput scenarios
- Queue monitoring - Implement health checks with 30-60 second intervals
- Resource cleanup - Always call shutdown() for graceful termination
- Thread management - Worker threads are recycled to prevent memory leaks
