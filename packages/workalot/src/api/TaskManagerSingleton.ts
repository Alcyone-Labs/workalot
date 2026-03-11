import { TaskManager } from "./TaskManager.js";
import { JobPayload, JobResult, QueueConfig, WhenFreeCallback } from "../types/index.js";

/**
 * Singleton wrapper for TaskManager providing a global interface
 */
class TaskManagerSingleton {
  private static instance: TaskManagerSingleton | null = null;
  private taskManager: TaskManager | null = null;
  private initializationPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): TaskManagerSingleton {
    if (!TaskManagerSingleton.instance) {
      TaskManagerSingleton.instance = new TaskManagerSingleton();
    }
    return TaskManagerSingleton.instance;
  }

  /**
   * Initialize the task manager with configuration
   */
  async initialize(config: QueueConfig = {}, projectRoot?: string): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInitialize(config, projectRoot);
    return this.initializationPromise;
  }

  /**
   * Internal initialization method
   */
  private async doInitialize(config: QueueConfig, projectRoot?: string): Promise<void> {
    if (this.taskManager) {
      console.warn("TaskManager already initialized");
      return;
    }

    this.taskManager = new TaskManager(config, projectRoot);
    await this.taskManager.initialize();
  }

  /**
   * Schedule a job and wait for it to complete
   */
  async scheduleAndWait(jobPayload: JobPayload): Promise<JobResult> {
    this.ensureInitialized();
    return await this.taskManager!.scheduleAndWait(jobPayload);
  }

  /**
   * Register a callback to be called when the queue becomes free
   */
  whenFree(callback: WhenFreeCallback): void {
    this.ensureInitialized();
    this.taskManager!.whenFree(callback);
  }

  /**
   * Remove a whenFree callback
   */
  removeWhenFreeCallback(callback: WhenFreeCallback): boolean {
    this.ensureInitialized();
    return this.taskManager!.removeWhenFreeCallback(callback);
  }

  /**
   * Schedule a job without waiting for completion
   */
  async schedule(jobPayload: JobPayload): Promise<string> {
    this.ensureInitialized();
    return await this.taskManager!.schedule(jobPayload);
  }

  /**
   * Get the current status
   */
  async getStatus(): Promise<any> {
    this.ensureInitialized();
    return await this.taskManager!.getStatus();
  }

  /**
   * Check if the task manager is idle
   */
  async isIdle(): Promise<boolean> {
    this.ensureInitialized();
    return await this.taskManager!.isIdle();
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<any> {
    this.ensureInitialized();
    return await this.taskManager!.getQueueStats();
  }

  /**
   * Wait for the task manager to become idle
   */
  async whenIdle(timeoutMs?: number): Promise<void> {
    this.ensureInitialized();
    return await this.taskManager!.whenIdle(timeoutMs);
  }

  /**
   * Get jobs by their status
   */
  async getJobsByStatus(status: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.taskManager!.getJobsByStatus(status);
  }

  /**
   * Get worker statistics
   */
  async getWorkerStats(): Promise<any> {
    this.ensureInitialized();
    return await this.taskManager!.getWorkerStats();
  }

  /**
   * Shutdown the task manager
   */
  async shutdown(): Promise<void> {
    if (this.taskManager) {
      await this.taskManager.shutdown();
      this.taskManager = null;
      this.initializationPromise = null;
    }
  }

  /**
   * Get the underlying TaskManager instance (for advanced usage)
   */
  getTaskManager(): TaskManager | null {
    return this.taskManager;
  }

  /**
   * Check if the task manager is initialized
   */
  isInitialized(): boolean {
    return this.taskManager !== null;
  }

  /**
   * Reset the singleton (mainly for testing)
   */
  static reset(): void {
    if (TaskManagerSingleton.instance?.taskManager) {
      TaskManagerSingleton.instance.taskManager.shutdown().catch(console.error);
    }
    TaskManagerSingleton.instance = null;
  }

  /**
   * Ensure the task manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.taskManager) {
      throw new Error("TaskManager must be initialized before use. Call initialize() first.");
    }
  }
}

// Export the singleton instance
export const taskManager = TaskManagerSingleton.getInstance();

// Also export the class for advanced usage
export { TaskManagerSingleton };
