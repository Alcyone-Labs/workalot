#!/usr/bin/env bun
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { QueueFactory } from "#/index.js";
import { QueueConfig, JobStatus } from "#/types/index.js";

// Configuration
const backend = (process.env.BACKEND as any) || "memory";
const databaseUrl = process.env.DB_URL;
const port = parseInt(process.env.PORT || "3000");

console.log(`Starting Dashboard Server...`);
console.log(`Backend: ${backend}`);
if (databaseUrl) console.log(`Database URL: ${databaseUrl}`);

// Queue Setup
// We use QueueFactory directly to avoid starting workers (TaskManager starts workers).
// We set maxThreads to 1 to pass validation, but no workers will be spawned by this process.
const config: QueueConfig = {
    backend,
    databaseUrl,
    maxThreads: 1,
    silent: true
};

// Create the queue backend
const queueManager = QueueFactory.createAutoQueue(config);

// Initialize
try {
    await queueManager.initialize();
    console.log("✅ Queue Backend initialized (Monitor Mode)");
} catch (error) {
    console.error("❌ Failed to initialize Queue Backend:", error);
    process.exit(1);
}

// Helpers
async function getAllJobs(limit = 50, statusFilter?: string) {
    const statuses = statusFilter
        ? [statusFilter as JobStatus]
        : [JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.COMPLETED, JobStatus.FAILED];

    let allJobs: any[] = [];

    for (const status of statuses) {
        try {
            const jobs = await queueManager.getJobsByStatus(status);
            allJobs = allJobs.concat(jobs);
        } catch (err) {
            console.error(`Error fetching ${status} jobs:`, err);
        }
    }

    // Sort by creation time descending (newest first)
    return allJobs
        .sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
        })
        .slice(0, limit);
}

// Server
const app = new Elysia()
    .use(cors())
    .use(staticPlugin({
        assets: "examples/dashboard/public",
        prefix: "/"
    }))

    // API
    .get("/api/stats", async () => {
        const queue = await queueManager.getStats();
        // We don't have worker stats because we are not orchestrating them.
        // We return empty worker stats or null.
        const workers = {
            totalWorkers: 0,
            busyWorkers: 0,
            availableWorkers: 0
        };
        return { queue, workers };
    })

    .get("/api/jobs", async ({ query }) => {
        const limit = parseInt(query.limit as string) || 50;
        const status = query.status as string;
        const jobs = await getAllJobs(limit, status);
        return jobs;
    })

    .get("/api/jobs/:id", async ({ params, set }) => {
        // Try getJob if backend supports it directly efficiently?
        // IQueueBackend has getJob(id).
        try {
            const job = await queueManager.getJob(params.id);
            if (!job) {
                set.status = 404;
                return { error: "Job not found" };
            }
            return job;
        } catch (err) {
            // Fallback to searching lists if getJob not implemented or fails?
            // But getJob IS abstract in IQueueBackend, so it must be implemented.
             set.status = 500;
             return { error: `Error fetching job: ${err}` };
        }
    })

    .post("/api/jobs/:id/retry", async ({ params, set }) => {
        try {
            const job = await queueManager.getJob(params.id);

            if (!job) {
                set.status = 404;
                return { error: "Job not found" };
            }

            if (!job.jobPayload) {
                 set.status = 400;
                 return { error: "Job payload missing" };
            }

            // Re-schedule
            // We re-add the job.
            // Note: addJob takes (jobPayload, customId).
            // We usually want a new ID for the retry, or maybe we want to reuse the ID?
            // Usually retry creates a new job or resets the existing one.
            // If we addJob, we get a new ID.

            const newId = await queueManager.addJob(job.jobPayload);
            return { success: true, message: "Job retried", newId };
        } catch (err) {
            set.status = 500;
            return { error: `Failed to retry: ${err}` };
        }
    })

    .listen(port);

console.log(`
🚀 Workalot Dashboard Running
   http://localhost:${port}
`);

process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await queueManager.shutdown();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await queueManager.shutdown();
    process.exit(0);
});
