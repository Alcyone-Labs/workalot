#!/usr/bin/env bun
/**
 * Full-Stack Workalot Example - Backend Server
 *
 * This server demonstrates how to integrate Workalot with a web application.
 * It uses Elysia.js as the web framework and Workalot for background job processing.
 */

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { TaskManager } from "#/index.js";
import { JobStatus } from "#/types/index.js";

// Initialize TaskManager
const taskManager = new TaskManager({
  backend: "memory",
  maxThreads: 4,
  silent: false,
});

await taskManager.initialize();
console.log("✅ Workalot TaskManager initialized");

// Job type mapping
const JOB_TYPE_MAP: Record<string, string> = {
  "image-processing": "ImageProcessingJob",
  "data-analysis": "DataAnalysisJob",
  "report-generation": "ReportGenerationJob",
};

// Store job metadata (in production, use a database)
const jobMetadata = new Map<
  string,
  {
    id: string;
    type: string;
    status: JobStatus;
    createdAt: string;
    completedAt?: string;
    result?: any;
    error?: string;
  }
>();

// Create Elysia app
const app = new Elysia()
  .use(cors())
  .use(
    staticPlugin({
      assets: "examples/full-stack/frontend",
      prefix: "/",
    }),
  )

  // Health check
  .get("/api/health", () => ({
    status: "ok",
    workalot: "running",
    timestamp: new Date().toISOString(),
  }))

  // Submit a new job
  .post("/api/jobs", async ({ body, set }) => {
    try {
      const { type, payload } = body as {
        type: string;
        payload: Record<string, any>;
      };

      // Validate job type
      const jobClassName = JOB_TYPE_MAP[type];
      if (!jobClassName) {
        set.status = 400;
        return {
          error: "Invalid job type",
          validTypes: Object.keys(JOB_TYPE_MAP),
        };
      }

      // Schedule the job
      const jobId = await taskManager.schedule({
        jobFile: `examples/full-stack/jobs/${jobClassName}.ts`,
        jobPayload: payload,
      });

      // Store metadata
      jobMetadata.set(jobId, {
        id: jobId,
        type,
        status: JobStatus.PENDING,
        createdAt: new Date().toISOString(),
      });

      // Monitor job completion
      monitorJob(jobId);

      return {
        jobId,
        type,
        status: "pending",
        message: "Job submitted successfully",
      };
    } catch (error) {
      set.status = 500;
      return {
        error: "Failed to submit job",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Get job status
  .get("/api/jobs/:jobId", async ({ params, set }) => {
    const { jobId } = params;
    const metadata = jobMetadata.get(jobId);

    if (!metadata) {
      set.status = 404;
      return { error: "Job not found" };
    }

    // Get current status from TaskManager
    const jobs = await taskManager.getJobsByStatus(metadata.status);
    const job = jobs.find((j) => j.id === jobId);

    if (job) {
      metadata.status = job.status;
    }

    return metadata;
  })

  // Get all jobs
  .get("/api/jobs", async () => {
    const jobs = Array.from(jobMetadata.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return { jobs, total: jobs.length };
  })

  // Get queue statistics
  .get("/api/stats", async () => {
    const stats = await taskManager.getQueueStats();
    const workerStats = await taskManager.getWorkerStats();

    return {
      queue: stats,
      workers: workerStats,
      jobs: {
        total: jobMetadata.size,
        byStatus: {
          pending: Array.from(jobMetadata.values()).filter((j) => j.status === JobStatus.PENDING)
            .length,
          running: Array.from(jobMetadata.values()).filter((j) => j.status === JobStatus.PROCESSING)
            .length,
          completed: Array.from(jobMetadata.values()).filter(
            (j) => j.status === JobStatus.COMPLETED,
          ).length,
          failed: Array.from(jobMetadata.values()).filter((j) => j.status === JobStatus.FAILED)
            .length,
        },
      },
    };
  })

  // Clear all jobs (for testing)
  .delete("/api/jobs", async () => {
    jobMetadata.clear();
    return { message: "All jobs cleared" };
  })

  .listen(3000);

console.log(`
🚀 Full-Stack Workalot Example Server Running

📍 Server: http://localhost:${app.server?.port}
📊 API:    http://localhost:${app.server?.port}/api/stats
🌐 Web UI: http://localhost:${app.server?.port}

Available Job Types:
  - image-processing
  - data-analysis
  - report-generation

Press Ctrl+C to stop
`);

// Monitor job completion
async function monitorJob(jobId: string): Promise<void> {
  const metadata = jobMetadata.get(jobId);
  if (!metadata) return;

  // Poll for job completion
  const checkInterval = setInterval(async () => {
    try {
      const jobs = await taskManager.getJobsByStatus(JobStatus.COMPLETED);
      const completedJob = jobs.find((j) => j.id === jobId);

      if (completedJob) {
        metadata.status = JobStatus.COMPLETED;
        metadata.completedAt = new Date().toISOString();
        metadata.result = completedJob.result;
        clearInterval(checkInterval);
        return;
      }

      // Check for failed jobs
      const failedJobs = await taskManager.getJobsByStatus(JobStatus.FAILED);
      const failedJob = failedJobs.find((j) => j.id === jobId);

      if (failedJob) {
        metadata.status = JobStatus.FAILED;
        metadata.completedAt = new Date().toISOString();
        metadata.error = failedJob.error;
        clearInterval(checkInterval);
        return;
      }

      // Check for running jobs
      const runningJobs = await taskManager.getJobsByStatus(JobStatus.PROCESSING);
      const runningJob = runningJobs.find((j) => j.id === jobId);

      if (runningJob) {
        metadata.status = JobStatus.PROCESSING;
      }
    } catch (error) {
      console.error(`Error monitoring job ${jobId}:`, error);
    }
  }, 500);

  // Cleanup after 5 minutes
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 300000);
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await taskManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await taskManager.shutdown();
  process.exit(0);
});
