import { EventEmitter } from "node:events";
import {
  WebSocketServer,
  WebSocketConnection,
  MessageRoute,
} from "../communication/WebSocketServer.js";
import {
  BatchJobContext,
  WorkerQueueStatus,
  WorkerQueueConfig,
  JobResult,
  WorkerMessage,
  WorkerMessageType,
  FillQueuePayload,
  RequestJobsPayload,
  JobAckPayload,
  QueueResultPayload,
  JobPayload,
  QueueItem,
  JobStatus,
} from "../types/index.js";
import { IQueueBackend } from "../queue/IQueueBackend.js";
import { QueueFactory } from "../queue/QueueFactory.js";
import { ulid } from "ulidx";

export interface OrchestratorConfig {
  // WebSocket server configuration
  wsPort?: number;
  wsHostname?: string;

  // Worker queue configuration
  workerQueueSize?: number;
  queueThreshold?: number;
  ackTimeout?: number;
  enableWorkerQueues?: boolean;

  // Orchestration configuration
  distributionStrategy?: "round-robin" | "least-loaded" | "random" | "custom";
  maxRetries?: number;
  retryDelay?: number;

  // Queue backend configuration
  queueBackend?: IQueueBackend;
  queueConfig?: any;
}

export interface WorkerState {
  workerId: number;
  status: WorkerQueueStatus;
  lastFillTime: number;
  pendingAcks: Set<string>;
  connectionId?: string;
  customMetadata?: Record<string, any>;
}

export interface JobDistributionContext {
  job: QueueItem;
  availableWorkers: WorkerState[];
  orchestratorState: any;
}

export interface WorkflowStep {
  jobPayload: JobPayload;
  dependencies?: string[];
  onComplete?: (result: JobResult) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: Map<string, WorkflowStep>;
  currentStep?: string;
  completedSteps: Set<string>;
  results: Map<string, JobResult>;
}

/**
 * Base orchestrator class for extensible task orchestration
 * Library users can extend this class to create custom orchestrators
 */
export abstract class BaseOrchestrator extends EventEmitter {
  protected wsServer: WebSocketServer;
  protected config: OrchestratorConfig;
  protected workers = new Map<number, WorkerState>();
  protected jobToWorkerMap = new Map<string, number>();
  protected queueBackend?: IQueueBackend;
  protected isRunning = false;
  protected distributionInterval?: NodeJS.Timeout;
  protected workflows = new Map<string, WorkflowDefinition>();

  constructor(config: OrchestratorConfig = {}) {
    super();
    this.config = {
      wsPort: config.wsPort || 8080,
      wsHostname: config.wsHostname || "localhost",
      workerQueueSize: config.workerQueueSize || 50,
      queueThreshold: config.queueThreshold || 10,
      ackTimeout: config.ackTimeout || 5000,
      enableWorkerQueues: config.enableWorkerQueues !== false,
      distributionStrategy: config.distributionStrategy || "least-loaded",
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      ...config,
    };

    // Initialize WebSocket server
    this.wsServer = new WebSocketServer({
      port: this.config.wsPort,
      hostname: this.config.wsHostname,
      enableMessageRecovery: true,
      enableHeartbeat: true,
    });

    // Set up queue backend if provided
    this.queueBackend = config.queueBackend;

    this.setupEventHandlers();
    this.registerCustomRoutes();
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Orchestrator is already running");
    }

    // Initialize queue backend if not provided
    if (!this.queueBackend && this.config.queueConfig) {
      this.queueBackend = await QueueFactory.createQueue(
        this.config.queueConfig,
      );
      await this.queueBackend.initialize();
    }

    // Start WebSocket server
    await this.wsServer.start();

    // Start distribution loop
    this.startDistributionLoop();

    this.isRunning = true;

    // Call lifecycle hook
    await this.onStart();

    this.emit("orchestrator-started");
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Call lifecycle hook
    await this.onStop();

    // Stop distribution loop
    if (this.distributionInterval) {
      clearInterval(this.distributionInterval);
      this.distributionInterval = undefined;
    }

    // Stop WebSocket server
    await this.wsServer.stop();

    // Shutdown queue backend
    if (this.queueBackend) {
      await this.queueBackend.shutdown();
    }

    this.isRunning = false;
    this.workers.clear();
    this.jobToWorkerMap.clear();
    this.workflows.clear();

