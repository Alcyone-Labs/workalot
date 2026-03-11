# Workalot Web Dashboard - Design Document

## Executive Summary

This document outlines the architecture and design for a comprehensive web-based management dashboard for Workalot. The dashboard provides real-time visibility into job queues, worker health, and OTEL metrics, with smooth management operations for debugging, job recovery, and system control.

**Primary Goals:**

- Real-time monitoring of queue consumption and worker utilization
- Visual insights from OpenTelemetry metrics
- Smooth management experience (draining, restarting, debugging)
- Production-ready operational controls

## System Overview

### Current Workalot Capabilities

**OTEL Metrics Available:**

- `job_queue_duration_ms` - Time jobs spend waiting in queue
- `job_execution_duration_ms` - Job execution time
- `ws_connections` - Active WebSocket connections
- `ws_messages_received/sent` - Message throughput
- `job_queue_duration_ms` - Queue wait time histogram
- `job_execution_duration_ms` - Execution time histogram

**Event Emitter Sources:**

- **TaskManager**: `job-scheduled`, `job-completed`, `job-failed`, `queue-empty`, `queue-not-empty`, `all-workers-busy`, `workers-available`
- **JobScheduler**: `job-started`, `scheduler-idle`, `scheduler-busy`
- **JobRecoveryService**: `jobs-recovered`, `jobs-failed`, `stalled-jobs-found`, `recovery-error`
- **WebSocketServer**: `connection`, `worker-ready`, `worker-disconnected`

**Existing APIs:**

- `getQueueStats()` - Queue statistics (total, pending, processing, completed, failed, oldestPending)
- `getWorkerStats()` - Worker statistics (total, ready, available, busy, worker details)
- `getStatus()` - Overall system status
- `getJobsByStatus(status)` - Retrieve jobs by status
- `recoverStalledJobs()` - Manual recovery trigger

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (SPA)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  React App   │  │   Recharts   │  │   Tailwind   │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
└─────────┼──────────────────┼──────────────────┼────────────────────┘
          │                  │                  │
          │ 1. REST API      │ 2. WebSocket     │ 3. OTEL
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Elysia Backend Server                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Enhanced API Layer (New Endpoints)                       │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  Job Management: retry, kill, details                      │  │
│  │  Queue Management: drain, resume, pause                    │  │
│  │  Worker Management: restart, health, logs                  │  │
│  │  Metrics: OTEL export, historical data                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ TaskManager   │  │JobScheduler   │  │WorkerManager  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ QueueBackend │  │ JobRecovery  │  │WebSocketServer│         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ PostgreSQL   │  │   Redis      │  │  SQLite/PGLite│         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend Stack

**Core Technologies:**

- **Framework**: React 18+ with Vite
- **Routing**: React Router DOM
- **UI Library**: shadcn/ui components (Radix UI + Tailwind)
- **Charts**: Recharts (smooth animations, D3-based)
- **Real-time**: Native WebSocket API + event sourcing pattern
- **State Management**: Zustand (lightweight, devtools)
- **Forms**: React Hook Form + Zod validation
- **Date/Time**: date-fns
- **Icons**: Lucide React

**Why This Stack:**

- Production-ready and well-maintained
- Excellent DX with TypeScript
- Built-in animations and transitions for smooth UX
- Server-side rendering ready (for future Next.js migration)
- Small bundle size and fast runtime

### Backend Enhancements

**New REST API Endpoints:**

```typescript
// Job Management
POST   /api/jobs/:id/retry          // Retry a failed job
POST   /api/jobs/:id/kill           // Terminate a running job
POST   /api/jobs/:id/priority       // Update job priority
GET    /api/jobs/:id               // Get detailed job info
DELETE /api/jobs/clear/:status     // Clear jobs by status

// Queue Management
POST   /api/queue/drain            // Stop accepting new jobs
POST   /api/queue/resume           // Resume accepting jobs
POST   /api/queue/pause           // Pause job processing
GET    /api/queue/history          // Historical queue stats

// Worker Management
POST   /api/workers/:id/restart     // Restart a specific worker
POST   /api/workers/scale/:count    // Scale workers up/down
GET    /api/workers/:id/logs        // Get worker logs

// System Management
POST   /api/recovery/trigger       // Manual recovery trigger
GET    /api/metrics/otel           // OTEL metrics snapshot
GET    /api/events/history          // Historical events
```

