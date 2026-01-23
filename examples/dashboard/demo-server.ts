#!/usr/bin/env bun
/**
 * Workalot Dashboard Demo Server
 *
 * A long-running server with jobs to test the dashboard.
 * Automatically submits jobs and keeps the queue populated.
 */

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { TaskManager } from "../../src/api/TaskManager.js";
import { JobStatus } from "../../src/types/index.js";

console.log("Starting Workalot Dashboard Demo Server...\n");

// Create TaskManager
const taskManager = new TaskManager({
  backend: "memory",
  maxThreads: 4,
  silent: true,
});

await taskManager.initialize();
console.log("TaskManager initialized with memory backend\n");

let jobCount = 0;

// Submit demo jobs periodically
function submitDemoJob() {
  const isFail = Math.random() < 0.1; // 10% chance of failure
  jobCount++;

  const jobPayload = {
    jobFile: "examples/_jobs/PingJob.ts",
    jobPayload: {
      message: `Demo Job ${jobCount}`,
      shouldFail: isFail,
      delay: Math.random() * 1000,
    },
  };

  taskManager.schedule(jobPayload).then((jobId) => {
    console.log(
      `Scheduled ${isFail ? "failing " : ""}job ${jobCount}: ${jobId.substring(0, 8)}...`,
    );
  });
}

// Submit initial batch
console.log("\nSubmitting initial batch of demo jobs...\n");
for (let i = 0; i < 20; i++) {
  submitDemoJob();
}

// Submit new jobs periodically
const jobInterval = setInterval(() => {
  // Keep around 10-30 pending jobs
  submitDemoJob();
  // Occasionally submit a failing job
  if (Math.random() < 0.1) {
    jobCount++;
    taskManager.schedule({
      jobFile: "examples/_jobs/PingJob.ts",
      jobPayload: { message: `Failing Job ${jobCount}`, shouldFail: true, delay: 100 },
    });
  }
}, 3000);

console.log("\nDemo jobs will be submitted every 3 seconds\n");