    this.emit("orchestrator-stopped");
  }

  /**
   * Register a worker with the orchestrator
   */
  protected registerWorker(workerId: number, connectionId: string): void {
    const workerState: WorkerState = {
      workerId,
      status: {
        workerId,
        pendingJobs: 0,
        processingJobs: 0,
        completedJobs: 0,
        totalProcessed: 0,
        queueUtilization: 0,
        needsMoreJobs: true,
      },
      lastFillTime: 0,
      pendingAcks: new Set(),
      connectionId,
    };

    this.workers.set(workerId, workerState);

    // Call lifecycle hook
    this.onWorkerRegistered(workerId, workerState);

    this.emit("worker-registered", { workerId, connectionId });
  }

  /**
   * Unregister a worker from the orchestrator
   */
  protected unregisterWorker(workerId: number): void {
    const workerState = this.workers.get(workerId);
    if (!workerState) {
      return;
    }

    // Clean up pending ACKs
    for (const jobId of workerState.pendingAcks) {
      this.jobToWorkerMap.delete(jobId);

      // Requeue the job
      if (this.queueBackend) {
        this.queueBackend.updateJobStatus(jobId, JobStatus.PENDING);
      }
    }

    // Call lifecycle hook
    this.onWorkerUnregistered(workerId, workerState);

    this.workers.delete(workerId);
    this.emit("worker-unregistered", workerId);
  }

  /**
   * Schedule a job
   */
  async scheduleJob(
    jobPayload: JobPayload,
    customId?: string,
  ): Promise<string> {
    // Call lifecycle hook for validation/transformation
    const transformedPayload = await this.beforeJobSchedule(jobPayload);

    if (!this.queueBackend) {
      throw new Error("Queue backend not initialized");
    }

    const jobId = await this.queueBackend.addJob(transformedPayload, customId);

    // Call lifecycle hook
    await this.onJobScheduled(jobId, transformedPayload);

    this.emit("job-scheduled", { jobId, payload: transformedPayload });

    return jobId;
  }

  /**
   * Create and start a workflow
   */
  async startWorkflow(
    definition: Omit<WorkflowDefinition, "completedSteps" | "results">,
  ): Promise<string> {
    const workflow: WorkflowDefinition = {
      ...definition,
      completedSteps: new Set(),
      results: new Map(),
    };

    this.workflows.set(workflow.id, workflow);

    // Start the first steps (those with no dependencies)
    const initialSteps = Array.from(workflow.steps.entries()).filter(
      ([_, step]) => !step.dependencies || step.dependencies.length === 0,
    );

    for (const [stepId, step] of initialSteps) {
      await this.executeWorkflowStep(workflow.id, stepId);
    }

    this.emit("workflow-started", {
      workflowId: workflow.id,
      name: workflow.name,
    });

    return workflow.id;
  }

  /**
   * Execute a workflow step
   */
  protected async executeWorkflowStep(
    workflowId: string,
    stepId: string,
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow ${workflowId}`);
    }

    // Check dependencies
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (!workflow.completedSteps.has(dep)) {
          return; // Dependencies not met
        }
      }
    }

    // Schedule the job with workflow metadata
    const jobPayload = {
      ...step.jobPayload,
      jobPayload: {
        ...step.jobPayload.jobPayload,
        __workflow: {
          workflowId,
          stepId,
        },
      },
    };

    const jobId = await this.scheduleJob(jobPayload);

    this.emit("workflow-step-started", { workflowId, stepId, jobId });
  }

  /**
   * Handle job completion for workflow
   */
  protected async handleWorkflowJobCompletion(
    jobId: string,
    result: JobResult,
    workflowId: string,
    stepId: string,
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return;
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      return;
    }

    // Mark step as completed
    workflow.completedSteps.add(stepId);
    workflow.results.set(stepId, result);

    // Call step completion handler
    if (step.onComplete) {
      await step.onComplete(result);
    }

    this.emit("workflow-step-completed", { workflowId, stepId, result });

    // Check for next steps
    const nextSteps = Array.from(workflow.steps.entries()).filter(([id, s]) => {
      if (workflow.completedSteps.has(id)) {
        return false;
      }
      if (!s.dependencies) {
        return false;
      }
      return s.dependencies.every((dep) => workflow.completedSteps.has(dep));
    });

    for (const [nextStepId] of nextSteps) {
      await this.executeWorkflowStep(workflowId, nextStepId);
    }

    // Check if workflow is complete
    if (workflow.completedSteps.size === workflow.steps.size) {
      this.emit("workflow-completed", {
        workflowId,
        results: Object.fromEntries(workflow.results),
      });
      this.workflows.delete(workflowId);
    }
  }

  /**
   * Distribute jobs to workers
   */
  protected async distributeJobs(): Promise<void> {
    if (!this.queueBackend) {
      return;
    }

    const workersNeedingJobs = this.getWorkersNeedingJobs();
    if (workersNeedingJobs.length === 0) {
      return;
    }

    for (const worker of workersNeedingJobs) {
      const jobsNeeded = Math.min(
        this.config.workerQueueSize! - worker.status.pendingJobs,
        10, // Max batch size
      );

      const jobs: BatchJobContext[] = [];

      for (let i = 0; i < jobsNeeded; i++) {
        const job = await this.queueBackend.getNextPendingJob();
        if (!job) {
          break;
        }

        // Call lifecycle hook for worker selection
        const selectedWorker = await this.selectWorker({
          job,
          availableWorkers: Array.from(this.workers.values()),
          orchestratorState: this.getOrchestratorState(),
        });

        if (selectedWorker?.workerId !== worker.workerId) {
          // Different worker selected, requeue
          await this.queueBackend.updateJobStatus(job.id, JobStatus.PENDING);
          continue;
        }

        // Update job status
        await this.queueBackend.updateJobStatus(
          job.id,
          JobStatus.PROCESSING,
          undefined,
          undefined,
          worker.workerId,
        );

        jobs.push({
          jobId: job.id,
          jobPayload: job.jobPayload,
          context: {
            jobId: job.id,
            startTime: Date.now(),
            queueTime: Date.now() - job.requestedAt.getTime(),
            timeout: job.jobPayload.jobTimeout || 30000,
          },
        });

        this.jobToWorkerMap.set(job.id, worker.workerId);
        worker.pendingAcks.add(job.id);
      }

      if (jobs.length > 0) {
        await this.sendJobsToWorker(worker, jobs);
      }
    }
  }

  /**
   * Send jobs to a worker
   */
  protected async sendJobsToWorker(
    worker: WorkerState,
    jobs: BatchJobContext[],
  ): Promise<void> {
    const message: WorkerMessage = {
      type: WorkerMessageType.FILL_QUEUE,
      payload: { jobs } as FillQueuePayload,
    };

    await this.wsServer.sendToWorker(worker.workerId, message);

    worker.status.pendingJobs += jobs.length;
    worker.status.needsMoreJobs = false;
    worker.lastFillTime = Date.now();

    this.emit("jobs-distributed", {
      workerId: worker.workerId,
      jobCount: jobs.length,
    });
  }

  /**
   * Get workers that need more jobs
   */
  protected getWorkersNeedingJobs(): WorkerState[] {
    return Array.from(this.workers.values()).filter(
      (worker) =>
        worker.status.needsMoreJobs &&
        worker.status.pendingJobs < this.config.queueThreshold!,
    );
  }

  /**
   * Get orchestrator state for custom logic
   */
  protected getOrchestratorState(): any {
    return {
      workers: this.workers.size,
      jobs: this.jobToWorkerMap.size,
      workflows: this.workflows.size,
      isRunning: this.isRunning,
    };
  }

  /**
   * Start distribution loop
   */
  private startDistributionLoop(): void {
    this.distributionInterval = setInterval(async () => {
      try {
        await this.distributeJobs();
      } catch (error) {
        this.emit("distribution-error", error);
      }
    }, 100); // Check every 100ms
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupEventHandlers(): void {
    // Worker connection events
    this.wsServer.on("worker-connected", ({ connectionId, workerId }) => {
      this.registerWorker(workerId, connectionId);
    });

    this.wsServer.on("worker-disconnected", ({ workerId }) => {
      this.unregisterWorker(workerId);
    });

    // Job request events
    this.wsServer.on("request-jobs", async (data) => {
      const worker = this.workers.get(data.workerId);
      if (worker) {
        worker.status.pendingJobs = data.currentQueueSize || 0;
        worker.status.needsMoreJobs = true;
      }
    });

    // Job result events
    this.wsServer.on("queue-result", async (data) => {
      await this.handleJobResult(data);
    });

    // Job error events
    this.wsServer.on("job-error", async (data) => {
      await this.handleJobError(data);
    });
  }

  /**
   * Handle job result
   */
  private async handleJobResult(data: any): Promise<void> {
    const { workerId, jobId, result, processingTime } = data;

    const worker = this.workers.get(workerId);
    if (worker) {
      worker.pendingAcks.delete(jobId);
      worker.status.processingJobs = Math.max(
        0,
        worker.status.processingJobs - 1,
      );
      worker.status.completedJobs++;
      worker.status.totalProcessed++;
    }

    this.jobToWorkerMap.delete(jobId);

    // Update job status in queue
    if (this.queueBackend) {
      await this.queueBackend.updateJobStatus(jobId, JobStatus.COMPLETED, {
        results: result,
        executionTime: processingTime,
        queueTime: 0,
      });
    }

    // Check for workflow
    if (result?.__workflow) {
      const { workflowId, stepId } = result.__workflow;
      delete result.__workflow;
      await this.handleWorkflowJobCompletion(jobId, result, workflowId, stepId);
    }

    // Send ACK to worker
    await this.wsServer.sendToWorker(workerId, {
      type: WorkerMessageType.JOB_ACK,
      payload: { jobId, workerId } as JobAckPayload,
    });

    // Call lifecycle hook
    await this.onJobCompleted(jobId, result, workerId);

    this.emit("job-completed", { jobId, result, workerId, processingTime });
  }

  /**
   * Handle job error
   */
  private async handleJobError(data: any): Promise<void> {
    const { workerId, jobId, error } = data;

    const worker = this.workers.get(workerId);
    if (worker) {
      worker.pendingAcks.delete(jobId);
      worker.status.processingJobs = Math.max(
        0,
        worker.status.processingJobs - 1,
      );
    }

    this.jobToWorkerMap.delete(jobId);

    // Update job status in queue
    if (this.queueBackend) {
      await this.queueBackend.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        undefined,
        new Error(error),
      );
    }

    // Send ACK to worker
    await this.wsServer.sendToWorker(workerId, {
      type: WorkerMessageType.JOB_ACK,
      payload: { jobId, workerId } as JobAckPayload,
    });

    // Call lifecycle hook
    await this.onJobFailed(jobId, new Error(error), workerId);

    this.emit("job-failed", { jobId, error, workerId });
  }

  /**
   * Register custom message routes
   */
  protected registerCustomRoutes(): void {
    // Override in subclass to add custom routes
  }

  // ============================================
  // Lifecycle hooks for subclasses to override
  // ============================================

  /**
   * Called when orchestrator starts
   */
  protected async onStart(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when orchestrator stops
   */
  protected async onStop(): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when a worker is registered
   */
  protected onWorkerRegistered(workerId: number, state: WorkerState): void {
    // Override in subclass
  }

  /**
   * Called when a worker is unregistered
   */
  protected onWorkerUnregistered(workerId: number, state: WorkerState): void {
    // Override in subclass
  }

  /**
   * Called before a job is scheduled
   * Can be used to validate or transform the job payload
   */
  protected async beforeJobSchedule(
    jobPayload: JobPayload,
  ): Promise<JobPayload> {
    // Override in subclass to validate/transform
    return jobPayload;
  }

  /**
   * Called after a job is scheduled
   */
  protected async onJobScheduled(
    jobId: string,
    jobPayload: JobPayload,
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when a job is completed
   */
  protected async onJobCompleted(
    jobId: string,
    result: JobResult,
    workerId: number,
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Called when a job fails
   */
  protected async onJobFailed(
    jobId: string,
    error: Error,
    workerId: number,
  ): Promise<void> {
    // Override in subclass
  }

  /**
   * Select a worker for a job
   * Override to implement custom worker selection logic
   */
  protected async selectWorker(
    context: JobDistributionContext,
  ): Promise<WorkerState | null> {
    const { availableWorkers } = context;

    if (availableWorkers.length === 0) {
      return null;
    }

    // Default implementation based on strategy
    switch (this.config.distributionStrategy) {
      case "round-robin":
        // Simple round-robin (would need state to track last selected)
        return availableWorkers[0];

      case "least-loaded":
        // Select worker with fewest pending jobs
        return availableWorkers.reduce((min, worker) =>
          worker.status.pendingJobs < min.status.pendingJobs ? worker : min,
        );

      case "random":
        return availableWorkers[
          Math.floor(Math.random() * availableWorkers.length)
        ];

      case "custom":
        // Must be overridden in subclass
        throw new Error(
          "Custom distribution strategy requires overriding selectWorker method",
        );

      default:
        return availableWorkers[0];
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    workers: number;
    activeWorkers: number;
    totalPendingJobs: number;
    totalProcessingJobs: number;
    totalCompletedJobs: number;
    workflows: number;
    isRunning: boolean;
  } {
    let totalPendingJobs = 0;
    let totalProcessingJobs = 0;
    let totalCompletedJobs = 0;
    let activeWorkers = 0;

    for (const worker of this.workers.values()) {
      totalPendingJobs += worker.status.pendingJobs;
      totalProcessingJobs += worker.status.processingJobs;
      totalCompletedJobs += worker.status.completedJobs;

      if (worker.status.pendingJobs > 0 || worker.status.processingJobs > 0) {
        activeWorkers++;
      }
    }

    return {
      workers: this.workers.size,
      activeWorkers,
      totalPendingJobs,
      totalProcessingJobs,
      totalCompletedJobs,
      workflows: this.workflows.size,
      isRunning: this.isRunning,
    };
  }

  /**
   * Add custom message route
   */
  addMessageRoute(
    pattern: string | RegExp,
    handler: (
      connection: WebSocketConnection,
      message: WorkerMessage,
    ) => Promise<void> | void,
    priority?: number,
  ): void {
    this.wsServer.registerRoute({
      pattern,
      handler,
      priority,
    });
  }
}
