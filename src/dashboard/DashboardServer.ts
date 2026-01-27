import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { QueueFactory } from "../queue/QueueFactory.js";
import { QueueConfig, JobStatus, QueueItem } from "../types/index.js";
import { IQueueBackend } from "../queue/IQueueBackend.js";
import { Simulator } from "./Simulator.js";

export interface DashboardConfig {
  port?: number;
  queueConfig?: QueueConfig;
  hostname?: string;
}

export class DashboardServer {
  private app: Elysia;
  private queueManager: IQueueBackend;
  private simulator: Simulator;
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
    const qConfig: QueueConfig = {
      ...(config.queueConfig || {}),
      maxThreads: 1,
      silent: true
    };

    if (!qConfig.backend) {
        qConfig.backend = "memory";
    }

    this.queueManager = QueueFactory.createAutoQueue(qConfig);
    this.simulator = new Simulator(this.queueManager);

    this.app = this.createApp();
  }

  private createApp(): Elysia {
    const app = new Elysia()
      .use(cors())
      .use(staticPlugin({
        assets: this.publicPath,
        prefix: "/"
      }));

    // WebSocket for streaming updates
    app.ws("/ws", {
      open(ws) {
        ws.subscribe("dashboard");
        // Send initial stats?
      },
      message(ws, message) {
        // Handle incoming messages if needed
      }
    });

    // Hook into queue events
    this.setupEventHooks(app);

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

    app.post("/api/jobs/:id/stop", async ({ params, set }) => {
      try {
        const job = await this.queueManager.getJob(params.id);
        if (!job) {
          set.status = 404;
          return { error: "Job not found" };
        }

        // Only stop/cancel if not already completed/failed
        if (job.status === JobStatus.PENDING || job.status === JobStatus.PROCESSING) {
          await this.queueManager.updateJobStatus(
            params.id,
            JobStatus.CANCELLED,
            undefined,
            new Error("Cancelled by user")
          );
          return { success: true, message: "Job cancelled" };
        } else {
           return { success: false, message: `Job is already ${job.status}` };
        }
      } catch (err) {
        set.status = 500;
        return { error: `Failed to stop job: ${err}` };
      }
    });

    // Simulation API
    app.post("/api/simulation/start", ({ body }) => {
        const opts = body as any || {};
        this.simulator.start(opts);
        return this.simulator.getStatus();
    });

    app.post("/api/simulation/stop", () => {
        this.simulator.stop();
        return this.simulator.getStatus();
    });

    app.get("/api/simulation/status", () => {
        return this.simulator.getStatus();
    });

    return app;
  }

  private setupEventHooks(app: Elysia) {
    const broadcast = (type: string, data: any) => {
      app.server?.publish("dashboard", JSON.stringify({ type, data }));
    };

    this.queueManager.on('item-added', (item: QueueItem) => {
      broadcast('job-added', item);
    });

    this.queueManager.on('item-updated', (item: QueueItem) => {
      broadcast('job-updated', item);
    });

    // We can also listen to specific completion events if we want
    // but item-updated covers status changes.
  }

  private async getAllJobs(limit = 50, statusFilter?: string) {
    const statuses = statusFilter
      ? [statusFilter as JobStatus]
      : [JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED];

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
    this.simulator.stop();
    await this.queueManager.shutdown();
    await this.app.stop();
  }
}
