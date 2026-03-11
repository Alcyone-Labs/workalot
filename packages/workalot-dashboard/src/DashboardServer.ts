import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { QueueFactory, IQueueBackend, QueueConfig, JobStatus, QueueItem, type JobStatus as JobStatusType } from "@alcyone-labs/workalot";
import { formatJobForApi } from "./formatJobForApi.js";
import { Simulator } from "./Simulator.js";
import { TelemetryService } from "@alcyone-labs/workalot-telemetry";
import type { AuthMiddleware, AuthContext } from "./middleware/auth.js";

export interface DashboardConfig {
  port?: number;
  queueConfig?: QueueConfig;
  hostname?: string;
  /** Authentication configuration */
  auth?: {
    /** Enable authentication */
    enabled: boolean;
    /** JWT secret for token validation */
    jwtSecret?: string;
    /** API keys for service-to-service auth */
    apiKeys?: string[];
    /** Custom auth middleware */
    middleware?: AuthMiddleware;
  };
  /** Enable telemetry collection */
  telemetry?: {
    enabled: boolean;
    /** Service name for tracing */
    serviceName?: string;
    /** OpenTelemetry collector endpoint */
    otlpEndpoint?: string;
  };
}

export interface WorkerInfo {
  id: number;
  state: 'idle' | 'busy' | 'error' | 'disconnected';
  currentJobId?: string;
  jobsProcessed: number;
  lastSeen: Date;
}

/**
 * Enhanced Dashboard Server with telemetry, auth, and bulk operations
 */
export class DashboardServer {
  private app: Elysia;
  private queueManager: IQueueBackend;
  private simulator: Simulator;
  private port: number;
  private hostname: string;
  private publicPath: string;
  private config: DashboardConfig;
  private telemetry?: TelemetryService;
  private workers = new Map<number, WorkerInfo>();
  private authMiddleware?: AuthMiddleware;

  constructor(config: DashboardConfig = {}) {
    this.config = config;
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

    // Initialize auth middleware if configured
    if (config.auth?.enabled) {
      this.authMiddleware = config.auth.middleware || this.createDefaultAuthMiddleware();
    }

    this.app = this.createApp();
  }

  private createApp(): Elysia {
    const app = new Elysia()
      .use(cors())
      .use(staticPlugin({
        assets: this.publicPath,
        prefix: "/"
      }));

    // Health check endpoint (no auth required)
    app.get("/health", () => ({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0"
    }));

    // Prometheus metrics endpoint (no auth required for scraping)
    app.get("/metrics", async () => {
      if (this.telemetry) {
        return this.telemetry.getPrometheusMetrics();
      }
      return "# Telemetry not enabled\n";
    });

    // WebSocket for streaming updates
    app.ws("/ws", {
      open: (ws) => {
        // Check auth if enabled
        if (this.authMiddleware) {
          const token = ws.data.query?.token as string;
          if (!token || !this.validateToken(token)) {
            ws.close(1008, "Unauthorized");
            return;
          }
        }
        ws.subscribe("dashboard");
      },
      message: (ws, message) => {
        // Handle incoming messages if needed
        console.log("WS message:", message);
      }
    });

    // Hook into queue events
    this.setupEventHooks(app);

    // Apply auth middleware to API routes if enabled
    if (this.authMiddleware) {
      // Use onBeforeHandle to check authentication before API routes
      app.onBeforeHandle(async (context) => {
        const result = await this.authMiddleware!(context as AuthContext);
        if (result) {
          // If middleware returns something, it's an error response
          return result;
        }
      });
    }

    // API Routes
    this.setupApiRoutes(app);

    return app;
  }

