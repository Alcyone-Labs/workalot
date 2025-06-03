import { taskManager } from './TaskManagerSingleton.js';
import { JobPayload, JobResult, QueueConfig, WhenFreeCallback } from '../types/index.js';

/**
 * Initialize the task management system
 * @param config - Configuration options for the task manager
 * @param projectRoot - Root directory of the project (defaults to process.cwd())
 */
export async function initializeTaskManager(config: QueueConfig = {}, projectRoot?: string): Promise<void> {
  return await taskManager.initialize(config, projectRoot);
}

/**
 * Schedule a job and return a promise that resolves when the job completes
 * This is the main API function as described in the documentation
 * 
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job result
 * 
 * @example
 * ```typescript
 * const result = await scheduleNow({
 *   jobFile: 'jobs/ProcessDataJob.ts',
 *   jobPayload: { data: [1, 2, 3, 4, 5] },
 *   jobTimeout: 10000
 * });
 * console.log('Job completed:', result);
 * ```
 */
export async function scheduleNow(jobPayload: JobPayload): Promise<JobResult> {
  return await taskManager.scheduleNow(jobPayload);
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
export async function scheduleJob(jobPayload: JobPayload): Promise<string> {
  return await taskManager.scheduleJob(jobPayload);
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