**WebSocket Events Stream:**

```typescript
// Endpoint: ws://host:port/api/events
// Client subscribes to event types of interest

interface EventMessage {
  type:
    | "job-scheduled"
    | "job-completed"
    | "job-failed"
    | "worker-ready"
    | "worker-disconnected"
    | "queue-empty"
    | "scheduler-idle"
    | "jobs-recovered"
    | "jobs-failed";
  timestamp: ISO8601;
  data: any;
}

// Subscription message from client
interface Subscription {
  types: string[]; // Array of event types to subscribe to
  throttle?: number; // Throttle events (ms), default: 100
}
```

## Component Architecture

### Page Structure

```
Dashboard (Root Layout)
├── TopBar
│   ├── Logo & Title
│   ├── GlobalStatusIndicator
│   ├── QuickActions (Drain, Resume, Manual Recovery)
│   └── UserMenu (Settings, About)
│
├── SidebarNavigation
│   ├── Overview (Dashboard)
│   ├── Jobs
│   ├── Queues
│   ├── Workers
│   ├── Metrics
│   └── Settings
│
├── MainContent (Route-based)
│   ├── OverviewPage
│   ├── JobsPage
│   ├── QueuesPage
│   ├── WorkersPage
│   ├── MetricsPage
│   └── SettingsPage
│
└── ToastContainer (Notifications)
```

### Key Components

#### TopBar

```typescript
interface TopBarProps {
  systemStatus: 'healthy' | 'degraded' | 'critical';
  queueState: 'normal' | 'draining' | 'paused';
  onDrainQueue: () => void;
  onResumeQueue: () => void;
  onTriggerRecovery: () => void;
}

// Features:
- Color-coded status indicator (green/yellow/red)
- Quick action buttons with keyboard shortcuts
- Refresh last updated time
- System alerts banner
```

#### JobCard

```typescript
interface JobCardProps {
  job: JobDetails;
  onRetry: (id: string) => void;
  onKill: (id: string) => void;
  onViewDetails: (id: string) => void;
}

// Features:
- Visual status badge (pending/processing/completed/failed)
- Hover actions (Retry, Kill, View)
- Execution time with trend indicator
- Queue time visualization
- Expandable for full details
```

#### QueueMonitor

```typescript
interface QueueMonitorProps {
  queueStats: QueueStats;
  history: QueueHistory[];
  onDrain: () => void;
  onResume: () => void;
}

// Features:
- Real-time queue depth chart (line chart)
- Throughput gauge (jobs/sec)
- Status timeline (drain/pause events)
- Oldest job age warning
- Quick actions dropdown
```

#### WorkerCard

```typescript
interface WorkerCardProps {
  worker: WorkerDetails;
  onRestart: (id: number) => void;
}

// Features:
- Worker ID with connection status
- Current job (if busy)
- Jobs processed count
- Last activity time
- Restart button with confirmation
- Expandable logs
```

#### MetricsChart

```typescript
interface MetricsChartProps {
  metric: 'queue_duration' | 'execution_duration' | 'throughput' |
          'worker_utilization' | 'error_rate';
  timeRange: '5m' | '15m' | '1h' | '24h';
  realtime?: boolean;
}

// Features:
- Time range selector
- Auto-refresh for real-time
- Min/max/avg stats overlay
- Smooth animations
- Download data as CSV/JSON
```

#### JobDetailsModal

```typescript
interface JobDetailsProps {
  job: JobWithFullDetails;
  onClose: () => void;
  onRetry: () => void;
  onKill: () => void;
}

// Features:
- Complete job payload (formatted JSON)
- Execution result
- Error stack trace (if failed)
- Timeline of events (scheduled → started → completed/failed)
- Related jobs (if using metaEnvelope/workflows)
- Copy payload/result buttons
```

## Data Flow

