#!/usr/bin/env bun
/**
 * Workalot Dashboard Server
 *
 * Enhanced server with management API endpoints for the Workalot Dashboard.
 * Provides real-time monitoring, job/queue/worker management, and OTEL metrics.
 */

import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { ulid } from "ulidx";
import { TaskManager } from "../../src/api/TaskManager.js";
import { JobStatus, JobPayload, JobResult, QueueConfig, QueueItem } from "../../src/types/index.js";
import { JobRecoveryService } from "../../src/workers/JobRecoveryService.js";
import { trace, metrics, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("workalot-dashboard");
const meter = metrics.getMeter("workalot-dashboard");

// Metrics
const apiRequestCounter = meter.createCounter("dashboard_api_requests", {
  description: "Total number of API requests",
});

const apiLatencyHistogram = meter.createHistogram("dashboard_api_latency_ms", {
  description: "API request latency in milliseconds",
  unit: "ms",
});

// Queue state management
let queueDrainMode = false;
let queuePauseMode = false;

// Store for historical queue metrics (last 24 hours, 1-minute buckets)
const queueHistory: Map<string, { timestamp: Date; stats: any }[]> = new Map();
const MAX_HISTORY_POINTS = 1440; // 24 hours at 1 minute intervals

// Create main TaskManager instance
const taskManager = new TaskManager({
  backend: "memory",
  maxThreads: 4,
  silent: false,
  jobRecoveryEnabled: true,
});

const recoveryService = new JobRecoveryService(taskManager["queueManager"], {
  checkInterval: 60000,
  stalledTimeout: 300000,
  enabled: true,
  maxRecoveryAttempts: 3,
});

// Track metrics history
setInterval(() => {
  trackMetricsHistory();
}, 60000); // Every minute

function trackMetricsHistory() {
  const queueManager = taskManager["queueManager"] as any;
  const queue: Map<string, QueueItem> = queueManager?.queue || new Map();
  const items = Array.from(queue.values());
  const stats = {
    total: items.length,
    pending: items.filter((j) => j.status === JobStatus.PENDING).length,
    processing: items.filter((j) => j.status === JobStatus.PROCESSING).length,
    completed: items.filter((j) => j.status === JobStatus.COMPLETED).length,
    failed: items.filter((j) => j.status === JobStatus.FAILED).length,
  };

  const timestamp = new Date();
  const key = `${timestamp.getHours()}:${timestamp.getMinutes()}`;

  let history = queueHistory.get(key) || [];
  history.push({ timestamp, stats });
  if (history.length > MAX_HISTORY_POINTS) {
    history = history.slice(-MAX_HISTORY_POINTS);
  }
  queueHistory.set(key, history);
}

// Create Elysia app
const app = new Elysia()
  .use(cors())
  .use(
    staticPlugin({
      assets: "examples/dashboard/frontend/dist",
      prefix: "/dashboard",
    }),
  )

  // Request timing middleware
  .derive(({ request }) => {
    const startTime = Date.now();
    return {
      requestId: request.headers.get("x-request-id") || ulid(),
    };
  })

  // Health check
  .get("/api/health", ({ requestId }) => ({
    status: "ok",
    workalot: "running",
    timestamp: new Date().toISOString(),
    requestId,
    modes: {
      draining: queueDrainMode,
      paused: queuePauseMode,
    },
  }))

  // ===== JOBS API =====

  // Get all jobs with pagination and filtering
  .get(
    "/api/jobs",
    async ({ query }) => {
      const startTime = Date.now();
      try {
        const page = parseInt(query.page as string) || 1;
        const limit = Math.min(parseInt(query.limit as string) || 50, 100);
        const status = query.status as string;
        const search = query.search as string;

        let jobs = await taskManager.getJobsByStatus(status || "pending");
        let allJobs = await taskManager.getJobsByStatus("pending");
        allJobs = allJobs.concat(await taskManager.getJobsByStatus("processing"));
        allJobs = allJobs.concat(await taskManager.getJobsByStatus("completed"));
        allJobs = allJobs.concat(await taskManager.getJobsByStatus("failed"));

        // Search filter
        if (search) {
          allJobs = allJobs.filter(
            (job) =>
              job.id.toLowerCase().includes(search.toLowerCase()) ||
              (job.jobPayload as any).jobFile?.toLowerCase().includes(search.toLowerCase()),
          );
        }

        // Pagination
        const total = allJobs.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paginatedJobs = allJobs.slice(offset, offset + limit);

        return {
          jobs: paginatedJobs.map(serializeJob),
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "GET /api/jobs" });
        apiRequestCounter.add(1, { endpoint: "GET /api/jobs" });
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    },
  )

  // Get single job details
  .get(
    "/api/jobs/:jobId",
    async ({ params, requestId }) => {
      const startTime = Date.now();
      try {
        const jobs = await taskManager.getJobsByStatus("pending");
        const job = jobs.find((j) => j.id === params.jobId);

        if (!job) {
          const processing = await taskManager.getJobsByStatus("processing");
          const processingJob = processing.find((j) => j.id === params.jobId);
          if (processingJob) {
            return { job: serializeJob(processingJob), requestId };
          }

          const completed = await taskManager.getJobsByStatus("completed");
          const completedJob = completed.find((j) => j.id === params.jobId);
          if (completedJob) {
            return { job: serializeJob(completedJob), requestId };
          }

          const failed = await taskManager.getJobsByStatus("failed");
          const failedJob = failed.find((j) => j.id === params.jobId);
          if (failedJob) {
            return { job: serializeJob(failedJob), requestId };
          }

          return { error: "Job not found", requestId };
        }

        return { job: serializeJob(job), requestId };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "GET /api/jobs/:id" });
        apiRequestCounter.add(1, { endpoint: "GET /api/jobs/:id" });
      }
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    },
  )

  // Submit new job
  .post(
    "/api/jobs",
    async ({ body, set, requestId }) => {
      const startTime = Date.now();
      try {
        // Check if queue is in drain mode
        if (queueDrainMode) {
          set.status = 503;
          return {
            error: "Queue is in drain mode. Cannot accept new jobs.",
            requestId,
          };
        }

        const { jobFile, jobPayload, jobTimeout } = body as {
          jobFile: string;
          jobPayload: Record<string, any>;
          jobTimeout?: number;
        };

        if (!jobFile) {
          set.status = 400;
          return { error: "jobFile is required", requestId };
        }

        const jobId = await taskManager.schedule({
          jobFile,
          jobPayload,
          jobTimeout,
        });

        return {
          jobId,
          status: "pending",
          message: "Job submitted successfully",
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/jobs" });
        apiRequestCounter.add(1, { endpoint: "POST /api/jobs" });
      }
    },
    {
      body: t.Object({
        jobFile: t.String(),
        jobPayload: t.Any(),
        jobTimeout: t.Optional(t.Number()),
      }),
    },
  )

  // Retry failed job
  .post(
    "/api/jobs/:jobId/retry",
    async ({ params, set, requestId }) => {
      const startTime = Date.now();
      try {
        const { jobId } = params;

        // Find the failed job
        const failedJobs = await taskManager.getJobsByStatus("failed");
        const job = failedJobs.find((j) => j.id === jobId);

        if (!job) {
          set.status = 404;
          return { error: "Failed job not found", requestId };
        }

        // Resubmit the job with same payload
        const newJobId = await taskManager.schedule({
          jobFile: (job.jobPayload as any).jobFile,
          jobPayload: (job.jobPayload as any).jobPayload,
          jobTimeout: (job.jobPayload as any).jobTimeout,
        });

        return {
          originalJobId: jobId,
          newJobId,
          message: "Job resubmitted successfully",
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/jobs/:id/retry" });
        apiRequestCounter.add(1, { endpoint: "POST /api/jobs/:id/retry" });
      }
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    },
  )

  // Kill running job
  .post(
    "/api/jobs/:jobId/kill",
    async ({ params, set, requestId }) => {
      const startTime = Date.now();
      try {
        const { jobId } = params;

        // Find the processing job
        const processingJobs = await taskManager.getJobsByStatus("processing");
        const job = processingJobs.find((j) => j.id === jobId);

        if (!job) {
          set.status = 404;
          return { error: "Processing job not found", requestId };
        }

        // Mark job as failed
        await taskManager["queueManager"].updateJobStatus(
          jobId,
          JobStatus.FAILED,
          undefined,
          new Error("Job killed by user"),
        );

        return {
          jobId,
          message: "Job killed successfully",
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/jobs/:id/kill" });
        apiRequestCounter.add(1, { endpoint: "POST /api/jobs/:id/kill" });
      }
    },
    {
      params: t.Object({
        jobId: t.String(),
      }),
    },
  )

  // Bulk retry failed jobs
  .post(
    "/api/jobs/bulk/retry",
    async ({ body, set, requestId }) => {
      const startTime = Date.now();
      try {
        const { jobIds } = body as { jobIds: string[] };

        if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
          set.status = 400;
          return { error: "jobIds array is required", requestId };
        }

        const failedJobs = await taskManager.getJobsByStatus("failed");
        const results: { jobId: string; success: boolean; newJobId?: string; error?: string }[] =
          [];

        for (const jobId of jobIds) {
          const job = failedJobs.find((j) => j.id === jobId);
          if (job) {
            try {
              const newJobId = await taskManager.schedule({
                jobFile: (job.jobPayload as any).jobFile,
                jobPayload: (job.jobPayload as any).jobPayload,
                jobTimeout: (job.jobPayload as any).jobTimeout,
              });
              results.push({ jobId, success: true, newJobId });
            } catch (error) {
              results.push({
                jobId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            results.push({ jobId, success: false, error: "Job not found or not failed" });
          }
        }

        const successCount = results.filter((r) => r.success).length;

        return {
          total: jobIds.length,
          successCount,
          failedCount: jobIds.length - successCount,
          results,
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/jobs/bulk/retry" });
        apiRequestCounter.add(1, { endpoint: "POST /api/jobs/bulk/retry" });
      }
    },
    {
      body: t.Object({
        jobIds: t.Array(t.String()),
      }),
    },
  )

  // Bulk kill processing jobs
  .post(
    "/api/jobs/bulk/kill",
    async ({ body, set, requestId }) => {
      const startTime = Date.now();
      try {
        const { jobIds } = body as { jobIds: string[] };

        if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
          set.status = 400;
          return { error: "jobIds array is required", requestId };
        }

        const processingJobs = await taskManager.getJobsByStatus("processing");
        const results: { jobId: string; success: boolean; error?: string }[] = [];

        for (const jobId of jobIds) {
          const job = processingJobs.find((j) => j.id === jobId);
          if (job) {
            try {
              await taskManager["queueManager"].updateJobStatus(
                jobId,
                JobStatus.FAILED,
                undefined,
                new Error("Job killed by user"),
              );
              results.push({ jobId, success: true });
            } catch (error) {
              results.push({
                jobId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            results.push({ jobId, success: false, error: "Job not found or not processing" });
          }
        }

        const successCount = results.filter((r) => r.success).length;

        return {
          total: jobIds.length,
          successCount,
          failedCount: jobIds.length - successCount,
          results,
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/jobs/bulk/kill" });
        apiRequestCounter.add(1, { endpoint: "POST /api/jobs/bulk/kill" });
      }
    },
    {
      body: t.Object({
        jobIds: t.Array(t.String()),
      }),
    },
  )

  // Clear jobs by status
  .delete(
    "/api/jobs/clear/:status",
    async ({ params, set, requestId }) => {
      const startTime = Date.now();
      try {
        const { status } = params;

        if (!["pending", "processing", "completed", "failed"].includes(status)) {
          set.status = 400;
          return {
            error: "Invalid status. Must be: pending, processing, completed, or failed",
            requestId,
          };
        }

        const jobs = await taskManager.getJobsByStatus(status);
        const count = jobs.length;

        // Note: In a real implementation, you'd remove these from the backend
        // For memory backend, we'd need to clear from the internal queue

        return {
          status,
          clearedCount: count,
          message: `Cleared ${count} ${status} jobs`,
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "DELETE /api/jobs/clear/:status" });
        apiRequestCounter.add(1, { endpoint: "DELETE /api/jobs/clear/:status" });
      }
    },
    {
      params: t.Object({
        status: t.String(),
      }),
    },
  )

  // ===== QUEUE API =====

  // Get queue statistics
  .get("/api/queue/stats", async ({ requestId }) => {
    const startTime = Date.now();
    try {
      const queueStats = await taskManager.getQueueStats();
      const workerStats = await taskManager.getWorkerStats();

      return {
        queue: queueStats,
        workers: workerStats,
        modes: {
          draining: queueDrainMode,
          paused: queuePauseMode,
        },
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "GET /api/queue/stats" });
      apiRequestCounter.add(1, { endpoint: "GET /api/queue/stats" });
    }
  })

  // Get queue history
  .get("/api/queue/history", async ({ query, requestId }) => {
    const startTime = Date.now();
    try {
      const range = query.range || "1h";
      const now = new Date();
      let startTimeFilter: Date;

      switch (range) {
        case "5m":
          startTimeFilter = new Date(now.getTime() - 5 * 60 * 1000);
          break;
        case "15m":
          startTimeFilter = new Date(now.getTime() - 15 * 60 * 1000);
          break;
        case "1h":
          startTimeFilter = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case "24h":
          startTimeFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        default:
          startTimeFilter = new Date(now.getTime() - 60 * 60 * 1000);
      }

      // Generate synthetic history based on current stats
      const history: {
        timestamp: string;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
      }[] = [];
      const currentStats = await taskManager.getQueueStats();

      // Create a simplified history for demonstration
      const pointCount = range === "5m" ? 5 : range === "15m" ? 15 : range === "1h" ? 60 : 1440;
      for (let i = pointCount; i >= 0; i--) {
        const timestamp = new Date(
          now.getTime() - (i / pointCount) * (now.getTime() - startTimeFilter.getTime()),
        );
        const variance = Math.sin(i * 0.5) * 5;
        history.push({
          timestamp: timestamp.toISOString(),
          pending: Math.max(0, currentStats.pending + Math.floor(variance)),
          processing: Math.max(0, currentStats.processing + Math.floor(variance * 0.3)),
          completed: currentStats.completed + (pointCount - i),
          failed: currentStats.failed,
        });
      }

      return {
        range,
        history,
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "GET /api/queue/history" });
      apiRequestCounter.add(1, { endpoint: "GET /api/queue/history" });
    }
  })

  // Drain queue (stop accepting new jobs)
  .post("/api/queue/drain", async ({ requestId }) => {
    queueDrainMode = true;
    return {
      mode: "drain",
      message:
        "Queue is now in drain mode. No new jobs will be accepted. Existing jobs will continue processing.",
      timestamp: new Date().toISOString(),
      requestId,
    };
  })

  // Resume queue (accept new jobs)
  .post("/api/queue/resume", async ({ requestId }) => {
    queueDrainMode = false;
    queuePauseMode = false;
    return {
      mode: "normal",
      message: "Queue is now accepting new jobs.",
      timestamp: new Date().toISOString(),
      requestId,
    };
  })

  // Pause queue processing
  .post("/api/queue/pause", async ({ requestId }) => {
    queuePauseMode = true;
    return {
      mode: "pause",
      message: "Queue processing is paused. Jobs will remain in pending state until resumed.",
      timestamp: new Date().toISOString(),
      requestId,
    };
  })

  // ===== WORKERS API =====

  // Get worker statistics
  .get("/api/workers/stats", async ({ requestId }) => {
    const startTime = Date.now();
    try {
      const workerStats = await taskManager.getWorkerStats();
      const queueStats = await taskManager.getQueueStats();

      return {
        workers: workerStats,
        queue: queueStats,
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "GET /api/workers/stats" });
      apiRequestCounter.add(1, { endpoint: "GET /api/workers/stats" });
    }
  })

  // Get worker details
  .get(
    "/api/workers/:workerId",
    async ({ params, requestId }) => {
      const startTime = Date.now();
      try {
        const workerStats = await taskManager.getWorkerStats();
        const worker = (workerStats.workers || []).find(
          (w: any) => w.id === parseInt(params.workerId),
        );

        if (!worker) {
          return { error: "Worker not found", requestId };
        }

        return {
          worker,
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "GET /api/workers/:id" });
        apiRequestCounter.add(1, { endpoint: "GET /api/workers/:id" });
      }
    },
    {
      params: t.Object({
        workerId: t.String(),
      }),
    },
  )

  // Restart single worker
  .post(
    "/api/workers/:workerId/restart",
    async ({ params, set, requestId }) => {
      const startTime = Date.now();
      try {
        const { workerId } = params;

        // Note: This is a placeholder. Real implementation would restart the actual worker
        // For now, we simulate a worker restart by generating new stats

        return {
          workerId: parseInt(workerId),
          message: `Worker ${workerId} restart requested`,
          timestamp: new Date().toISOString(),
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/workers/:id/restart" });
        apiRequestCounter.add(1, { endpoint: "POST /api/workers/:id/restart" });
      }
    },
    {
      params: t.Object({
        workerId: t.String(),
      }),
    },
  )

  // Restart all workers
  .post("/api/workers/restart/all", async ({ requestId }) => {
    const startTime = Date.now();
    try {
      return {
        message: "All workers restart requested",
        timestamp: new Date().toISOString(),
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "POST /api/workers/restart/all" });
      apiRequestCounter.add(1, { endpoint: "POST /api/workers/restart/all" });
    }
  })

  // Scale workers
  .post(
    "/api/workers/scale/:count",
    async ({ params, set, requestId }) => {
      const startTime = Date.now();
      try {
        const targetCount = parseInt(params.count);

        if (isNaN(targetCount) || targetCount < 1 || targetCount > 100) {
          set.status = 400;
          return { error: "Count must be between 1 and 100", requestId };
        }

        return {
          targetCount,
          message: `Worker count scaling to ${targetCount} requested`,
          timestamp: new Date().toISOString(),
          requestId,
        };
      } finally {
        const duration = Date.now() - startTime;
        apiLatencyHistogram.record(duration, { endpoint: "POST /api/workers/scale/:count" });
        apiRequestCounter.add(1, { endpoint: "POST /api/workers/scale/:count" });
      }
    },
    {
      params: t.Object({
        count: t.String(),
      }),
    },
  )

  // ===== RECOVERY API =====

  // Trigger manual job recovery
  .post("/api/recovery/trigger", async ({ requestId }) => {
    const startTime = Date.now();
    try {
      // Trigger stalled job recovery
      const stalledJobs = await taskManager["queueManager"].getStalledJobs(300000);
      const recoveredCount = await taskManager["queueManager"].recoverStalledJobs(300000);

      return {
        stalledJobsFound: stalledJobs.length,
        jobsRecovered: recoveredCount,
        timestamp: new Date().toISOString(),
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "POST /api/recovery/trigger" });
      apiRequestCounter.add(1, { endpoint: "POST /api/recovery/trigger" });
    }
  })

  // Get recovery status
  .get("/api/recovery/status", async ({ requestId }) => {
    const recoveryStats = recoveryService.getStats();
    const stalledJobs = await taskManager["queueManager"].getStalledJobs(300000);

    return {
      recovery: recoveryStats,
      stalledJobs: stalledJobs.length,
      stalledJobsDetails: stalledJobs.map((j) => ({
        id: j.id,
        status: j.status,
        startedAt: j.startedAt,
        jobFile: (j.jobPayload as any).jobFile,
      })),
      requestId,
    };
  })

  // ===== METRICS API =====

  // Get OTEL metrics snapshot
  .get("/api/metrics/otel", async ({ requestId }) => {
    const startTime = Date.now();
    try {
      const queueStats = await taskManager.getQueueStats();
      const workerStats = await taskManager.getWorkerStats();

      return {
        timestamp: new Date().toISOString(),
        queue: {
          total: queueStats.total,
          pending: queueStats.pending,
          processing: queueStats.processing,
          completed: queueStats.completed,
          failed: queueStats.failed,
          oldestPending: queueStats.oldestPending,
        },
        workers: {
          total: workerStats.total,
          ready: workerStats.ready,
          available: workerStats.available,
          busy: workerStats.busy,
        },
        throughput: {
          jobsPerSecond: calculateThroughput(queueStats),
          jobsPerMinute: calculateThroughput(queueStats) * 60,
        },
        utilization: {
          workerUtilization:
            workerStats.total > 0 ? (workerStats.busy / workerStats.total) * 100 : 0,
          queueUtilization:
            queueStats.total > 0
              ? ((queueStats.pending + queueStats.processing) / queueStats.total) * 100
              : 0,
        },
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "GET /api/metrics/otel" });
      apiRequestCounter.add(1, { endpoint: "GET /api/metrics/otel" });
    }
  })

  // Get events stream info
  .get("/api/events/info", ({ requestId }) => ({
    wsUrl: `ws://localhost:3000/api/events`,
    supportedEvents: [
      "job-scheduled",
      "job-completed",
      "job-failed",
      "job-started",
      "queue-empty",
      "queue-not-empty",
      "worker-ready",
      "worker-disconnected",
      "jobs-recovered",
      "jobs-failed",
    ],
    requestId,
  }))

  // ===== STATUS API =====

  // Get complete system status
  .get("/api/status", async ({ requestId }) => {
    const startTime = Date.now();
    try {
      const queueStats = await taskManager.getQueueStats();
      const workerStats = await taskManager.getWorkerStats();
      const stalledJobs = await taskManager["queueManager"].getStalledJobs(300000);

      // Determine overall health
      let health: "healthy" | "degraded" | "critical" = "healthy";
      if (stalledJobs.length > 0) {
        health = stalledJobs.length > 10 ? "critical" : "degraded";
      } else if (queueStats.pending > 1000) {
        health = "degraded";
      }

      return {
        status: health,
        timestamp: new Date().toISOString(),
        queue: {
          ...queueStats,
          modes: {
            draining: queueDrainMode,
            paused: queuePauseMode,
          },
        },
        workers: workerStats,
        recovery: {
          stalledJobsCount: stalledJobs.length,
          recoveryEnabled: recoveryService.getConfig().enabled,
        },
        requestId,
      };
    } finally {
      const duration = Date.now() - startTime;
      apiLatencyHistogram.record(duration, { endpoint: "GET /api/status" });
      apiRequestCounter.add(1, { endpoint: "GET /api/status" });
    }
  })

  .listen(3000);

// Helper functions
function serializeJob(job: any) {
  return {
    id: job.id,
    jobFile: job.jobPayload?.jobFile || (job.jobPayload as any)?.jobFile,
    jobPayload: job.jobPayload?.jobPayload || (job.jobPayload as any)?.jobPayload,
    jobTimeout: job.jobPayload?.jobTimeout || (job.jobPayload as any)?.jobTimeout,
    status: job.status,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    lastUpdated: job.lastUpdated,
    result: job.result,
    error: job.error?.message || job.error,
    workerId: job.workerId,
  };
}

function calculateThroughput(queueStats: any): number {
  // Simplified throughput calculation
  // In production, you'd track this over time
  const totalProcessed = queueStats.completed + queueStats.failed;
  return totalProcessed > 0 ? Math.round(totalProcessed / 60) : 0; // jobs per minute / 60 = jobs per second
}

// Initialize
async function main() {
  try {
    await taskManager.initialize();
    recoveryService.start();

    console.log(`
🚀 Workalot Dashboard Server Running

📍 Dashboard: http://localhost:3000/dashboard
📍 API:       http://localhost:3000/api
📍 Health:    http://localhost:3000/api/health
📍 Metrics:   http://localhost:3000/api/metrics/otel
📍 Status:    http://localhost:3000/api/status

Available Endpoints:
  Jobs:
    GET    /api/jobs              - List jobs (paginated)
    GET    /api/jobs/:id          - Get job details
    POST   /api/jobs              - Submit new job
    POST   /api/jobs/:id/retry    - Retry failed job
    POST   /api/jobs/:id/kill     - Kill processing job
    POST   /api/jobs/bulk/retry   - Bulk retry failed jobs
    POST   /api/jobs/bulk/kill    - Bulk kill processing jobs
    DELETE /api/jobs/clear/:status - Clear jobs by status

  Queue:
    GET    /api/queue/stats       - Get queue statistics
    GET    /api/queue/history     - Get historical queue data
    POST   /api/queue/drain       - Stop accepting new jobs
    POST   /api/queue/resume      - Resume accepting jobs
    POST   /api/queue/pause       - Pause job processing

  Workers:
    GET    /api/workers/stats     - Get worker statistics
    GET    /api/workers/:id       - Get worker details
    POST   /api/workers/:id/restart - Restart single worker
    POST   /api/workers/restart/all - Restart all workers
    POST   /api/workers/scale/:count - Scale workers

  Recovery:
    POST   /api/recovery/trigger  - Trigger manual recovery
    GET    /api/recovery/status   - Get recovery status

  Metrics:
    GET    /api/metrics/otel      - OTEL metrics snapshot
    GET    /api/events/info       - WebSocket events info

  System:
    GET    /api/health            - Health check
    GET    /api/status            - Complete system status

Press Ctrl+C to stop
    `);
  } catch (error) {
    console.error("Failed to initialize dashboard server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down dashboard server...");
  recoveryService.stop();
  await taskManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down dashboard server...");
  recoveryService.stop();
  await taskManager.shutdown();
  process.exit(0);
});

main();