// Create Elysia app
new Elysia()
  .use(cors())
  .get("/api/health", () => ({
    status: "ok",
    workalot: "running",
    timestamp: new Date().toISOString(),
  }))

  // Get all jobs
  .get("/api/jobs", async ({ query }) => {
    const page = parseInt(query.page as string) || 1;
    const limit = Math.min(parseInt(query.limit as string) || 50, 100);
    const status = query.status as string;

    let allJobs = [];
    if (!status || status === "all") {
      const pending = await taskManager.getJobsByStatus("pending");
      const processing = await taskManager.getJobsByStatus("processing");
      const completed = await taskManager.getJobsByStatus("completed");
      const failed = await taskManager.getJobsByStatus("failed");
      allJobs = [...pending, ...processing, ...completed, ...failed];
    } else {
      allJobs = await taskManager.getJobsByStatus(status);
    }

    // Sort by requestedAt descending
    allJobs.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

    const total = allJobs.length;
    const offset = (page - 1) * limit;
    const paginatedJobs = allJobs.slice(offset, offset + limit);

    return {
      jobs: paginatedJobs.map(serializeJob),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  })

  // Get job details
  .get("/api/jobs/:jobId", async ({ params }) => {
    const { jobId } = params;
    const statuses = ["pending", "processing", "completed", "failed"];

    for (const status of statuses) {
      const jobs = await taskManager.getJobsByStatus(status);
      const job = jobs.find((j) => j.id === jobId);
      if (job) return { job: serializeJob(job) };
    }

    return { error: "Job not found" };
  })

  // Submit new job
  .post("/api/jobs", async ({ body }) => {
    const { jobFile, jobPayload } = body as { jobFile: string; jobPayload: Record<string, any> };

    if (!jobFile) return { error: "jobFile is required" };

    const jobId = await taskManager.schedule({ jobFile, jobPayload });
    return { jobId, status: "pending", message: "Job submitted" };
  })

  // Retry failed job
  .post("/api/jobs/:jobId/retry", async ({ params }) => {
    const { jobId } = params;
    const failedJobs = await taskManager.getJobsByStatus("failed");
    const job = failedJobs.find((j) => j.id === jobId);

    if (!job) return { error: "Failed job not found" };

    const newJobId = await taskManager.schedule({
      jobFile: (job.jobPayload as any).jobFile || "examples/_jobs/PingJob.ts",
      jobPayload: (job.jobPayload as any).jobPayload || {},
    });

    return { originalJobId: jobId, newJobId, message: "Job resubmitted" };
  })

  // Kill processing job
  .post("/api/jobs/:jobId/kill", async ({ params }) => {
    const { jobId } = params;
    const processingJobs = await taskManager.getJobsByStatus("processing");
    const job = processingJobs.find((j) => j.id === jobId);

    if (!job) return { error: "Processing job not found" };

    // Mark as failed
    const queueManager = (taskManager as any).queueManager;
    if (queueManager) {
      await queueManager.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        undefined,
        new Error("Job killed by user"),
      );
    }

    return { jobId, message: "Job killed" };
  })

  // Get queue stats
  .get("/api/queue/stats", async () => {
    const queueStats = await taskManager.getQueueStats();
    const workerStats = await taskManager.getWorkerStats();
    return { queue: queueStats, workers: workerStats };
  })

  // Get queue history (synthetic)
  .get("/api/queue/history", async ({ query }) => {
    const range = query.range || "1h";
    const now = new Date();
    const history = [];

    const pointCount = range === "5m" ? 5 : range === "15m" ? 15 : range === "1h" ? 60 : 1440;
    const queueStats = await taskManager.getQueueStats();

    for (let i = pointCount; i >= 0; i--) {
      const timestamp = new Date(
        now.getTime() -
          (i / pointCount) *
            (range === "5m" ? 5 : range === "15m" ? 15 : range === "1h" ? 60 : 1440) *
            60 *
            1000,
      );
      const variance = Math.sin(i * 0.5) * 5;
      history.push({
        timestamp: timestamp.toISOString(),
        pending: Math.max(0, (queueStats.pending || 0) + Math.floor(variance)),
        processing: Math.max(0, (queueStats.processing || 0) + Math.floor(variance * 0.3)),
        completed: (queueStats.completed || 0) + (pointCount - i),
        failed: queueStats.failed || 0,
      });
    }

    return { range, history };
  })

  // Server-Sent Events stream
  .get("/api/stream", () => {
    let controller: ReadableStreamDefaultController;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
        const send = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // Send initial stats
        taskManager.getQueueStats().then((stats) => {
          send({ type: "stats", data: stats });
        });

        taskManager.getWorkerStats().then((stats) => {
          send({ type: "workers", data: stats });
        });

        // Listen for job events
        const onJobEvent = async (event: string) => {
          const queueStats = await taskManager.getQueueStats();
          const workerStats = await taskManager.getWorkerStats();
          send({
            type: event,
            data: {
              stats: queueStats,
              workers: workerStats,
              timestamp: new Date().toISOString(),
            },
          });
        };

        (taskManager as any).emitter?.on("job-completed", () => onJobEvent("job-completed"));
        (taskManager as any).emitter?.on("job-started", () => onJobEvent("job-started"));
        (taskManager as any).emitter?.on("job-failed", () => onJobEvent("job-failed"));

        // Send heartbeat every 5 seconds
        const heartbeat = setInterval(() => {
          send({ type: "heartbeat", timestamp: new Date().toISOString() });
        }, 5000);

        return () => {
          clearInterval(heartbeat);
        };
      },
      cancel() {
        // Cleanup when connection closes
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  })

  // Drain queue
  .post("/api/queue/drain", () => ({ mode: "drain", message: "Queue draining" }))

  // Resume queue
  .post("/api/queue/resume", () => ({ mode: "normal", message: "Queue resumed" }))

  // Trigger recovery
  .post("/api/recovery/trigger", async () => {
    const queueManager = (taskManager as any).queueManager;
    let recovered = 0;
    if (queueManager?.recoverStalledJobs) {
      recovered = await queueManager.recoverStalledJobs(300000);
    }
    return { stalledJobsFound: recovered, jobsRecovered: recovered };
  })

  // Get system status
  .get("/api/status", async () => {
    const queueStats = await taskManager.getQueueStats();
    const workerStats = await taskManager.getWorkerStats();

    let health = "healthy";
    if ((queueStats.failed || 0) > 10) health = "critical";
    else if ((queueStats.pending || 0) > 1000) health = "degraded";

    return {
      status: health,
      timestamp: new Date().toISOString(),
      queue: { ...queueStats, modes: { draining: false, paused: false } },
      workers: workerStats,
    };
  })

  // Worker stats
  .get("/api/workers/stats", async () => {
    return await taskManager.getWorkerStats();
  })

  .listen(3000);

console.log(`
==========================================
  Workalot Dashboard Demo Server
==========================================

  Dashboard:  http://localhost:3001/dashboard
  API:        http://localhost:3000/api
  Health:     http://localhost:3000/api/health

  Features:
  - Auto-submits demo jobs every 3 seconds
  - ~10% of jobs fail for testing retry
  - Jobs show up in dashboard immediately

  To connect external dashboard:
  WORKALOT_API_URL=http://localhost:3000 bun run examples/dashboard/standalone-server.ts

==========================================
`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  clearInterval(jobInterval);
  await taskManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  clearInterval(jobInterval);
  await taskManager.shutdown();
  process.exit(0);
});

// Serialize job for API response
function serializeJob(job: any) {
  return {
    id: job.id,
    jobFile: (job.jobPayload as any)?.jobFile || "examples/_jobs/PingJob.ts",
    jobPayload: (job.jobPayload as any)?.jobPayload || {},
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
