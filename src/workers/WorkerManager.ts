import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cpus } from 'os';
import { ulid } from 'ulidx';
import { 
  WorkerMessage, 
  WorkerMessageType, 
  WorkerState, 
  JobPayload,
  JobResult,
  QueueConfig
} from '../types/index.js';
import { JobExecutionContext } from '../jobs/index.js';

/**
 * Events emitted by the WorkerManager
 */
export interface WorkerManagerEvents {
  'worker-ready': (workerId: number) => void;
  'worker-error': (workerId: number, error: string) => void;
  'job-completed': (workerId: number, jobId: string, result: JobResult) => void;
  'job-failed': (workerId: number, jobId: string, error: string) => void;
  'all-workers-ready': () => void;
}

/**
 * Manages a pool of worker threads for job execution
 */
export class WorkerManager extends EventEmitter {
  private workers = new Map<number, Worker>();
  private workerStates = new Map<number, WorkerState>();
  private pendingJobs = new Map<string, {
    resolve: (result: JobResult) => void;
    reject: (error: Error) => void;
    timeout?: NodeJS.Timeout;
  }>();
  
  private config: Required<QueueConfig>;
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private allWorkersReady = false;

  constructor(config: QueueConfig, private projectRoot: string = process.cwd()) {
    super();
    
    this.config = {
      maxInMemoryAge: config.maxInMemoryAge || 24 * 60 * 60 * 1000,
      maxThreads: this.calculateMaxThreads(config.maxThreads),
      persistenceFile: config.persistenceFile || 'queue-state.json',
      healthCheckInterval: config.healthCheckInterval || 5000
    };
  }

  /**
   * Initialize all worker threads
   */
  async initialize(): Promise<void> {
    console.log(`Initializing ${this.config.maxThreads} worker threads...`);
    
    const workerPromises: Promise<void>[] = [];
    
    for (let i = 0; i < this.config.maxThreads; i++) {
      workerPromises.push(this.createWorker(i));
    }

    // Wait for all workers to be ready
    await Promise.all(workerPromises);
    
    this.allWorkersReady = true;
    this.emit('all-workers-ready');
    
    // Start health check
    this.startHealthCheck();
    
    console.log(`All ${this.config.maxThreads} workers are ready`);
  }

