import { EventEmitter } from "node:events";
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
  QueueResultPayload
} from "../types/index.js";

export interface WorkerQueueState {
  workerId: number;
  status: WorkerQueueStatus;
  lastFillTime: number;
  pendingAcks: Set<string>;
}

/**
 * Centralized orchestrator for worker-local job queues
 * Manages asynchronous job distribution and ACK-based completion tracking
 */
export class QueueOrchestrator extends EventEmitter {
  private workerQueues = new Map<number, WorkerQueueState>();
  private jobToWorkerMap = new Map<string, number>();
  private config: WorkerQueueConfig;
  private isRunning = false;
  private distributionInterval?: NodeJS.Timeout;

  constructor(config: Partial<WorkerQueueConfig> = {}) {
    super();
    this.config = {
      workerQueueSize: config.workerQueueSize || 50,
      queueThreshold: config.queueThreshold || 10,
      ackTimeout: config.ackTimeout || 5000,
      enableWorkerQueues: config.enableWorkerQueues !== false,
    };
  }

  /**
   * Register a worker with the orchestrator
   */
  registerWorker(workerId: number): void {
    this.workerQueues.set(workerId, {
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
    });

    this.emit("worker-registered", workerId);
  }

  /**
   * Unregister a worker from the orchestrator
   */
  unregisterWorker(workerId: number): void {
    const workerState = this.workerQueues.get(workerId);
    if (workerState) {
      // Clean up pending ACKs
      for (const jobId of workerState.pendingAcks) {
        this.jobToWorkerMap.delete(jobId);
      }
      this.workerQueues.delete(workerId);
      this.emit("worker-unregistered", workerId);
    }
  }

  /**
   * Start the orchestrator
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    
    // Start periodic distribution check (every 1ms for maximum responsiveness)
    this.distributionInterval = setInterval(() => {
      this.checkAndDistributeJobs();
    }, 1);

    this.emit("orchestrator-started");
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.distributionInterval) {
      clearInterval(this.distributionInterval);
      this.distributionInterval = undefined;
    }

    this.emit("orchestrator-stopped");
  }

  /**
   * Distribute jobs to workers that need them
   */
  async distributeJobsToWorker(
    workerId: number, 
    jobs: BatchJobContext[], 
    sendMessage: (workerId: number, message: WorkerMessage) => void
  ): Promise<void> {
    const workerState = this.workerQueues.get(workerId);
    if (!workerState) {
      throw new Error(`Worker ${workerId} not registered`);
    }

    // Track job assignments
    for (const job of jobs) {
      this.jobToWorkerMap.set(job.jobId, workerId);
      workerState.pendingAcks.add(job.jobId);
    }

    // Update worker state
    workerState.status.pendingJobs += jobs.length;
    workerState.status.needsMoreJobs = false;
    workerState.lastFillTime = Date.now();

    // Send jobs to worker
    const message: WorkerMessage = {
      type: WorkerMessageType.FILL_QUEUE,
      payload: { jobs } as FillQueuePayload,
    };

    sendMessage(workerId, message);

    this.emit("jobs-distributed", {
      workerId,
      jobCount: jobs.length,
      workerQueueSize: workerState.status.pendingJobs,
    });
  }

  /**
   * Handle job request from worker
   */
  handleJobRequest(
    workerId: number,
    requestPayload: RequestJobsPayload
  ): void {
    const workerState = this.workerQueues.get(workerId);
    if (!workerState) {
      console.warn(`Job request from unregistered worker ${workerId}`);
      return;
    }

    // Update worker status
    workerState.status.pendingJobs = requestPayload.currentQueueSize;
    workerState.status.needsMoreJobs = true;

    this.emit("job-request", {
      workerId,
      requestedCount: requestPayload.requestedCount,
      currentQueueSize: requestPayload.currentQueueSize,
    });
  }

  /**
   * Handle job result from worker
   */
  handleJobResult(
    workerId: number,
    resultPayload: QueueResultPayload
  ): void {
    const workerState = this.workerQueues.get(workerId);
    if (!workerState) {
      console.warn(`Job result from unregistered worker ${workerId}`);
      return;
    }

    const { jobId, result, error, processingTime } = resultPayload;

    // Update worker statistics
    workerState.status.processingJobs = Math.max(0, workerState.status.processingJobs - 1);
    workerState.status.completedJobs++;

    this.emit("job-result", {
      workerId,
      jobId,
      result,
      error,
      processingTime,
      success: !error,
    });
  }