  private setupApiRoutes(app: Elysia) {
    // Statistics endpoint
    app.get("/api/stats", async () => {
      const queue = await this.queueManager.getStats();
      const workers = this.getWorkerStats();
      
      return { 
        queue, 
        workers,
        telemetry: this.telemetry?.isActive() || false
      };
    });

    // Workers endpoint - NEW
    app.get("/api/workers", () => {
      return {
        workers: Array.from(this.workers.values()),
        total: this.workers.size,
        idle: Array.from(this.workers.values()).filter(w => w.state === 'idle').length,
        busy: Array.from(this.workers.values()).filter(w => w.state === 'busy').length,
      };
    });

    app.get("/api/workers/:id", ({ params, set }) => {
      const worker = this.workers.get(parseInt(params.id));
      if (!worker) {
        set.status = 404;
        return { error: "Worker not found" };
      }
      return worker;
    });

    // Jobs endpoints
    app.get("/api/jobs", async ({ query }) => {
      const limit = parseInt((query as any).limit) || 50;
      const status = (query as any).status as string;
      const search = (query as any).search as string;
      
      let jobs = await this.getAllJobs(limit, status);
      
      // Search functionality - NEW
      if (search) {
        jobs = jobs.filter(job => {
          const searchable = JSON.stringify(job.jobPayload).toLowerCase();
          return searchable.includes(search.toLowerCase()) || 
                 job.id.toLowerCase().includes(search.toLowerCase());
        });
      }
      
      return jobs.map(formatJobForApi);
    });

    app.get("/api/jobs/:id", async ({ params, set }) => {
      try {
        const job = await this.queueManager.getJob(params.id);
        if (!job) {
          set.status = 404;
          return { error: "Job not found" };
        }
        return formatJobForApi(job);
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
        
        this.telemetry?.emitEvent({
          type: 'job.retry',
          timestamp: new Date(),
          jobId: params.id,
          attributes: { newJobId: newId }
        });
        
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

        if (job.status === JobStatus.PENDING || job.status === JobStatus.PROCESSING) {
          await this.queueManager.updateJobStatus(
            params.id,
            JobStatus.CANCELLED,
            undefined,
            new Error("Cancelled by user")
          );
          
          this.telemetry?.emitEvent({
            type: 'job.cancelled',
            timestamp: new Date(),
            jobId: params.id
          });
          
          return { success: true, message: "Job cancelled" };
        } else {
           return { success: false, message: `Job is already ${job.status}` };
        }
      } catch (err) {
        set.status = 500;
        return { error: `Failed to stop job: ${err}` };
      }
    });

    // Bulk operations - NEW
    app.post("/api/jobs/bulk/retry", async ({ body, set }) => {
      try {
        const { jobIds } = body as { jobIds: string[] };
        if (!Array.isArray(jobIds) || jobIds.length === 0) {
          set.status = 400;
          return { error: "jobIds array required" };
        }

        const results = await Promise.all(
          jobIds.map(async (jobId) => {
            try {
              const job = await this.queueManager.getJob(jobId);
              if (!job || !job.jobPayload) {
                return { jobId, success: false, error: "Job not found or no payload" };
              }
              const newId = await this.queueManager.addJob(job.jobPayload);
              return { jobId, success: true, newId };
            } catch (err) {
              return { jobId, success: false, error: String(err) };
            }
          })
        );

        const successCount = results.filter(r => r.success).length;
        return { 
          success: true, 
          processed: jobIds.length, 
          succeeded: successCount,
          failed: jobIds.length - successCount,
          results 
        };
      } catch (err) {
        set.status = 500;
        return { error: `Bulk retry failed: ${err}` };
      }
    });

    app.post("/api/jobs/bulk/cancel", async ({ body, set }) => {
      try {
        const { jobIds } = body as { jobIds: string[] };
        if (!Array.isArray(jobIds) || jobIds.length === 0) {
          set.status = 400;
          return { error: "jobIds array required" };
        }

        const results = await Promise.all(
          jobIds.map(async (jobId) => {
            try {
              const job = await this.queueManager.getJob(jobId);
              if (!job) {
                return { jobId, success: false, error: "Job not found" };
              }
              if (job.status !== JobStatus.PENDING && job.status !== JobStatus.PROCESSING) {
                return { jobId, success: false, error: `Job is ${job.status}` };
              }
              await this.queueManager.updateJobStatus(
                jobId,
                JobStatus.CANCELLED,
                undefined,
                new Error("Cancelled by bulk operation")
              );
              return { jobId, success: true };
            } catch (err) {
              return { jobId, success: false, error: String(err) };
            }
          })
        );

        const successCount = results.filter(r => r.success).length;
        return { 
          success: true, 
          processed: jobIds.length, 
          succeeded: successCount,
          failed: jobIds.length - successCount,
          results 
        };
      } catch (err) {
        set.status = 500;
        return { error: `Bulk cancel failed: ${err}` };
      }
    });

    // Search endpoint - NEW
    app.get("/api/jobs/search", async ({ query }) => {
      const q = (query as any).q as string;
      const limit = parseInt((query as any).limit) || 50;
      
      if (!q || q.length < 2) {
        return { error: "Search query must be at least 2 characters" };
      }

      const allJobs = await this.getAllJobs(1000); // Get more for search
      const results = allJobs.filter(job => {
        const searchable = JSON.stringify({
          id: job.id,
          payload: job.jobPayload,
          error: job.error?.message,
          result: job.result
        }).toLowerCase();
        return searchable.includes(q.toLowerCase());
      }).slice(0, limit);

      return {
        query: q,
        count: results.length,
        jobs: results.map(formatJobForApi)
      };
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
  }

  private setupEventHooks(app: Elysia) {
    const broadcast = (type: string, data: any) => {
      app.server?.publish("dashboard", JSON.stringify({ type, data }));
    };

    this.queueManager.on('item-added', (item: QueueItem) => {
      broadcast('job-added', formatJobForApi(item));
    });

    this.queueManager.on('item-updated', (item: QueueItem) => {
      broadcast('job-updated', formatJobForApi(item));
    });

    this.queueManager.on('item-completed', (item: QueueItem) => {
      broadcast('job-completed', formatJobForApi(item));
    });

    this.queueManager.on('item-failed', (item: QueueItem) => {
      broadcast('job-failed', formatJobForApi(item));
    });
  }

  private async getAllJobs(limit = 50, statusFilter?: string) {
    const statuses = statusFilter
      ? [statusFilter as JobStatus]
      : [JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED];

    let allJobs: QueueItem[] = [];

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
        const timeA = a.requestedAt ? a.requestedAt.getTime() : 0;
        const timeB = b.requestedAt ? b.requestedAt.getTime() : 0;
        return timeB - timeA;
      })
      .slice(0, limit);
  }

