# Architecture

Workalot's architecture is designed around several core principles: separation of concerns, pluggable backends, and efficient worker management.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Application Code                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           TaskManager                                     │
│  ┌─────────────────┐    ┌─────────────────────────────────────────────┐  │
│  │ EventEmitter    │───▶│ • scheduleAndWait()                         │  │
│  │                 │    │ • schedule()                                │  │
│  │                 │    │ • whenFree()                                │  │
│  └─────────────────┘    │ • shutdown()                                │  │
└──────────────────────────└─────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
    ┌─────────────────────────┐     ┌────────────────────────────────────┐
    │     JobScheduler        │     │           Queue Backend            │
    │  • Coordinates job      │     │  (Memory | SQLite | PostgreSQL |   │
    │    scheduling           │     │   Redis | PGLite)                  │
    │  • Manages worker pool  │     │                                    │
    │  • Handles batch jobs   │     │  ┌────────────────────────────┐   │
    │  • Job recovery         │     │  │ IQueueBackend Interface   │   │
    └─────────────────────────┘     │  │ • addJob()                 │   │
              │                     │  │ • getNextPendingJob()      │   │
              ▼                     │  │ • updateJobStatus()        │   │
    ┌─────────────────────────┐     │  │ • getStats()               │   │
    │     WorkerManager       │     │  └────────────────────────────┘   │
    │  • Manages worker       │     └────────────────────────────────────┘
    │    threads/WebSockets   │
    │  • Distributes jobs     │                   │
    │  • Health checks        │                   ▼
    └─────────────────────────┘     ┌────────────────────────────────────┐
              │                     │          Job Executor               │
              ▼                     │  ┌────────────────────────────┐   │
    ┌─────────────────────────┐     │  │ • Loads job class          │   │
    │    Worker Threads       │     │  │ • Executes run() method    │   │
    │  (Bun or Node.js)       │     │  │ • Timeout handling         │   │
    └─────────────────────────┘     │  └────────────────────────────┘   │
                                    └────────────────────────────────────┘
```

## Core Components

### TaskManager

The primary API entry point. It extends EventEmitter and coordinates the queue backend and job scheduler.

```typescript
class TaskManager extends EventEmitter {
  private queueManager: IQueueBackend;
  private jobScheduler: JobScheduler;
  private isInitialized = false;
  private isShuttingDown = false;
}
```

**Key Methods:**

| Method                 | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `initialize()`         | Initialize the task manager and its components   |
| `scheduleAndWait(job)` | Schedule a job and wait for completion           |
| `schedule(job)`        | Schedule a job without waiting (fire-and-forget) |
| `whenFree(callback)`   | Register callback when queue is idle             |
| `shutdown()`           | Gracefully shut down all components              |

### JobScheduler

Coordinates job scheduling between the queue and workers. It handles both single and batch job processing.

```typescript
class JobScheduler extends EventEmitter {
  private workerManager: WorkerManager;
  private jobExecutor: JobExecutor;
  private jobRecoveryService: JobRecoveryService;
  private batchSize: number = 100;
}
```

**Features:**

- Event-driven job processing (no polling)
- Batch job processing for high throughput
- Automatic job recovery for stalled workers
- Telemetry integration for observability

### WorkerManager

Manages worker threads and WebSocket communication for distributed workers.

```typescript
class WorkerManager extends EventEmitter {
  private wsServer: WebSocketServer;
  private workerStates = new Map<number, WorkerState>();
  private pendingJobs = new Map<string, PendingJob>();
}
```

**Features:**

- WebSocket-based worker communication
- Worker health checks
- Automatic reconnection handling
- Batch job distribution

### Queue Backends

All queue backends implement the `IQueueBackend` interface:

```typescript
interface IQueueBackend extends EventEmitter {
  initialize(): Promise<void>;
  addJob(jobPayload: JobPayload, customId?: string): Promise<string>;
  getNextPendingJob(): Promise<QueueItem | undefined>;
  updateJobStatus(id: string, status: JobStatus, result?: JobResult): Promise<boolean>;
  getStats(): Promise<QueueStats>;
  shutdown(): Promise<void>;
}
```

## Data Flow

### Scheduling a Job

1. Application calls `taskManager.scheduleAndWait(jobPayload)`
2. TaskManager forwards to JobScheduler
3. JobScheduler calls `queueBackend.addJob()`
4. JobScheduler emits `job-scheduled` event
5. Processing loop picks up the job
6. JobScheduler assigns job to available worker
7. Worker executes the job in its thread
8. Result is stored and promise resolved

### Job Execution

1. Worker loads job class from `jobFile` path
2. Instantiates the job class
3. Calls `job.run(payload, context)` method
4. Captures return value or caught error
5. Emits `job-completed` or `job-failed` event

## Performance Characteristics

| Component        | Performance Impact       |
| ---------------- | ------------------------ |
| Memory Backend   | 100k+ jobs/sec           |
| SQLite + WAL     | 10k-50k jobs/sec         |
| PostgreSQL       | 5k-50k jobs/sec          |
| Redis            | 10k-100k jobs/sec        |
| Batch Processing | Up to 100 jobs per batch |
| Worker Threads   | Scales with CPU cores    |

## Event Flow

```
Job Scheduled
    │
    ▼
┌─────────────────┐
│ Queue Updated   │────▶ Event: "job-scheduled"
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Job Assigned    │────▶ Event: "job-started"
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Job Executing   │────▶ Worker processes job
└─────────────────┘
    │
    ├──▶ Success ──┐
    │              ▼
    │        ┌─────────────────┐
    │        │ Queue Updated   │────▶ Event: "job-completed"
    │        └─────────────────┘
    │
    └──▶ Failure ──┐
                   ▼
            ┌─────────────────┐
            │ Queue Updated   │────▶ Event: "job-failed"
            └─────────────────┘
```

## Concurrency Model

- **Single-Threaded Queue**: Queue operations are synchronized
- **Multi-Threaded Workers**: Jobs execute in worker threads
- **Batch Processing**: Multiple jobs distributed to workers simultaneously
- **Worker Queues**: Optional local queues on each worker for ultra-high throughput