### Real-Time Event Flow

```
Workalot Events
      ↓
WebSocketServer (enhanced with event forwarding)
      ↓
Browser WebSocket Connection
      ↓
Event Store (Zustand)
      ↓
Component Subscriptions (useEventStore)
      ↓
Reactive UI Updates
```

### API Data Flow

```
Component Mount
      ↓
fetch() to REST API
      ↓
Loading State (Skeleton)
      ↓
Data Received → State Update
      ↓
Render with Data
      ↓
(Background) WebSocket pushes updates
      ↓
Optimistic UI Update
      ↓
Debounced re-fetch for consistency
```

### Optimistic Updates

**Example: Retry Job**

```
User clicks "Retry"
      ↓
Immediate UI feedback: Job status → "retrying"
      ↓
POST /api/jobs/:id/retry
      ↓
WebSocket event: "job-scheduled"
      ↓
Update job status → "pending"
      ↓
If API fails: Revert UI, show error toast
```

## UI/UX Design

### Design Principles

1. **Smooth Interactions**
   - 60fps animations with CSS transforms
   - Optimistic UI updates
   - Skeleton loading states
   - Smooth transitions between pages

2. **Clear Visual Hierarchy**
   - Critical info first (alerts, failed jobs)
   - Grouped by functionality (jobs, workers, metrics)
   - Progressive disclosure (details on demand)

3. **Fast Keyboard Navigation**
   - `Ctrl/Cmd + K`: Command palette
   - `J`: Go to Jobs
   - `Q`: Go to Queues
   - `W`: Go to Workers
   - `R`: Retry selected job
   - `K`: Kill selected job

4. **Real-Time Feedback**
   - Toast notifications for all actions
   - Live counters for queue stats
   - Pulse animations for running jobs
   - Color-coded status indicators

### Color System

```css
/* Status Colors */
--color-success: #10b981; /* Green - completed, healthy */
--color-warning: #f59e0b; /* Amber - processing, degraded */
--color-error: #ef4444; /* Red - failed, critical */
--color-info: #3b82f6; /* Blue - pending, info */
--color-neutral: #6b7280; /* Gray - inactive */

/* Theme Colors (Light/Dark) */
--color-bg-primary: #ffffff;
--color-bg-secondary: #f3f4f6;
--color-bg-tertiary: #e5e7eb;
--color-text-primary: #111827;
--color-text-secondary: #6b7280;
```

### Page Layouts

#### Overview Page (Dashboard Home)

```
┌──────────────────────────────────────────────────────────────────┐
│  System Health  │  Queue Depth  │  Throughput  │  Workers  │  ← Quick Stats
├──────────────────────────────────────────────────────────────────┤
│  Queue Depth Chart          │  Worker Utilization Chart        │  ← Main Metrics
├──────────────────────────────────────────────────────────────────┤
│  Recent Failed Jobs          │  Recent Activity Feed          │  ← Activity
├──────────────────────────────────────────────────────────────────┤
│  Alerts & Notifications                                         │
└──────────────────────────────────────────────────────────────────┘
```

#### Jobs Page

```
┌──────────────────────────────────────────────────────────────────┐
│  Status Filters: [All] [Pending] [Processing] [Failed]      │
├──────────────────────────────────────────────────────────────────┤
│  [Search Jobs...]               [Export] [Bulk Actions ▼]     │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Job Card - Processing                               │   │
│  │ 📸 Image Processing    ⟳ Processing    [Kill]     │   │
│  │ ID: 01...           Time: 2.3s                      │   │
│  │ Worker: #3                                               │   │
│  └────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Job Card - Failed                                   │   │
│  │ 📊 Data Analysis        ✗ Failed        [Retry]     │   │
│  │ ID: 02...           Time: 15.2s                     │   │
│  │ Error: Timeout exceeded                                 │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

#### Workers Page

```
┌──────────────────────────────────────────────────────────────────┐
│  Worker Pool Status: 4 Total | 2 Available | 2 Busy          │
├──────────────────────────────────────────────────────────────────┤
│  [Scale Workers ▼]    [Restart All]    [View Logs]         │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ Worker #1       │  │ Worker #2       │               │
│  │ Status: Ready   │  │ Status: Busy    │               │
│  │ Jobs: 123      │  │ Job: 01...      │               │
│  │ Uptime: 5h     │  │ Time: 1.2s     │               │
│  │ [Restart]       │  │ [Kill][Restart] │               │
│  └──────────────────┘  └──────────────────┘               │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ Worker #3       │  │ Worker #4       │               │
│  │ Status: Busy    │  │ Status: Ready   │               │
│  │ Job: 02...      │  │ Jobs: 98       │               │
│  │ Time: 0.5s     │  │ Uptime: 5h     │               │
│  │ [Kill][Restart] │  │ [Restart]       │               │
│  └──────────────────┘  └──────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

