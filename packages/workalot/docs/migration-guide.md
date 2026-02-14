# Migration Guide: postMessage to WebSocket

## Overview

Starting with version 2.0.0, Workalot is transitioning from Node.js Worker threads with `postMessage` communication to a WebSocket-based architecture. This change brings better scalability, consistency, and feature parity across all components.

## Why the Change?

The postMessage-based system had several limitations:
- **Dual communication systems** created complexity and confusion
- **Platform-specific** to Node.js Worker threads
- **Limited scalability** for distributed systems
- **Inconsistent APIs** between WorkerManager and BaseOrchestrator
- **Testing complexity** due to Worker thread requirements

The WebSocket-based approach provides:
- **Unified communication** across all components
- **Platform flexibility** (works in browsers, Deno, Bun, etc.)
- **Better scalability** for distributed deployments
- **Consistent APIs** throughout the codebase
- **Easier testing** with mock WebSocket connections

## Deprecation Notice

### Deprecated Components
- `WorkerManager` (postMessage-based) - Will be removed in v3.0.0
- `worker.ts` (Worker thread implementation) - Will be removed in v3.0.0

### Recommended Replacements
- Use `WorkerManagerWS` instead of `WorkerManager`
- Use `SimpleWorker` or `BaseWorker` with WebSocket communication
- Use `SimpleOrchestrator` or `BaseOrchestrator` for orchestration

## Migration Steps

### Step 1: Update WorkerManager Usage

#### Before (postMessage)
```typescript
import { WorkerManager, QueueOrchestrator } from 'workalot';

const orchestrator = new QueueOrchestrator({
  backend: 'sqlite',
  databaseUrl: './queue.db'
});

const workerManager = new WorkerManager(orchestrator, {
  numWorkers: 4,
  projectRoot: process.cwd(),
  silent: false
});

await workerManager.initialize();

// Execute job
const result = await workerManager.executeJob({
  id: 'job-1',
  type: 'ProcessData',
  payload: { data: 'test' }
});
```

#### After (WebSocket)
```typescript
import { WorkerManagerWS, QueueOrchestrator } from 'workalot';

const orchestrator = new QueueOrchestrator({
  backend: 'sqlite',
  databaseUrl: './queue.db'
});

const workerManager = new WorkerManagerWS(orchestrator, {
  numWorkers: 4,
  projectRoot: process.cwd(),
  silent: false,
  wsPort: 8080,
  wsHostname: 'localhost'
});

await workerManager.initialize();

// Execute job - API remains the same!
const result = await workerManager.executeJob({
  id: 'job-1',
  type: 'ProcessData',
  payload: { data: 'test' }
});
```

### Step 2: Create WebSocket Workers

#### Before (Worker threads)
Workers were automatically created by WorkerManager using Node.js Worker threads.

#### After (WebSocket Workers)
You need to explicitly create worker processes that connect via WebSocket:

```typescript
// worker-process.ts
import { SimpleWorker } from 'workalot';

const worker = new SimpleWorker({
  workerId: parseInt(process.env.WORKER_ID || '1'),
  wsUrl: 'ws://localhost:8080/worker',
  projectRoot: process.cwd(),
  defaultTimeout: 30000
});

// Start the worker
await worker.start();

// Worker will now:
// 1. Connect to the orchestrator
// 2. Execute jobs as they're assigned
// 3. Report results back

// Keep the process running
process.on('SIGINT', async () => {
  await worker.stop();
  process.exit(0);
});
```

### Step 3: Simplified Architecture Options

For simpler use cases, consider using the new simplified components:

#### Using SimpleOrchestrator and SimpleWorker
```typescript
// orchestrator.ts
import { SimpleOrchestrator } from 'workalot';

const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: {
    backend: 'sqlite',
    databaseUrl: './queue.db'
  }
});

await orchestrator.start();

// Add jobs
await orchestrator.addJob({
  id: 'job-1',
  type: 'ProcessData',
  payload: { data: 'test' }
});

// worker.ts (separate process)
import { SimpleWorker } from 'workalot';

const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: 'ws://localhost:8080/worker'
});

await worker.start();
```

### Step 4: Update Task Manager Usage

If using the high-level TaskManager API, consider switching from singleton to factory pattern:

#### Before (Singleton)
```typescript
import { taskManager } from 'workalot';

await taskManager.initialize({
  backend: 'sqlite',
  databaseUrl: './queue.db'
});

const result = await taskManager.scheduleAndWait({
  type: 'ProcessData',
  payload: { data: 'test' }
});

await taskManager.shutdown();
```

#### After (Factory - Recommended)
```typescript
import { TaskManagerFactory } from 'workalot';

const factory = new TaskManagerFactory();
const taskManager = await factory.create('main', {
  backend: 'sqlite',
  databaseUrl: './queue.db'
});

const result = await taskManager.scheduleAndWait({
  type: 'ProcessData',
  payload: { data: 'test' }
});

await factory.destroy('main');
```

## Configuration Changes

### WorkerManager Configuration

