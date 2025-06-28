import { taskManager } from './TaskManagerSingleton.js';
import { JobPayload, JobResult, QueueConfig, WhenFreeCallback, WorkerQueueConfig } from '../types/index.js';

/**
 * Initialize the task management system
 * @param config - Configuration options for the task manager
 * @param projectRoot - Root directory of the project (defaults to process.cwd())
 */
export async function initializeTaskManager(config: QueueConfig = {}, projectRoot?: string): Promise<void> {
  return await taskManager.initialize(config, projectRoot);
}

/**
 * Schedule a job and wait for it to complete
 * This is the main API function as described in the documentation
 *
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job result
 *
 * @example
 * ```typescript
 * const result = await scheduleAndWait({
 *   jobFile: 'jobs/ProcessDataJob.ts',
 *   jobPayload: { data: [1, 2, 3, 4, 5] },
 *   jobTimeout: 10000
 * });
 * console.log('Job completed:', result);
 * ```
 */
export async function scheduleAndWait(jobPayload: JobPayload): Promise<JobResult> {
  return await taskManager.scheduleAndWait(jobPayload);
}



/**
 * Register a callback to be called when the queue becomes free (no pending jobs)
 * This is the second main API function as described in the documentation
 * 
 * @param callback - Function to call when queue is free
 * 
 * @example
 * ```typescript
 * whenFree(() => {
 *   console.log('All jobs completed, queue is now free!');
 * });
 * ```
 */
export function whenFree(callback: WhenFreeCallback): void {
  taskManager.whenFree(callback);
}

/**
 * Remove a previously registered whenFree callback
 * @param callback - The callback function to remove
 * @returns true if the callback was found and removed, false otherwise
 */
export function removeWhenFreeCallback(callback: WhenFreeCallback): boolean {
  return taskManager.removeWhenFreeCallback(callback);
}

/**
 * Schedule a job without waiting for completion (fire and forget)
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job ID
 */
export async function schedule(jobPayload: JobPayload): Promise<string> {
  return await taskManager.schedule(jobPayload);
}



/**
 * Get the current status of the task management system
 * @returns Object containing status information
 */
export async function getStatus(): Promise<{
  isInitialized: boolean;
  isShuttingDown: boolean;
  queue: any;
  workers: any;
  scheduler: any;
}> {
  return await taskManager.getStatus();
}

/**
 * Check if the task manager is currently idle (no pending jobs and workers available)
 * @returns true if idle, false otherwise
 */
export async function isIdle(): Promise<boolean> {
  return await taskManager.isIdle();
}

/**
 * Get detailed queue statistics
 * @returns Queue statistics object
 */
export async function getQueueStats(): Promise<any> {
  return await taskManager.getQueueStats();
}

/**
 * Get detailed worker statistics
 * @returns Worker statistics object
 */
export async function getWorkerStats(): Promise<any> {
  return await taskManager.getWorkerStats();
}

/**
 * Wait for the task manager to become idle (no pending jobs and workers available)
 * @param timeoutMs - Optional timeout in milliseconds
 * @returns Promise that resolves when idle or rejects on timeout
 */
export async function whenIdle(timeoutMs?: number): Promise<void> {
  return await taskManager.whenIdle(timeoutMs);
}

/**
 * Get jobs by their status
 * @param status - The job status to filter by
 * @returns Promise that resolves to an array of jobs with the specified status
 */
export async function getJobsByStatus(status: string): Promise<any[]> {
  return await taskManager.getJobsByStatus(status);
}

/**
 * Gracefully shutdown the task management system
 * This will complete any running jobs and clean up resources
 */
export async function shutdown(): Promise<void> {
  return await taskManager.shutdown();
}

/**
 * Get the underlying TaskManager instance for advanced usage
 * @returns TaskManager instance or null if not initialized
 */
export function getTaskManager() {
  return taskManager.getTaskManager();
}

/**
 * Check if the task manager is initialized
 * @returns true if initialized, false otherwise
 */
export function isInitialized(): boolean {
  return taskManager.isInitialized();
}

/**
 * Configure batch processing settings
 * @param batchSize Number of jobs to process in each batch (1-100)
 * @param enabled Whether to enable batch processing
 */
export function setBatchConfig(batchSize: number, enabled: boolean = true): void {
  if (!taskManager.isInitialized()) {
    throw new Error("Task manager not initialized. Call initializeTaskManager first.");
  }

  const tm = taskManager.getTaskManager();
  const scheduler = (tm as any).jobScheduler;
  if (scheduler && typeof scheduler.setBatchConfig === 'function') {
    scheduler.setBatchConfig(batchSize, enabled);
  } else {
    throw new Error("Batch configuration not supported by current scheduler");
  }
}

/**
 * Get current batch processing configuration
 * @returns Current batch configuration
 */
export function getBatchConfig(): { batchSize: number; enabled: boolean } {
  if (!taskManager.isInitialized()) {
    throw new Error("Task manager not initialized. Call initializeTaskManager first.");
  }

  const tm = taskManager.getTaskManager();
  const scheduler = (tm as any).jobScheduler;
  if (scheduler && typeof scheduler.getBatchConfig === 'function') {
    return scheduler.getBatchConfig();
  } else {
    throw new Error("Batch configuration not supported by current scheduler");
  }
}

/**
 * Configure worker-local queue settings for ultra-high throughput processing
 * @param config Worker queue configuration options
 */
export function setWorkerQueueConfig(config: Partial<WorkerQueueConfig>): void {
  if (!taskManager.isInitialized()) {
    throw new Error("Task manager not initialized. Call initializeTaskManager first.");
  }

  const tm = taskManager.getTaskManager();
  const workerManager = (tm as any).workerManager;
  if (workerManager && workerManager.queueOrchestrator && typeof workerManager.queueOrchestrator.updateConfig === 'function') {
    workerManager.queueOrchestrator.updateConfig(config);
  } else {
    throw new Error("Worker queue configuration not supported by current worker manager");
  }
}

/**
 * Get current worker queue configuration
 * @returns Current worker queue configuration
 */
export function getWorkerQueueConfig(): WorkerQueueConfig {
  if (!taskManager.isInitialized()) {
    throw new Error("Task manager not initialized. Call initializeTaskManager first.");
  }

  const tm = taskManager.getTaskManager();
  const workerManager = (tm as any).workerManager;
  if (workerManager && workerManager.queueOrchestrator && typeof workerManager.queueOrchestrator.getConfig === 'function') {
    return workerManager.queueOrchestrator.getConfig();
  } else {
    throw new Error("Worker queue configuration not supported by current worker manager");
  }
}

/**
 * Get worker queue orchestrator statistics
 * @returns Queue orchestrator statistics
 */
export function getWorkerQueueStats(): any {
  if (!taskManager.isInitialized()) {
    throw new Error("Task manager not initialized. Call initializeTaskManager first.");
  }

  const tm = taskManager.getTaskManager();
  const workerManager = (tm as any).workerManager;
  if (workerManager && typeof workerManager.getQueueStats === 'function') {
    return workerManager.getQueueStats();
  } else {
    throw new Error("Worker queue statistics not supported by current worker manager");
  }
}