#### Metrics Page

```
┌──────────────────────────────────────────────────────────────────┐
│  Time Range: [5m] [15m] [1h] [24h] [Custom]              │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Queue Duration (ms)                                 │   │
│  │ P50: 12ms | P95: 45ms | P99: 120ms               │   │
│  │ [Line Chart]                                        │   │
│  └────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Execution Duration (ms)                              │   │
│  │ P50: 500ms | P95: 1.2s | P99: 2.5s              │   │
│  │ [Histogram]                                        │   │
│  └────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  Worker Utilization (%)  │  Throughput (jobs/sec)           │
│  │ [Gauge Chart]          │  [Sparkline Chart]              │
├──────────────────────────────────────────────────────────────────┤
│  OTEL Metrics Table (Exportable)                              │
└──────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core Foundation (Week 1)

**Backend:**

- [ ] Enhance existing server with new management endpoints
- [ ] Add WebSocket event forwarding to dashboard clients
- [ ] Implement job retry and kill operations
- [ ] Implement queue drain and resume operations

**Frontend:**

- [ ] Setup React + Vite + TypeScript project
- [ ] Configure Tailwind CSS and shadcn/ui
- [ ] Create base layout (TopBar, Sidebar, MainContent)
- [ ] Implement WebSocket connection manager
- [ ] Create state store with Zustand

**Deliverable:**

- Basic dashboard shell with real-time connection

### Phase 2: Jobs Management (Week 2)

**Backend:**

- [ ] Job details endpoint (full payload, result, error)
- [ ] Job retry and kill implementation
- [ ] Bulk job operations

**Frontend:**

- [ ] JobsPage with list view
- [ ] JobCard component with status badges
- [ ] Job filtering and search
- [ ] JobDetailsModal
- [ ] Retry/Kill actions with confirmation

**Deliverable:**

- Full job viewing and management UI

### Phase 3: Queue Monitoring (Week 2-3)

**Backend:**

- [ ] Historical queue stats endpoint
- [ ] Queue history persistence
- [ ] OTEL metrics export endpoint

**Frontend:**

- [ ] QueueMonitor component with real-time charts
- [ ] Queue depth visualization
- [ ] Throughput metrics
- [ ] Queue control actions (drain, pause, resume)

**Deliverable:**

- Real-time queue monitoring and control

### Phase 4: Workers Management (Week 3)

**Backend:**

- [ ] Worker restart implementation
- [ ] Worker scaling endpoint
- [ ] Worker logs endpoint

**Frontend:**

- [ ] WorkersPage with grid view
- [ ] WorkerCard component with health status
- [ ] Worker actions (restart, view logs)
- [ ] Worker utilization charts

**Deliverable:**

- Worker monitoring and management UI

### Phase 5: Metrics & Analytics (Week 4)

**Backend:**

- [ ] OTEL metrics snapshot API
- [ ] Historical metrics aggregation
- [ ] Export endpoints (CSV, JSON)

**Frontend:**

- [ ] MetricsPage with multi-chart view
- [ ] Time range selector
- [ ] Real-time metric updates
- [ ] Metric export functionality

**Deliverable:**

- Comprehensive metrics dashboard

### Phase 6: Polish & Optimization (Week 4-5)

**All:**

- [ ] Performance optimization (virtualization, lazy loading)
- [ ] Error handling and edge cases
- [ ] Accessibility improvements (ARIA labels, keyboard nav)
- [ ] Responsive design (mobile, tablet)
- [ ] Unit and integration tests
- [ ] Documentation

**Deliverable:**

- Production-ready dashboard

## Technical Considerations

### Performance

1. **Virtualization for Large Lists**
   - React Window or TanStack Virtual
   - Only render visible items in job lists
   - Support for 10k+ jobs

2. **Debouncing & Throttling**
   - Debounce search inputs (300ms)
   - Throttle WebSocket events (100ms)
   - Debounce resize events

3. **Code Splitting**
   - Lazy load route components
   - Split vendor bundles
   - Dynamic imports for charts

4. **Data Pagination**
   - Server-side pagination for job lists
   - Infinite scroll implementation
   - Cursor-based pagination

### Security

1. **Authentication** (Future)
   - JWT-based API auth
   - Role-based access control
   - Admin vs viewer roles

2. **CORS Configuration**
   - Restrict to dashboard origin
   - CSRF protection

3. **Input Validation**
   - Zod schemas for all API inputs
   - Sanitize displayed payloads
   - Prevent XSS in JSON rendering

### Error Handling

1. **Graceful Degradation**
   - Fallback to polling if WebSocket fails
   - Show cached data if API is down
   - Clear error messages

2. **Retry Logic**
   - Exponential backoff for failed requests
   - Max retry limits
   - User notification on retry exhaustion

3. **Error Boundaries**
   - React Error Boundary for component crashes
   - Fallback UI for crashed sections
   - Error reporting integration (Sentry?)

## OTEL Metrics Integration

### Available Metrics

```typescript
// Job Queue Metrics
job_queue_duration_ms - Histogram
  - Description: Time jobs spend waiting in queue
  - Labels: status (pending, processing), job_type

