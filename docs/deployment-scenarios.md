# Deployment Scenarios

This guide covers deployment best practices for different infrastructure configurations.

## Local Development

Best for development, testing, and iteration.

### Configuration

```typescript
import { TaskManagerFactoryPresets } from "workalot";

const factory = TaskManagerFactoryPresets.development();
// Equivalent to:
const factory = new TaskManagerFactory({
  backend: "memory",
  maxThreads: 2,
  silent: false,
  jobRecoveryEnabled: false,
});

const manager = await factory.create("dev");
```

### Characteristics

| Aspect   | Setting                           |
| -------- | --------------------------------- |
| Backend  | Memory (fastest)                  |
| Workers  | 2 (leaves headroom for dev tools) |
| Recovery | Disabled (faster iteration)       |
| Logging  | Enabled (debugging)               |

### Setup

```bash
# Create development database directory
mkdir -p data

# Run with hot reload
bun run --watch src/index.ts
```

### Advantages

- Fast job scheduling
- Easy debugging
- No external dependencies
- Quick startup time

### Disadvantages

- Jobs lost on restart
- Cannot test persistence scenarios
- Single-process only

### Best Practices

1. Use `silent: false` to see worker output
2. Keep `maxThreads` low for better debugging experience
3. Test with SQLite periodically to catch persistence bugs
4. Use `whenIdle()` for cleanup operations

## Single VM / Server

Production deployment on a single machine.

### SQLite Configuration

```typescript
import { TaskManagerFactoryPresets } from "workalot";

const factory = TaskManagerFactoryPresets.productionSQLite("./data/queue.db");
```

**Full Configuration:**

```typescript
const manager = await new TaskManager({
  backend: "sqlite",
  databaseUrl: "./data/queue.db",
  maxThreads: Math.max(2, os.cpus().length - 2),
  silent: false,
  jobRecoveryEnabled: true,
  healthCheckInterval: 30000,
  enableWAL: true,
}).initialize();
```

### PostgreSQL Configuration

```typescript
const factory = TaskManagerFactoryPresets.productionPostgreSQL(process.env.DATABASE_URL);
```

### Server Specifications

| Workload | CPU Cores | Memory | Storage   |
| -------- | --------- | ------ | --------- |
| Light    | 2-4       | 2GB    | 20GB SSD  |
| Medium   | 4-8       | 4GB    | 50GB SSD  |
| Heavy    | 8-16      | 8GB    | 100GB SSD |

### Thread Allocation

```typescript
const numCpus = os.cpus().length;
const maxThreads = Math.max(2, numCpus - 2); // Reserve 2 cores
```

### Directory Structure

```
/app/
├── data/
│   └── queue.db           # SQLite database
├── jobs/
│   └── *.ts              # Job files
├── src/
│   └── index.ts          # Application entry
├── package.json
└── pm2.config.js         # Process manager config
```

### Process Management (PM2)

```javascript
// pm2.config.js
module.exports = {
  apps: [
    {
      name: "workalot-app",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
```

```bash
pm2 start pm2.config.js
pm2 logs workalot-app
pm2 monit
```

### Health Checks

```typescript
const manager = new TaskManager({
  healthCheckInterval: 30000, // 30 seconds
});

// Check health endpoint
app.get("/health", async (req, res) => {
  const status = await manager.getStatus();
  const stats = await manager.getQueueStats();

  res.json({
    status: status.isInitialized ? "healthy" : "unhealthy",
    queue: stats,
    workers: status.workers,
  });
});
```

### Monitoring

```typescript
setInterval(async () => {
  const stats = await manager.getQueueStats();
  console.log({
    pending: stats.pending,
    processing: stats.processing,
    completed: stats.completed,
    failed: stats.failed,
  });
}, 60000); // Every minute
```

## Distributed (Multiple VMs)

Horizontal scaling across multiple machines.

### Architecture Patterns

#### Shared Queue Pattern

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                         │
└─────────────────────────────────────────────────────────┘
          │                │                │
    ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
    │  VM 1     │    │  VM 2     │    │  VM 3     │
    │ ┌───────┐ │    │ ┌───────┐ │    │ ┌───────┐ │
    │ │Workers│ │    │ │Workers│ │    │ │Workers│ │
    │ └───┬───┘ │    │ └───┬───┘ │    │ └───┬───┘ │
    └─────┼─────┘    └─────┼─────┘    └─────┼─────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────┴──────┐
                    │    Redis    │
                    │   Queue     │
                    └─────────────┘
