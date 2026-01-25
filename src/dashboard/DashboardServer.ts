import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { QueueFactory } from "../queue/QueueFactory.js";
import { QueueConfig, JobStatus } from "../types/index.js";
import { IQueueBackend } from "../queue/IQueueBackend.js";

export interface DashboardConfig {
  port?: number;
  queueConfig?: QueueConfig;
  hostname?: string;
}

export class DashboardServer {
  private app: Elysia;
  private queueManager: IQueueBackend;
  private port: number;
  private hostname: string;
  private publicPath: string;

  constructor(config: DashboardConfig = {}) {
    this.port = config.port || 3000;
    this.hostname = config.hostname || "localhost";

    // Resolve public path relative to this file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    this.publicPath = join(__dirname, "public");

    // Initialize Queue (Monitor Mode)
    // We force maxThreads to 1 to satisfy validation, but we won't start workers here
    const qConfig: QueueConfig = {
      ...(config.queueConfig || {}),
      maxThreads: 1,
      silent: true // reduce logs
    };

    // If no backend specified, default to memory
    if (!qConfig.backend) {
        qConfig.backend = "memory";
    }

    this.queueManager = QueueFactory.createAutoQueue(qConfig);

    this.app = this.createApp();
  }

  private createApp(): Elysia {
    const app = new Elysia()
      .use(cors())
      .use(staticPlugin({
        assets: this.publicPath,
        prefix: "/"
      }));

    // API Routes
    app.get("/api/stats", async () => {
      const queue = await this.queueManager.getStats();
      const workers = {
        totalWorkers: 0,
        busyWorkers: 0,
        availableWorkers: 0
      };
      return { queue, workers };
    });

    app.get("/api/jobs", async ({ query }) => {
      const limit = parseInt((query as any).limit) || 50;
      const status = (query as any).status as string;
      const jobs = await this.getAllJobs(limit, status);
      return jobs;
    });

    app.get("/api/jobs/:id", async ({ params, set }) => {
      try {
        const job = await this.queueManager.getJob(params.id);
        if (!job) {
          set.status = 404;
          return { error: "Job not found" };
        }
        return job;
      } catch (err) {
        set.status = 500;
        return { error: `Error fetching job: ${err}` };
      }
    });

    app.post("/api/jobs/:id/retry", async ({ params, set }) => {
      try {
        const job = await this.queueManager.getJob(params.id);

        if (!job) {
          set.status = 404;
          return { error: "Job not found" };
        }

        if (!job.jobPayload) {
          set.status = 400;
          return { error: "Job payload missing" };
        }

        const newId = await this.queueManager.addJob(job.jobPayload);
        return { success: true, message: "Job retried", newId };
      } catch (err) {
        set.status = 500;
        return { error: `Failed to retry: ${err}` };
      }
    });

    return app;
  }

  private async getAllJobs(limit = 50, statusFilter?: string) {
    const statuses = statusFilter
      ? [statusFilter as JobStatus]
      : [JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.COMPLETED, JobStatus.FAILED];

    let allJobs: any[] = [];

    for (const status of statuses) {
      try {
        const jobs = await this.queueManager.getJobsByStatus(status);
        allJobs = allJobs.concat(jobs);
      } catch (err) {
        console.error(`Error fetching ${status} jobs:`, err);
      }
    }

    return allJobs
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      })
      .slice(0, limit);
  }

  public async start() {
    await this.queueManager.initialize();
    this.app.listen({
        port: this.port,
        hostname: this.hostname
    });
    console.log(`
🚀 Workalot Dashboard Running
   http://${this.hostname}:${this.port}
`);
  }

  public async stop() {
    await this.queueManager.shutdown();
    await this.app.stop();
  }
}
