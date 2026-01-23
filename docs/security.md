# Security Best Practices

This guide covers security considerations for Workalot deployments.

## Environment Variables

Never hardcode credentials. Use environment variables:

```typescript
// BAD
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: "postgresql://admin:secret123@localhost:5432/workalot",
});

// GOOD
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: process.env.DATABASE_URL,
});
```

### Required Environment Variables

| Variable       | Description                  | Required For       |
| -------------- | ---------------------------- | ------------------ |
| `DATABASE_URL` | PostgreSQL connection string | PostgreSQL backend |
| `REDIS_URL`    | Redis connection string      | Redis backend      |
| `NODE_ENV`     | Environment name             | All backends       |

### Example .env File

```bash
# .env.example
DATABASE_URL=postgresql://user:pass@localhost:5432/workalot
REDIS_URL=redis://localhost:6379
NODE_ENV=production
```

## Job File Security

### Path Validation

Job files are resolved relative to the project root. Ensure users cannot schedule arbitrary files:

```typescript
import { basename, join } from "node:path";
import { constants } from "node:fs";

async function validateJobFile(jobFile: string): Promise<void> {
  const safeName = basename(jobFile);

  // Ensure file is within jobs directory
  const resolvedPath = join("/app/jobs", safeName);

  // Check file exists and is within allowed directory
  try {
    await access(resolvedPath, constants.R_OK);
  } catch {
    throw new Error("Invalid job file path");
  }

  // Ensure no directory traversal
  if (jobFile.includes("..") || jobFile.includes("/.")) {
    throw new Error("Invalid job file path");
  }
}
```

### Job Isolation

Jobs run in worker threads, providing process isolation:

```typescript
const manager = new TaskManager({
  maxThreads: 4, // Each job runs in its own thread
});
```

## Database Security

### PostgreSQL

1. **Use SSL connections**:

```typescript
const manager = new TaskManager({
  backend: "postgresql",
  databaseUrl: "postgresql://user:pass@host/db?sslmode=require",
});
```

2. **Create dedicated database user**:

```sql
CREATE USER workalot WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE workalot_db TO workalot;
GRANT USAGE ON SCHEMA public TO workalot;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO workalot;
```

3. **Enable connection pooling** with PgBouncer:

```yaml
# pgbouncer.ini
[databases]
workalot_db = host=localhost port=5432 dbname=workalot_db

[pgbouncer]
pool_mode = transaction
max_client_conn = 100
default_pool_size = 20
```

### Redis

1. **Enable authentication**:

```bash
# redis.conf
requirepass your_redis_password
```

2. **Use TLS connections**:

```typescript
const manager = new TaskManager({
  backend: "redis",
  databaseUrl: "rediss://:password@host:6379", // rediss:// for TLS
});
```

3. **Limit key access** with ACLs:

```bash
# redis.acl
user workalot on #password ~workalot:* +@all -@dangerous
```

## WebSocket Security

The WebSocket server supports optional security measures:

```typescript
const wsServer = new WebSocketServer({
  port: 8080,
  enableMessageRecovery: true,
  enableHeartbeat: true,
  pingInterval: 30000,
});
```

### Authentication Middleware

```typescript
wsServer.registerRoute({
  pattern: "execute_job",
  handler: async (connection, message) => {
    const token = extractToken(connection);

    if (!(await validateToken(token))) {
      connection.ws.close(4001, "Unauthorized");
      return;
    }

    // Process job...
  },
});
```

### Rate Limiting

```typescript
class WebSocketRateLimiter {
  private connections = new Map<string, { count: number; resetTime: number }>();

  allow(connectionId: string): boolean {
    const now = Date.now();
    const window = 60000; // 1 minute
    const limit = 100; // 100 messages per minute

    const data = this.connections.get(connectionId);

    if (!data || now > data.resetTime) {
      this.connections.set(connectionId, { count: 1, resetTime: now + window });
      return true;
    }

    if (data.count >= limit) {
      return false;
    }

    data.count++;
    return true;
  }
}
```

## Input Validation

All job payloads should be validated:

```typescript
import { z } from "zod";

const JobPayloadSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["process", "delete", "update"]),
  data: z.object({
    field1: z.string().min(1).max(1000),
    field2: z.number().int().positive(),
  }),
});

export class ValidatedJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const result = JobPayloadSchema.safeParse(payload);

    if (!result.success) {
      return this.createErrorResult("Invalid payload", {
        errors: result.error.errors,
      });
    }

    // Process validated payload
    const { userId, action, data } = result.data;
    // ...
  }
}
```

## Secrets Management

### Don't Log Sensitive Data

```typescript
// BAD - Sensitive data in logs
console.log("Processing job with payload:", payload);
// payload may contain passwords, tokens, etc.

// GOOD - Sanitized logging
console.log("Processing job:", {
  jobId: payload.jobId,
  userId: payload.userId,
  // Don't log sensitive fields
});
```

### Mask in Results

```typescript
export class SecureJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const { apiKey, ...safePayload } = payload;

    const result = await this.callApi(payload);

    return {
      success: true,
      data: {
        // Never include apiKey in results
        response: result.data,
      },
    };
  }
}
```

## Worker Security

### Worker Thread Isolation

Workers run in separate threads, providing memory isolation:

```typescript
const manager = new TaskManager({
  maxThreads: 4, // Each worker is isolated
});
```

### Worker Timeout Protection

Prevent infinite loops and resource exhaustion:

```typescript
const manager = new TaskManager({
  // Default timeout
  // Jobs exceeding this are terminated
});
```

## Network Security

### Firewall Rules

```bash
# Allow only necessary ports
# PostgreSQL: 5432 (internal network only)
# Redis: 6379 (internal network only)
# WebSocket: 8080 (if using distributed workers)

# Example ufw rules
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow from 10.0.0.0/8 to any port 5432 # PostgreSQL
ufw allow from 10.0.0.0/8 to any port 6379 # Redis
```

### TLS/HTTPS

For web interfaces accessing Workalot:

```typescript
import { Elysia } from "elysia";

const app = new Elysia().listen({
  port: 443,
  tls: {
    cert: await readFile("./cert.pem"),
    key: await readFile("./key.pem"),
  },
});
```

## Security Checklist

- [ ] Use environment variables for all secrets
- [ ] Enable SSL/TLS for database connections
- [ ] Validate all job payloads
- [ ] Implement path validation for job files
- [ ] Set appropriate job timeouts
- [ ] Enable worker health checks
- [ ] Implement rate limiting on APIs
- [ ] Log without sensitive data
- [ ] Mask secrets in job results
- [ ] Use connection pooling with limits
- [ ] Enable audit logging
- [ ] Regular security updates
- [ ] Network segmentation

## Monitoring for Security Events

```typescript
const securityMonitor = new EventEmitter();

securityMonitor.on("rate-limit-exceeded", (connectionId: string) => {
  alertService.sendSecurityAlert("Rate limit exceeded", { connectionId });
});

securityMonitor.on("failed-auth", (connectionId: string) => {
  alertService.sendSecurityAlert("Authentication failed", { connectionId });
});

securityMonitor.on("unusual-activity", (data: any) => {
  alertService.sendSecurityAlert("Unusual activity detected", data);
});
```