```

**Configuration:**

```typescript
// On each VM
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: process.env.REDIS_URL,
  maxThreads: 8,
  silent: true,
  jobRecoveryEnabled: true,
});
```

#### Coordinator Pattern

```
┌─────────────────────────────────────────────────────────┐
│                    Coordinator VM                        │
                    ┌─────────────────┐
                    │  Job Scheduler  │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    ┌─────┴─────┐      ┌─────┴─────┐      ┌─────┴─────┐
    │  Worker   │      │  Worker   │      │  Worker   │
    │  VM 1     │      │  VM 2     │      │  VM 3     │
    └───────────┘      └───────────┘      └───────────┘
                    PostgreSQL
```

**Configuration:**

```typescript
// Coordinator
const scheduler = new JobScheduler(postgresQueue, config);

// Workers (on each VM)
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
});
```

### Network Considerations

#### Redis Clustering

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: "redis://redis-cluster:6379",
});

// For true cluster mode, use redis-cluster client directly
import Redis from "ioredis";

const cluster = new Redis.Cluster([
  { host: "node1.redis", port: 6379 },
  { host: "node2.redis", port: 6379 },
  { host: "node3.redis", port: 6379 },
]);
```

#### PostgreSQL Connection Pooling

```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Use pool with Workalot
const manager = new TaskManager({
  backend: "postgresql",
  // Custom connection handling if needed
});
```

### VM Count Recommendations

| Job Rate | VMs | Workers/VM | Total Workers |
| -------- | --- | ---------- | ------------- |
| 100/sec  | 2   | 4          | 8             |
| 500/sec  | 4   | 6          | 24            |
| 1000/sec | 6   | 8          | 48            |
| 5000/sec | 10  | 10         | 100           |

### Auto-Scaling

```typescript
import { EventEmitter } from "events";

class AutoScaler extends EventEmitter {
  private minVMs = 2;
  private maxVMs = 10;
  private scaleUpThreshold = 100; // Queue depth
  private scaleDownThreshold = 10;

  async checkAndScale(queueStats: QueueStats): Promise<number> {
    if (queueStats.pending > this.scaleUpThreshold) {
      return this.scaleUp();
    }
    if (queueStats.pending < this.scaleDownThreshold) {
      return this.scaleDown();
    }
    return this.getCurrentVMCount();
  }
}

// Usage
const scaler = new AutoScaler();

setInterval(async () => {
  const stats = await manager.getQueueStats();
  await scaler.checkAndScale(stats);
}, 30000);
```

### Cross-Region Deployment

For multi-region deployments, use:

1. **Redis with pub/sub** for real-time coordination
2. **PostgreSQL with read replicas** for load distribution
3. **Job affinity** for region-specific jobs

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: process.env.REDIS_URL,
});

manager.on("job-scheduled", (jobId) => {
  // Route job to appropriate region
});
```

## Docker Deployment

### Dockerfile

```dockerfile
FROM oven/bun:1.0

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
```

### Docker Compose

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@db:5432/workalot
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "2"
          memory: 2G

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: workalot
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 4G

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: 1G

volumes:
  postgres_data:
  redis_data:
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workalot
spec:
  replicas: 3
  selector:
    matchLabels:
      app: workalot
  template:
    metadata:
      labels:
        app: workalot
    spec:
      containers:
        - name: workalot
          image: workalot:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: workalot-secrets
                  key: database-url
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2"
---
apiVersion: v1
kind: Service
metadata:
  name: workalot
spec:
  selector:
    app: workalot
  ports:
    - port: 80
      targetPort: 3000
  type: LoadBalancer
```

## Sweet Spot Recommendations

| Scenario         | Backend    | Workers  | VM Count |
| ---------------- | ---------- | -------- | -------- |
| Personal project | Memory     | 2        | 1        |
| Small web app    | SQLite     | 4        | 1        |
| SaaS startup     | PostgreSQL | 6        | 2-3      |
| E-commerce       | Redis      | 8        | 3-5      |
| High-volume API  | Redis      | 12       | 5-10     |
| Data pipeline    | PostgreSQL | 16       | 4-6      |
| Event processing | Redis      | 8 per VM | 6-12     |

## Pitfalls to Avoid

### Local Development

1. **Don't use production data** - Use test data
2. **Don't forget to clear queue** between test runs
3. **Don't test with Memory only** - Test persistence scenarios

### Single VM

1. **Don't exceed available cores** - Causes context switching overhead
2. **Don't use Memory backend** - Jobs lost on restart
3. **Don't skip health checks** - Hard to detect issues

### Distributed

1. **Don't use SQLite** - Not designed for multi-machine
2. **Don't ignore network latency** - Choose regional Redis/PostgreSQL
3. **Don't over-scale workers** - Diminishing returns
4. **Don't forget connection pooling** - Database exhaustion
5. **Don't mix backends** - Use consistent backend across all VMs
