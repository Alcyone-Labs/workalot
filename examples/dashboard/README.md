# Workalot Dashboard

A web-based management dashboard for Workalot with real-time monitoring and operational controls.

## Quick Start

### 1. Start a Workalot Server

First, start a Workalot server with the management API enabled:

```bash
cd workalot
bun run examples/in-memory/quick-start.ts
```

Or create a simple server:

```typescript
// server.ts
import { TaskManager } from "./src/api/TaskManager.js";

const taskManager = new TaskManager({ backend: "memory", maxThreads: 4 });
await taskManager.initialize();

// Start a simple API server...
```

### 2. Start the Dashboard Server

The dashboard server proxies requests to your Workalot instance:

```bash
cd workalot
WORKALOT_API_URL=http://localhost:3000 bun run examples/dashboard/standalone-server.ts
```

### 3. Open the Dashboard

Navigate to: http://localhost:3001/dashboard

## Features

### Real-Time Monitoring

- Queue depth and throughput visualization
- Worker health and utilization
- Job status distribution
- Auto-refresh every 5 seconds

### Job Management

- View all jobs with status filtering
- Search by job ID
- Retry failed jobs
- Kill stuck processing jobs
- View job details (payload, errors, timing)

### Queue Controls

- **Drain Queue**: Stop accepting new jobs while existing jobs continue
- **Resume Queue**: Resume accepting new jobs
- **Trigger Recovery**: Manually trigger stalled job recovery

### Worker Monitoring

- Total/available worker count
- Visual worker utilization chart

### OTEL Metrics

- Queue history chart (5m, 15m, 1h, 24h ranges)
- Historical data visualization

## API Endpoints

The dashboard proxies these endpoints to your Workalot instance:

### Jobs

- `GET /api/jobs` - List jobs with pagination
- `GET /api/jobs/:id` - Get job details
- `POST /api/jobs` - Submit new job
- `POST /api/jobs/:id/retry` - Retry failed job
- `POST /api/jobs/:id/kill` - Kill processing job

### Queue

- `GET /api/queue/stats` - Get queue statistics
- `GET /api/queue/history` - Get historical queue data
- `POST /api/queue/drain` - Stop accepting new jobs
- `POST /api/queue/resume` - Resume accepting jobs

### Workers

- `GET /api/workers/stats` - Get worker statistics

### Recovery

- `POST /api/recovery/trigger` - Trigger manual recovery
- `GET /api/recovery/status` - Get recovery status

### System

- `GET /api/health` - Health check
- `GET /api/status` - Complete system status

## Environment Variables

| Variable           | Description                    | Default                 |
| ------------------ | ------------------------------ | ----------------------- |
| `WORKALOT_API_URL` | URL of the Workalot API server | `http://localhost:3000` |
| `PORT`             | Port for dashboard server      | `3001`                  |

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Dashboard UI      │     │   Workalot Server   │
│   (React + CDN)     │────▶│   (Any backend)     │
│   Port: 3001        │     │   Port: 3000        │
└─────────────────────┘     └─────────────────────┘
```

The dashboard uses:

- **React 18** with CDN for instant loading (no build step)
- **Tailwind CSS** for styling
- **Recharts** for data visualization
- **Elysia** for the proxy server

## Development

To modify the dashboard UI, edit `standalone-server.ts` and update the `DASHBOARD_HTML` constant.

For a production deployment, consider:

- Building a proper React app with `vite`
- Adding authentication
- Using a proper WebSocket connection for real-time updates
- Deploying the dashboard behind a reverse proxy

## Screenshots

### Overview

Shows queue stats, worker utilization, and quick actions.

### Jobs List

Filter and search jobs, retry failed jobs, kill stuck jobs.

### Queue History

Visualize queue depth and throughput over time.
