import { parentPort, workerData } from 'worker_threads';
import { JobExecutor } from '../jobs/index.js';
import { WorkerMessage, WorkerMessageType, JobPayload } from '../types/index.js';

/**
 * Worker thread script that executes jobs
 */
class Worker {
  private jobExecutor: JobExecutor;
  private workerId: number;
  private isReady = false;

  constructor() {
    this.workerId = workerData.workerId;
    this.jobExecutor = new JobExecutor(workerData.projectRoot, workerData.defaultTimeout);
    
    this.setupMessageHandling();
    this.initialize();
  }

  /**
   * Initialize the worker and signal readiness
   */
  private async initialize(): Promise<void> {
    try {
      // Worker is ready to receive jobs
      this.isReady = true;
      this.sendMessage({
        type: WorkerMessageType.WORKER_READY,
        payload: { workerId: this.workerId }
      });
    } catch (error) {
      this.sendMessage({
        type: WorkerMessageType.WORKER_ERROR,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Set up message handling from main thread
   */
  private setupMessageHandling(): void {
    if (!parentPort) {
      throw new Error('Worker must be run in a worker thread');
    }

    parentPort.on('message', async (message: WorkerMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.sendMessage({
          type: WorkerMessageType.WORKER_ERROR,
          id: message.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Handle worker termination
    parentPort.on('close', () => {
      process.exit(0);
    });
  }

  /**
   * Handle incoming messages from main thread
   */
  private async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case WorkerMessageType.PING:
        this.handlePing(message);
        break;

      case WorkerMessageType.EXECUTE_JOB:
        await this.handleExecuteJob(message);
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle ping message for health check
   */
  private handlePing(message: WorkerMessage): void {
    this.sendMessage({
      type: WorkerMessageType.PONG,
      id: message.id,
      payload: { 
        workerId: this.workerId,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle job execution request
   */
  private async handleExecuteJob(message: WorkerMessage): Promise<void> {
    if (!this.isReady) {
      throw new Error('Worker is not ready to execute jobs');
    }

    const { jobPayload, context } = message.payload;
    
    try {
      const result = await this.jobExecutor.executeJob(jobPayload as JobPayload, context);
      
      this.sendMessage({
        type: WorkerMessageType.JOB_RESULT,
        id: message.id,
        payload: {
          workerId: this.workerId,
          result
        }
      });
    } catch (error) {
      this.sendMessage({
        type: WorkerMessageType.JOB_ERROR,
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
        payload: {
          workerId: this.workerId,
          errorDetails: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          } : { message: String(error) }
        }
      });
    }
  }

  /**
   * Send message to main thread
   */
  private sendMessage(message: WorkerMessage): void {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }
}

// Start the worker
new Worker();
