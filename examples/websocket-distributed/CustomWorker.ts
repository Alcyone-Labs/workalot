import { SimpleWorker, SimpleWorkerConfig, BaseJob, IJob, WorkerMessage, WorkerMessageType, JobPayload, JobResult } from "../../src/index.js";

// Define example job implementations that the worker can execute

class MathJob extends BaseJob implements IJob {
  async run(payload: { data: number[]; operation: string }, context: any): Promise<any> {
    console.log(`[MathJob] Processing ${payload.data.length} numbers with ${payload.operation}`);

    let result: number;
    switch (payload.operation) {
      case "sum":
        result = payload.data.reduce((a, b) => a + b, 0);
        break;
      case "average":
        result = payload.data.reduce((a, b) => a + b, 0) / payload.data.length;
        break;
      case "max":
        result = Math.max(...payload.data);
        break;
      case "min":
        result = Math.min(...payload.data);
        break;
      default:
        throw new Error(`Unknown operation: ${payload.operation}`);
    }

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    return this.createSuccessResult({
      operation: payload.operation,
      result,
      itemsProcessed: payload.data.length,
      processedAt: new Date().toISOString(),
    });
  }
}

class DataProcessor extends BaseJob implements IJob {
  async run(payload: { dataset: string; transform: string }, context: any): Promise<any> {
    console.log(`[DataProcessor] Processing dataset ${payload.dataset} with transform ${payload.transform}`);

    // Simulate data processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    const results = {
      dataset: payload.dataset,
      transform: payload.transform,
      recordsProcessed: Math.floor(Math.random() * 1000) + 100,
      processingTime: Math.floor(Math.random() * 500) + 500,
      status: "completed",
    };

    return this.createSuccessResult(results);
  }
}

class NotificationJob extends BaseJob implements IJob {
  async run(payload: { message: string; channel: string }, context: any): Promise<any> {
    console.log(`[NotificationJob] Sending notification via ${payload.channel}: "${payload.message}"`);

    // Simulate sending notification
    await new Promise(resolve => setTimeout(resolve, 300));

    return this.createSuccessResult({
      message: payload.message,
      channel: payload.channel,
      sent: true,
      sentAt: new Date().toISOString(),
    });
  }
}

export class CustomWorker extends SimpleWorker {
  constructor(config: SimpleWorkerConfig) {
    super(config);
  }

  protected async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case WorkerMessageType.EXECUTE_JOB:
        await this.executeCustomJob(message.payload as JobPayload);
        break;
      
      default:
        // Handle other message types with the parent method
        await super.handleMessage(message);
        break;
    }
  }

  private async executeCustomJob(jobPayload: JobPayload): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Route to appropriate job handler based on type
      let job: BaseJob;
      const jobType = jobPayload.jobPayload.type;
      
      switch (jobType) {
        case "MathJob":
          job = new MathJob();
          break;
        case "DataProcessor":
          job = new DataProcessor();
          break;
        case "Notification":
          job = new NotificationJob();
          break;
        default:
          console.error(`Unknown job type: ${jobType}`);
          throw new Error(`Unknown job type: ${jobType}`);
      }

      // Execute the job
      const result = await job.run(jobPayload.jobPayload.payload, {
        jobId: this["generateId"](),
        startTime: Date.now(),
        queueTime: 0,
        timeout: jobPayload.jobTimeout || 30000,
        scheduleAndWait: async () => Promise.resolve(""),
        schedule: () => "",
        _schedulingRequests: []
      });

      // Send success result
      const jobResult: JobResult = {
        results: result,
        executionTime: Date.now() - startTime,
        queueTime: 0,
      };

      this.wsClient.send({
        type: WorkerMessageType.JOB_RESULT,
        id: this["generateId"](),
        payload: jobResult,
      });

      this.emit("job-completed", jobResult);
    } catch (error) {
      // Send error result
      const jobResult: JobResult = {
        results: { error: error instanceof Error ? error.message : String(error) },
        executionTime: Date.now() - startTime,
        queueTime: 0,
      };

      this.wsClient.send({
        type: WorkerMessageType.JOB_ERROR,
        id: this["generateId"](),
        payload: jobResult,
      });

      this.emit("job-failed", jobResult);
    }
  }
}