#### Old Configuration (postMessage)
```typescript
interface WorkerManagerConfig {
  numWorkers?: number;
  projectRoot?: string;
  silent?: boolean;
  healthCheckInterval?: number;
  jobTimeout?: number;
  batchTimeout?: number;
}
```

#### New Configuration (WebSocket)
```typescript
interface WorkerManagerConfig {
  numWorkers?: number;        // Still supported
  projectRoot?: string;        // Still supported
  silent?: boolean;           // Still supported
  wsPort?: number;            // NEW: WebSocket port
  wsHostname?: string;        // NEW: WebSocket hostname
  enableHealthCheck?: boolean; // NEW: Explicit health check toggle
  healthCheckInterval?: number; // Still supported
  jobTimeout?: number;         // Still supported
  batchTimeout?: number;       // Still supported
}
```

## Deployment Considerations

### Process Management

With WebSocket-based workers, you need to manage worker processes separately:

#### Using PM2
```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'orchestrator',
      script: './dist/orchestrator.js',
      instances: 1
    },
    {
      name: 'worker',
      script: './dist/worker.js',
      instances: 4,
      env: {
        WORKER_ID: '0'  // PM2 will increment this
      }
    }
  ]
};
```

#### Using Docker Compose
```yaml
version: '3.8'

services:
  orchestrator:
    build: .
    command: node dist/orchestrator.js
    ports:
      - "8080:8080"

  worker:
    build: .
    command: node dist/worker.js
    environment:
      - WORKER_ID=${WORKER_ID}
      - WS_URL=ws://orchestrator:8080/worker
    deploy:
      replicas: 4
```

### Scaling Advantages

The WebSocket approach enables better scaling patterns:

1. **Horizontal Scaling**: Workers can run on different machines
2. **Dynamic Scaling**: Add/remove workers without restarting orchestrator
3. **Load Balancing**: Distribute workers across multiple orchestrators
4. **Cloud Native**: Better suited for Kubernetes and container orchestration

## Testing Changes

### Before (Worker Threads)
```typescript
// Testing was complex due to Worker thread requirements
import { Worker } from 'worker_threads';

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn()
  }))
}));
```

### After (WebSocket)
```typescript
// Testing is simpler with WebSocket mocks
import { WebSocketServer } from 'workalot';

// Use in-memory WebSocket for testing
const testServer = new WebSocketServer({
  port: 0, // Random port
  hostname: 'localhost'
});

// Or use SimpleWorker in-process for testing
const worker = new SimpleWorker({
  workerId: 1,
  wsUrl: 'ws://localhost:8080/test'
});
```

## Benefits of Migration

### Immediate Benefits
- **Consistent API**: Same communication pattern everywhere
- **Better debugging**: WebSocket traffic can be inspected with standard tools
- **Platform flexibility**: Not tied to Node.js Worker threads
- **Simplified testing**: No Worker thread mocking complexity

### Future Benefits
- **Distributed workers**: Run workers on different machines/containers
- **Browser support**: Potential for browser-based workers
- **Protocol extensions**: Easy to add custom message types
- **Monitoring**: Standard WebSocket monitoring tools work

## Backward Compatibility

### Maintaining Compatibility During Transition

If you need to maintain both systems during migration:

```typescript
// Use environment variable to switch
const useWebSocket = process.env.USE_WEBSOCKET === 'true';

const manager = useWebSocket
  ? new WorkerManagerWS(orchestrator, config)
  : new WorkerManager(orchestrator, config);

await manager.initialize();
// API is the same for both
```

### Gradual Migration Strategy

1. **Phase 1**: Update to latest version with both systems available
2. **Phase 2**: Switch non-critical workflows to WebSocket
3. **Phase 3**: Migrate critical workflows after testing
4. **Phase 4**: Remove postMessage dependencies

## Common Issues and Solutions

### Issue 1: Workers Not Connecting
```typescript
// Ensure orchestrator is started before workers
await orchestrator.start();
// Wait a moment for server to be ready
await new Promise(resolve => setTimeout(resolve, 1000));
// Then start workers
```

### Issue 2: Connection Drops
```typescript
// SimpleWorker has auto-reconnect enabled by default
// For custom workers, ensure reconnection logic:
const worker = new BaseWorker({
  // ... config
  enableAutoReconnect: true,
  reconnectInterval: 5000
});
```

### Issue 3: Performance Differences
```typescript
// WebSocket has slight overhead, batch operations for better performance
const results = await workerManager.executeBatchJobs(jobs);
// Instead of individual job execution
```

## Support and Resources

- **Documentation**: See the updated API documentation
- **Examples**: Check `examples/websocket/` directory
- **Migration Support**: Open an issue with the `migration` label
- **Community**: Join our Discord for migration help

## Timeline

- **v2.0.0** (Current): Both systems available, postMessage deprecated
- **v2.x**: Bug fixes and improvements to WebSocket system
- **v3.0.0** (Q2 2024): postMessage system removed entirely

## Conclusion

The migration from postMessage to WebSocket is designed to be straightforward while providing significant architectural improvements. The API remains largely unchanged, making the transition smooth for most use cases.

For complex migrations or custom Worker implementations, please refer to the advanced migration examples in the `examples/migration/` directory.