  /**
   * Execute a job on an available worker
   */
  async executeJob(jobPayload: JobPayload, context: JobExecutionContext): Promise<JobResult> {
    if (this.isShuttingDown) {
      throw new Error('WorkerManager is shutting down');
    }

    const availableWorker = this.getAvailableWorker();
    if (!availableWorker) {
      throw new Error('No available workers');
    }

    return new Promise((resolve, reject) => {
      const messageId = ulid();
      const timeout = jobPayload.jobTimeout || 5000;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingJobs.delete(messageId);
        reject(new Error(`Job execution timed out after ${timeout}ms`));
      }, timeout);

      // Store promise resolvers
      this.pendingJobs.set(messageId, {
        resolve,
        reject,
        timeout: timeoutHandle
      });

      // Mark worker as busy
      const workerState = this.workerStates.get(availableWorker.id)!;
      workerState.busy = true;
      workerState.currentJobId = context.jobId;

      // Send job to worker
      const message: WorkerMessage = {
        type: WorkerMessageType.EXECUTE_JOB,
        id: messageId,
        payload: {
          jobPayload,
          context
        }
      };

      availableWorker.worker.postMessage(message);
    });
  }

  /**
   * Get an available worker
   */
  private getAvailableWorker(): { id: number; worker: Worker } | null {
    for (const [id, state] of this.workerStates.entries()) {
      if (state.ready && !state.busy) {
        const worker = this.workers.get(id);
        if (worker) {
          return { id, worker };
        }
      }
    }
    return null;
  }

  /**
   * Check if any workers are available
   */
  hasAvailableWorkers(): boolean {
    return this.getAvailableWorker() !== null;
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): {
    total: number;
    ready: number;
    busy: number;
    available: number;
  } {
    let ready = 0;
    let busy = 0;

    for (const state of this.workerStates.values()) {
      if (state.ready) {
        ready++;
        if (state.busy) {
          busy++;
        }
      }
    }

    return {
      total: this.workers.size,
      ready,
      busy,
      available: ready - busy
    };
  }

  /**
   * Shutdown all workers
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Clear all pending job timeouts
    for (const pending of this.pendingJobs.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error('WorkerManager is shutting down'));
    }
    this.pendingJobs.clear();

    // Terminate all workers
    const terminationPromises: Promise<number>[] = [];
    for (const worker of this.workers.values()) {
      terminationPromises.push(worker.terminate());
    }

    await Promise.all(terminationPromises);
    this.workers.clear();
    this.workerStates.clear();

    console.log('All workers terminated');
  }

  /**
   * Create a single worker thread
   */
  private async createWorker(workerId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Determine the correct worker path based on whether we're running from src or dist
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);

      // Check if we're running from dist (compiled) or src (development)
      const isCompiledVersion = __dirname.includes('/dist/');
      const workerPath = isCompiledVersion
        ? join(__dirname, 'worker.js')  // Already in dist
        : join(__dirname, '../../dist/workers/worker.js');  // Running from src, point to dist
      
      const worker = new Worker(workerPath, {
        workerData: {
          workerId,
          projectRoot: this.projectRoot,
          defaultTimeout: 5000
        }
      });

      // Initialize worker state
      this.workerStates.set(workerId, {
        id: workerId,
        busy: false,
        ready: false
      });

      // Handle worker messages
      worker.on('message', (message: WorkerMessage) => {
        this.handleWorkerMessage(workerId, message);
      });

      // Handle worker errors
      worker.on('error', (error) => {
        console.error(`Worker ${workerId} error:`, error);
        this.emit('worker-error', workerId, error.message);
        reject(error);
      });

      // Handle worker exit
      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker ${workerId} exited with code ${code}`);
        }
        this.workerStates.delete(workerId);
        this.workers.delete(workerId);
      });

      // Wait for worker ready signal
      const readyTimeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} failed to initialize within timeout`));
      }, 10000);

      const onReady = () => {
        clearTimeout(readyTimeout);
        resolve();
      };

      // Listen for ready signal
      worker.once('message', (message: WorkerMessage) => {
        if (message.type === WorkerMessageType.WORKER_READY) {
          const state = this.workerStates.get(workerId)!;
          state.ready = true;
          this.workers.set(workerId, worker);
          this.emit('worker-ready', workerId);
          onReady();
        } else {
          reject(new Error(`Unexpected message from worker ${workerId}: ${message.type}`));
        }
      });
    });
  }

  /**
   * Handle messages from worker threads
   */
  private handleWorkerMessage(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId);
    if (!workerState) {
      console.error(`Received message from unknown worker ${workerId}`);
      return;
    }

    switch (message.type) {
      case WorkerMessageType.WORKER_READY:
        // This should only happen during initialization, but handle it gracefully
        if (!workerState.ready) {
          workerState.ready = true;
          this.emit('worker-ready', workerId);
        }
        break;

      case WorkerMessageType.PONG:
        workerState.lastPing = new Date();
        break;

      case WorkerMessageType.JOB_RESULT:
        this.handleJobResult(workerId, message);
        break;

      case WorkerMessageType.JOB_ERROR:
        this.handleJobError(workerId, message);
        break;

      case WorkerMessageType.WORKER_ERROR:
        console.error(`Worker ${workerId} error:`, message.error);
        this.emit('worker-error', workerId, message.error || 'Unknown error');
        break;

      default:
        console.warn(`Unknown message type from worker ${workerId}:`, message.type);
    }
  }

  /**
   * Handle successful job result from worker
   */
  private handleJobResult(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId)!;
    workerState.busy = false;
    workerState.currentJobId = undefined;

    if (message.id) {
      const pending = this.pendingJobs.get(message.id);
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.resolve(message.payload.result);
        this.pendingJobs.delete(message.id);
        
        this.emit('job-completed', workerId, workerState.currentJobId || 'unknown', message.payload.result);
      }
    }
  }

  /**
   * Handle job error from worker
   */
  private handleJobError(workerId: number, message: WorkerMessage): void {
    const workerState = this.workerStates.get(workerId)!;
    workerState.busy = false;
    const jobId = workerState.currentJobId || 'unknown';
    workerState.currentJobId = undefined;

    if (message.id) {
      const pending = this.pendingJobs.get(message.id);
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.reject(new Error(message.error || 'Job execution failed'));
        this.pendingJobs.delete(message.id);
        
        this.emit('job-failed', workerId, jobId, message.error || 'Unknown error');
      }
    }
  }

  /**
   * Start periodic health check of workers
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health check by pinging all workers
   */
  private performHealthCheck(): void {
    for (const [workerId, worker] of this.workers.entries()) {
      const message: WorkerMessage = {
        type: WorkerMessageType.PING,
        id: ulid()
      };
      worker.postMessage(message);
    }
  }

  /**
   * Calculate maximum number of threads based on configuration
   */
  private calculateMaxThreads(maxThreads?: number): number {
    const cpuCount = cpus().length;
    
    if (maxThreads === undefined) {
      return Math.max(1, cpuCount - 2);
    }
    
    if (maxThreads < 0) {
      return Math.max(1, cpuCount + maxThreads);
    }
    
    return Math.max(1, maxThreads);
  }
}