  /**
   * Send ACK to worker for job completion
   */
  acknowledgeJob(
    workerId: number,
    jobId: string,
    sendMessage: (workerId: number, message: WorkerMessage) => void
  ): void {
    const workerState = this.workerQueues.get(workerId);
    if (!workerState) {
      console.warn(`ACK for job ${jobId} from unregistered worker ${workerId}`);
      return;
    }

    // Remove from pending ACKs
    workerState.pendingAcks.delete(jobId);
    workerState.status.totalProcessed++;
    this.jobToWorkerMap.delete(jobId);

    // Send ACK message
    const message: WorkerMessage = {
      type: WorkerMessageType.JOB_ACK,
      payload: { jobId, workerId } as JobAckPayload,
    };

    sendMessage(workerId, message);

    this.emit("job-acknowledged", {
      workerId,
      jobId,
      totalProcessed: workerState.status.totalProcessed,
    });
  }

  /**
   * Update worker queue status
   */
  updateWorkerStatus(workerId: number, status: Partial<WorkerQueueStatus>): void {
    const workerState = this.workerQueues.get(workerId);
    if (!workerState) {
      return;
    }

    workerState.status = { ...workerState.status, ...status };
    
    // Calculate queue utilization
    const totalCapacity = this.config.workerQueueSize;
    const currentUsage = workerState.status.pendingJobs + workerState.status.processingJobs;
    workerState.status.queueUtilization = totalCapacity > 0 ? (currentUsage / totalCapacity) * 100 : 0;
  }

  /**
   * Get workers that need more jobs
   */
  getWorkersNeedingJobs(): number[] {
    const needyWorkers: number[] = [];
    
    for (const [workerId, workerState] of this.workerQueues) {
      if (workerState.status.needsMoreJobs && 
          workerState.status.pendingJobs < this.config.queueThreshold) {
        needyWorkers.push(workerId);
      }
    }

    return needyWorkers;
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    totalWorkers: number;
    activeWorkers: number;
    totalPendingJobs: number;
    totalProcessingJobs: number;
    totalCompletedJobs: number;
    totalProcessed: number;
    averageQueueUtilization: number;
    workersNeedingJobs: number;
  } {
    let totalPendingJobs = 0;
    let totalProcessingJobs = 0;
    let totalCompletedJobs = 0;
    let totalProcessed = 0;
    let totalUtilization = 0;
    let activeWorkers = 0;
    let workersNeedingJobs = 0;

    for (const workerState of this.workerQueues.values()) {
      totalPendingJobs += workerState.status.pendingJobs;
      totalProcessingJobs += workerState.status.processingJobs;
      totalCompletedJobs += workerState.status.completedJobs;
      totalProcessed += workerState.status.totalProcessed;
      totalUtilization += workerState.status.queueUtilization;
      
      if (workerState.status.pendingJobs > 0 || workerState.status.processingJobs > 0) {
        activeWorkers++;
      }
      
      if (workerState.status.needsMoreJobs) {
        workersNeedingJobs++;
      }
    }

    const totalWorkers = this.workerQueues.size;
    const averageQueueUtilization = totalWorkers > 0 ? totalUtilization / totalWorkers : 0;

    return {
      totalWorkers,
      activeWorkers,
      totalPendingJobs,
      totalProcessingJobs,
      totalCompletedJobs,
      totalProcessed,
      averageQueueUtilization,
      workersNeedingJobs,
    };
  }

  /**
   * Check and trigger job distribution (called periodically)
   */
  private checkAndDistributeJobs(): void {
    const workersNeedingJobs = this.getWorkersNeedingJobs();
    
    if (workersNeedingJobs.length > 0) {
      this.emit("distribution-needed", {
        workerIds: workersNeedingJobs,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get configuration
   */
  getConfig(): WorkerQueueConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<WorkerQueueConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit("config-updated", this.config);
  }
}