// Job Execution Metrics
job_execution_duration_ms - Histogram
  - Description: Time taken to execute jobs
  - Labels: status (success, failed), job_type

// Worker Metrics
ws_connections - UpDownCounter
  - Description: Number of active worker connections
  - Labels: worker_type

// Throughput Metrics
ws_messages_received - Counter
  - Description: Total messages received from workers
  - Labels: message_type

ws_messages_sent - Counter
  - Description: Total messages sent to workers
  - Labels: message_type
```

### Metrics Export

**Option 1: OTLP Exporter**

```typescript
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";

const metricExporter = new OTLPMetricExporter({
  url: "http://jaeger:4317", // Or Prometheus
});
```

**Option 2: Prometheus Exporter**

```typescript
import { PrometheusSerializer } from "@opentelemetry/exporter-prometheus";

const metricsEndpoint = async () => {
  const metrics = await meter.collect();
  const serializer = new PrometheusSerializer();
  return serializer.serialize(metrics);
};
```

**Option 3: Custom JSON Export** (Recommended for Dashboard)

```typescript
app.get('/api/metrics/otel', async () => {
  return {
    queueDuration: {
      avg: ...,
      p50: ...,
      p95: ...,
      p99: ...,
    },
    executionDuration: { ... },
    throughput: {
      jobsPerSecond: ...,
      messagesPerSecond: ...,
    },
    connections: {
      active: ...,
      total: ...,
    },
  };
});
```

## File Structure

```
workalot-dashboard/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── TopBar.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Layout.tsx
│   │   │   ├── jobs/
│   │   │   │   ├── JobCard.tsx
│   │   │   │   ├── JobList.tsx
│   │   │   │   ├── JobDetailsModal.tsx
│   │   │   │   └── JobFilters.tsx
│   │   │   ├── queues/
│   │   │   │   ├── QueueMonitor.tsx
│   │   │   │   ├── QueueChart.tsx
│   │   │   │   └── QueueControls.tsx
│   │   │   ├── workers/
│   │   │   │   ├── WorkerCard.tsx
│   │   │   │   ├── WorkerGrid.tsx
│   │   │   │   └── WorkerLogs.tsx
│   │   │   ├── metrics/
│   │   │   │   ├── MetricsChart.tsx
│   │   │   │   ├── MetricCard.tsx
│   │   │   │   └── TimeRangeSelector.tsx
│   │   │   └── common/
│   │   │       ├── StatusBadge.tsx
│   │   │       ├── Toast.tsx
│   │   │       └── LoadingSkeleton.tsx
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx
│   │   │   ├── JobsPage.tsx
│   │   │   ├── QueuesPage.tsx
│   │   │   ├── WorkersPage.tsx
│   │   │   ├── MetricsPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── lib/
│   │   │   ├── api/
│   │   │   │   ├── client.ts
│   │   │   │   ├── jobs.ts
│   │   │   │   ├── queues.ts
│   │   │   │   ├── workers.ts
│   │   │   │   └── metrics.ts
│   │   │   ├── ws/
│   │   │   │   └── events.ts
│   │   │   └── utils/
│   │   │       ├── formatters.ts
│   │   │       └── validators.ts
│   │   ├── store/
│   │   │   ├── index.ts
│   │   │   ├── jobsStore.ts
│   │   │   ├── queueStore.ts
│   │   │   ├── workersStore.ts
│   │   │   └── metricsStore.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── backend/
│   └── src/
│       ├── routes/
│       │   ├── jobs.ts
│       │   ├── queues.ts
│       │   ├── workers.ts
│       │   └── metrics.ts
│       └── ws/
│           └── events.ts
└── docs/
    ├── API.md
    └── DEPLOYMENT.md
