# WebSocket Architecture Configuration

## Orchestrator Configuration

```typescript
const orchestrator = new SimpleOrchestrator({
  wsPort: 8080, // WebSocket server port
  wsHostname: "0.0.0.0", // Bind to all interfaces
  distributionStrategy: "round-robin", // or "random"
  queueConfig: {
    backend: "sqlite",
    databaseUrl: "./orchestrator.db",
    maxThreads: 8,
  },
});
```

### Port Selection

```typescript
// Development port (avoid conflicts with other services)
const devPort = 8080;

// Production port (may use 80 or custom)
const prodPort = parseInt(process.env.WS_PORT || "8080");
```

### Worker Distribution Strategy

```typescript
// Round-robin: Workers 1, 2, 3, 1, 2, 3...
distributionStrategy: "round-robin";

// Random: Workers 3, 1, 2, 3, 2, 1...
distributionStrategy: "random";
```

## Worker Configuration

```typescript
const worker = new SimpleWorker({
  workerId: 1, // Unique identifier
  wsUrl: "ws://localhost:8080/worker",
  projectRoot: process.cwd(), // Job file resolution
  defaultTimeout: 30000, // 30 seconds
});
```

### Worker ID Assignment

```typescript
// Sequential IDs
const worker1 = new SimpleWorker({ workerId: 1 /* ... */ });
const worker2 = new SimpleWorker({ workerId: 2 /* ... */ });

// Or use process ID for containers
const containerWorkerId = parseInt(process.env.CONTAINER_INDEX || "0");
```

### Project Root Resolution

```typescript
// Development
projectRoot: process.cwd();

// Production (Docker)
projectRoot: "/app";

// Production (filesystem)
projectRoot: "/var/lib/workalot";
```

## Channel Routing Configuration

```typescript
server.registerChannelRoute({
  // Define channel patterns
  channelPatterns: ["workflow/*", "monitoring/*"],
  handler: (connection, message) => {
    /* handler */
  },
});
```

## Connection Configuration

### WebSocket URL Format

```typescript
// Local development
wsUrl: "ws://localhost:8080/worker";

// Production (domain)
wsUrl: "ws://worker.example.com:8080/worker";

// Production (load balancer)
wsUrl: "ws://lb.example.com/worker";

// Production (SSL/TLS)
wsUrl: "wss://worker.example.com:8443/worker";
```

### Connection Timeout

```typescript
// Workers reconnect with exponential backoff
// Reconnection delays: 1s, 2s, 4s, 8s, 16s (max)
// Total connection timeout: ~30 seconds before giving up
```

### Heartbeat Configuration

```typescript
// Workers send heartbeat every 30 seconds
const HEARTBEAT_INTERVAL = 30000;

// Workers marked as offline after 60 seconds without heartbeat
const WORKER_OFFLINE_TIMEOUT = 60000;
```

## Queue Configuration with WebSocket

```typescript
const orchestrator = new SimpleOrchestrator({
  wsPort: 8080,
  queueConfig: {
    // Backend selection
    backend: "sqlite", // or postgresql/redis

    // Database connection
    databaseUrl: "./orchestrator.db",

    // Worker scaling
    maxThreads: 8,

    // Job recovery
    jobRecoveryEnabled: true,

    // Monitoring
    healthCheckInterval: 10000,
    silent: true,
  },
});
```

## Performance Tuning

### Worker Count Optimization

```typescript
const cpuCount = require("os").cpus().length;

// Optimal for most workloads
const optimalWorkers = cpuCount - 2;

// For I/O-bound workloads
const ioBoundWorkers = cpuCount; // Use all cores

// For CPU-bound workloads
const cpuBoundWorkers = cpuCount - 1; // Leave core for orchestrator
```

### Job Timeout Configuration

```typescript
// Fast jobs (<1 second)
const fastJobTimeout = 5000;

// Normal jobs (1-10 seconds)
const normalJobTimeout = 30000;

// Long jobs (10-60 seconds)
const longJobTimeout = 60000;
```

### Buffer Configuration

```typescript
// WebSocket message buffer size
const WS_BUFFER_SIZE = 1024 * 1024; // 1MB

// Flush interval
const WS_FLUSH_INTERVAL = 100; // 100ms
```

## Error Handling Configuration

### Connection Retry Strategy

```typescript
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000; // 1 second

// Workers use exponential backoff
// Orchestrator accepts connections automatically
```

### Job Failure Handling

```typescript
// Max job retries before dead letter queue
const MAX_JOB_RETRIES = 3;

// Failed job TTL before escalation
const FAILED_JOB_TTL = 604800; // 7 days
```

### Circuit Breaker Configuration

```typescript
// Open circuit after N consecutive failures
const CIRCUIT_BREAKER_THRESHOLD = 5;

// Close circuit for 60 seconds
const CIRCUIT_RECOVERY_TIMEOUT = 60000;
```

## Monitoring Configuration

### Metrics Collection

```typescript
// Track job completion times
const METRICS_ENABLED = true;

// Track worker utilization
const UTILIZATION_ENABLED = true;

// Track error rates
const ERROR_TRACKING_ENABLED = true;
```

### Alert Thresholds

```typescript
// Queue depth alert
const QUEUE_DEPTH_ALERT = 1000;

// Worker utilization alert
const WORKER_UTILIZATION_ALERT = 0.9; // 90%

// Error rate alert
const ERROR_RATE_ALERT = 0.1; // 10% error rate
```

## Security Configuration

### Authentication (Future)

```typescript
// WebSocket authentication tokens (planned feature)
const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN;
```

### Rate Limiting

```typescript
// Max jobs per worker
const MAX_JOBS_PER_WORKER = 10;

// Max connections per IP
const MAX_CONNECTIONS_PER_IP = 100;
```

### Input Validation

```typescript
// Validate job payload size
const MAX_JOB_PAYLOAD_SIZE = 1024 * 1024; // 1MB

// Validate job file path
const JOB_PATH_PATTERN = /^[a-zA-Z0-9_/-]+\.ts$/;
```