  private getWorkerStats() {
    const workers = Array.from(this.workers.values());
    return {
      totalWorkers: workers.length,
      busyWorkers: workers.filter(w => w.state === 'busy').length,
      availableWorkers: workers.filter(w => w.state === 'idle').length,
      workers: workers
    };
  }

  private createDefaultAuthMiddleware(): AuthMiddleware {
    return async ({ headers, set }) => {
      const authHeader = headers?.authorization;
      if (!authHeader) {
        set.status = 401;
        return { error: "Authorization required" };
      }

      const token = authHeader.replace('Bearer ', '');
      if (!this.validateToken(token)) {
        set.status = 401;
        return { error: "Invalid token" };
      }
    };
  }

  private validateToken(token: string): boolean {
    // Simple validation - in production, use JWT verification
    if (this.config.auth?.apiKeys) {
      return this.config.auth.apiKeys.includes(token);
    }
    if (this.config.auth?.jwtSecret) {
      // JWT validation would go here
      return token.length > 20; // Placeholder
    }
    return false;
  }

  /**
   * Register a worker with the dashboard
   */
  registerWorker(workerId: number, info: Partial<WorkerInfo> = {}) {
    this.workers.set(workerId, {
      id: workerId,
      state: 'idle',
      jobsProcessed: 0,
      lastSeen: new Date(),
      ...info
    });
  }

  /**
   * Update worker status
   */
  updateWorker(workerId: number, update: Partial<WorkerInfo>) {
    const worker = this.workers.get(workerId);
    if (worker) {
      Object.assign(worker, update, { lastSeen: new Date() });
    }
  }

  /**
   * Unregister a worker
   */
  unregisterWorker(workerId: number) {
    this.workers.delete(workerId);
  }

  public async start() {
    // Initialize telemetry if configured
    if (this.config.telemetry?.enabled) {
      this.telemetry = TelemetryService.getInstance({
        enabled: true,
        serviceName: this.config.telemetry.serviceName || 'workalot-dashboard',
        otlpEndpoint: this.config.telemetry.otlpEndpoint,
        prometheus: { enabled: true, port: this.port, path: '/metrics' }
      });
      await this.telemetry.initialize();
    }

    await this.queueManager.initialize();
    this.app.listen({
        port: this.port,
        hostname: this.hostname
    });
    console.log(`
🚀 Workalot Dashboard Running
   http://${this.hostname}:${this.port}
   ${this.config.auth?.enabled ? '🔒 Authentication enabled' : '⚠️  No authentication'}
   ${this.telemetry?.isActive() ? '📊 Telemetry enabled' : ''}
`);
  }

  public async stop() {
    this.simulator.stop();
    await this.telemetry?.shutdown();
    await this.queueManager.shutdown();
    await this.app.stop();
  }

  /**
   * Get the Elysia app instance for testing/customization
   */
  getApp(): Elysia {
    return this.app;
  }
}