```

## Deployment

### Development

```bash
# Start Workalot with dashboard
cd workalot
bun run examples/dashboard/server.ts

# Start frontend dev server
cd workalot-dashboard
pnpm dev
```

### Production

**Option 1: Embedded Dashboard**

```typescript
// Dashboard runs as part of Workalot server
import { serveDashboard } from "./dashboard/index.js";

app.use(
  serveDashboard({
    enabled: process.env.DASHBOARD_ENABLED === "true",
    auth: process.env.DASHBOARD_AUTH,
  }),
);
```

**Option 2: Standalone Dashboard**

```bash
# Build frontend
pnpm build

# Serve static files
npm install -g serve
serve -s dist -l 3000
```

**Docker Compose Example:**

```yaml
services:
  workalot:
    image: alcyone-labs/workalot:latest
    ports:
      - "3000:3000" # API
      - "8080:8080" # WebSocket
    environment:
      - DATABASE_URL=postgresql://...
      - DASHBOARD_ENABLED=true

  dashboard:
    image: alcyone-labs/workalot-dashboard:latest
    ports:
      - "3001:80"
    environment:
      - API_URL=http://workalot:3000
      - WS_URL=ws://workalot:8080
```

## Future Enhancements

### Phase 2 Features

1. **Workflow Visualization**
   - DAG view of job dependencies
   - MetaEnvelope workflow tracking
   - Step-by-step progress

2. **Alerting System**
   - Configurable thresholds
   - Email/Slack notifications
   - Alert history

3. **Advanced Analytics**
   - Job failure patterns
   - Performance regression detection
   - Capacity planning recommendations

4. **Multi-Cluster Support**
   - Dashboard for distributed workers
   - Cluster health overview
   - Cross-cluster job routing

5. **Authentication & RBAC**
   - User authentication
   - Role-based permissions
   - Audit logs

## Success Metrics

- **Performance**: Dashboard loads in <2s, updates <100ms latency
- **Reliability**: 99.9% uptime, graceful degradation on failures
- **Usability**: Intuitive UI requiring <5min onboarding time
- **Coverage**: 90%+ code coverage, zero critical bugs in production
- **Adoption**: 100% of Workalot deployments enable dashboard

## Conclusion

This design provides a comprehensive, production-ready web dashboard for Workalot with:

✅ Real-time monitoring of queues and workers
✅ Visual OTEL metrics insights
✅ Smooth management operations (retry, kill, drain, restart)
✅ Modern, responsive UI with excellent UX
✅ Scalable architecture for future enhancements

The phased implementation approach allows for incremental delivery and validation while building toward a full-featured dashboard.
