import { IQueueBackend } from "../queue/IQueueBackend.js";
import { JobPayload } from "../types/index.js";

export class Simulator {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private queueManager: IQueueBackend;
  private minInterval = 500;
  private maxInterval = 2000;

  constructor(queueManager: IQueueBackend) {
    this.queueManager = queueManager;
  }

  public start(options: { minInterval?: number; maxInterval?: number } = {}) {
    if (this.isRunning) return;

    this.minInterval = options.minInterval || 500;
    this.maxInterval = options.maxInterval || 2000;
    this.isRunning = true;

    this.scheduleNextJob();
  }

  public stop() {
    this.isRunning = false;
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = null;
    }
  }

  public getStatus() {
    return {
      running: this.isRunning,
      config: {
        minInterval: this.minInterval,
        maxInterval: this.maxInterval
      }
    };
  }

  private scheduleNextJob() {
    if (!this.isRunning) return;

    const delay = Math.floor(Math.random() * (this.maxInterval - this.minInterval + 1)) + this.minInterval;

    this.interval = setTimeout(async () => {
      await this.createRandomJob();
      this.scheduleNextJob();
    }, delay);
  }

  private async createRandomJob() {
    if (!this.isRunning) return;

    const jobTypes = ["ImageProcessing", "DataAnalysis", "ReportGeneration", "EmailNotification"];
    const type = jobTypes[Math.floor(Math.random() * jobTypes.length)];

    // Simulate varying execution times via payload for the worker (if we had workers running)
    // Since we are in simulation mode on the dashboard, these jobs might just sit in PENDING
    // unless there are workers connected.
    // Or, we can "simulate" processing too?
    // The prompt says "see dynamic jobs being created without actually running a server".
    // This implies we just create them. If no workers are connected, they stay pending.
    // If the user wants to see them moving, they might need a worker connected.
    // But "without actually running a server" might mean without running a separate backend server.
    // The dashboard IS the server.
    // If we want to see them complete, we need a worker.
    // I can assume the user will connect a worker, OR I can add a "fake worker" in the simulator
    // that picks up jobs and completes them?
    // "Local job creator so we can see dynamic jobs being created".
    // I will just create them. If they pile up, so be it.
    // Wait, the user might want to see the FULL lifecycle.
    // If I just pile up PENDING jobs, it's boring.
    // I'll add a simple "auto-process" option to the simulator?
    // Let's stick to creating for now, as that's what was asked.

    const payload: JobPayload = {
      jobFile: `jobs/${type}Job.ts`,
      jobPayload: {
        type,
        createdAt: new Date().toISOString(),
        data: Math.random().toString(36).substring(7),
        complexity: Math.floor(Math.random() * 10)
      }
    };

    try {
      await this.queueManager.addJob(payload);
    } catch (error) {
      console.error("Simulator failed to add job:", error);
    }
  }
}
