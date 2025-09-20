import { taskManager } from "./TaskManagerSingleton.js";
import { TaskManagerFactory, defaultFactory } from "./TaskManagerFactory.js";
import { TaskManager } from "./TaskManager.js";
import {
  JobPayload,
  JobResult,
  QueueConfig,
  WhenFreeCallback,
  WorkerQueueConfig,
} from "../types/index.js";

/**
 * ============================================
 * Singleton-based API (Legacy - Still Supported)
 * ============================================
 *
 * These functions use the global singleton instance.
 * Simple to use but harder to test and manage multiple instances.
 *
 * @deprecated Consider using factory-based functions for better testability
 */

/**
 * Initialize the task management system (singleton)
 * @param config - Configuration options for the task manager
 * @param projectRoot - Root directory of the project (defaults to process.cwd())
 * @deprecated Use createTaskManager() or factory.create() for better instance management
 */
export async function initializeTaskManager(
  config: QueueConfig = {},
  projectRoot?: string,
): Promise<void> {
  return await taskManager.initialize(config, projectRoot);
}

/**
 * Schedule a job and wait for it to complete (singleton)
 * This is the main API function as described in the documentation
 *
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job result
 * @deprecated Use scheduleAndWaitWith() for better instance management
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
export async function scheduleAndWait(
  jobPayload: JobPayload,
): Promise<JobResult> {
  return await taskManager.scheduleAndWait(jobPayload);
}

/**
 * Register a callback to be called when the queue becomes free (singleton)
 * This is the second main API function as described in the documentation
 *
 * @param callback - Function to call when queue is free
 * @deprecated Use whenFreeWith() for better instance management
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
 * Remove a previously registered whenFree callback (singleton)
 * @param callback - The callback function to remove
 * @returns true if the callback was found and removed, false otherwise
 * @deprecated Use removeWhenFreeCallbackWith() for better instance management
 */
export function removeWhenFreeCallback(callback: WhenFreeCallback): boolean {
  return taskManager.removeWhenFreeCallback(callback);
}

/**
 * Schedule a job without waiting for completion (singleton)
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job ID
 * @deprecated Use scheduleWith() for better instance management
 */
export async function schedule(jobPayload: JobPayload): Promise<string> {
  return await taskManager.schedule(jobPayload);
}

/**
 * Get the current status of the task management system (singleton)
 * @returns Object containing status information
 * @deprecated Use getStatusWith() for better instance management
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
 * Check if the task manager is currently idle (singleton)
 * @returns true if idle, false otherwise
 * @deprecated Use isIdleWith() for better instance management
 */
export async function isIdle(): Promise<boolean> {
  return await taskManager.isIdle();
}

/**
 * Get detailed queue statistics (singleton)
 * @returns Queue statistics object
 * @deprecated Use getQueueStatsWith() for better instance management
 */
export async function getQueueStats(): Promise<any> {
  return await taskManager.getQueueStats();
}

/**
 * Wait for the task manager to become idle (singleton)
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise that resolves when idle or rejects on timeout
 * @deprecated Use whenIdleWith() for better instance management
 */
export async function whenIdle(timeoutMs?: number): Promise<void> {
  return await taskManager.whenIdle(timeoutMs);
}

/**
 * Get worker statistics (singleton)
 * @returns Worker statistics object
 * @deprecated Use getWorkerStatsWith() for better instance management
 */
export async function getWorkerStats(): Promise<any> {
  return await taskManager.getWorkerStats();
}

/**
 * Get jobs by their status (singleton)
 * @param status - Job status to filter by
 * @returns Array of jobs with the specified status
 * @deprecated Use getJobsByStatusWith() for better instance management
 */
export async function getJobsByStatus(status: string): Promise<any[]> {
  return await taskManager.getJobsByStatus(status);
}

/**
 * Shutdown the task manager (singleton)
 * @deprecated Use destroyTaskManager() for better instance management
 */
export async function shutdown(): Promise<void> {
  return await taskManager.shutdown();
}

/**
 * Get the underlying TaskManager instance (singleton)
 * @returns TaskManager instance or null if not initialized
 * @deprecated Use factory pattern for better instance management
 */
export function getTaskManager(): TaskManager | null {
  return taskManager.getTaskManager();
}

/**
 * Check if the task manager is initialized (singleton)
 * @returns true if initialized, false otherwise
 * @deprecated Use factory pattern for better instance management
 */
export function isInitialized(): boolean {
  return taskManager.isInitialized();
}

/**
 * ============================================
 * Factory-based API (Recommended)
 * ============================================
 *
 * These functions use the factory pattern for better testability
 * and support for multiple instances.
 */

/**
 * Create a new TaskManager instance using the factory pattern
 *
 * @param name - Unique name for this instance (defaults to 'default')
 * @param config - Configuration options for the task manager
 * @param projectRoot - Root directory of the project
 * @returns Promise that resolves with the TaskManager instance
 *
 * @example
 * ```typescript
 * const manager = await createTaskManager('main', {
 *   backend: 'sqlite',
 *   databaseUrl: './queue.db'
 * });
 *
 * // Use the manager
 * const result = await scheduleAndWaitWith(manager, {
 *   jobFile: 'jobs/ProcessDataJob.ts',
 *   jobPayload: { data: [1, 2, 3] }
 * });
 *
 * // Clean up when done
 * await destroyTaskManager('main');
 * ```
 */
export async function createTaskManager(
  name: string = "default",
  config: QueueConfig = {},
  projectRoot?: string,
): Promise<TaskManager> {
  return await defaultFactory.create(name, config, projectRoot);
}

/**
 * Get or create a TaskManager instance
 *
 * @param name - Unique name for this instance
 * @param config - Configuration options (used only if creating new instance)
 * @param projectRoot - Root directory (used only if creating new instance)
 * @returns Promise that resolves with the TaskManager instance
 */
export async function getOrCreateTaskManager(
  name: string = "default",
  config: QueueConfig = {},
  projectRoot?: string,
): Promise<TaskManager> {
  return await defaultFactory.getOrCreate(name, config, projectRoot);
}

/**
 * Get an existing TaskManager instance by name
 *
 * @param name - Name of the instance to retrieve
 * @returns TaskManager instance or undefined if not found
 */
export function getTaskManagerInstance(
  name: string = "default",
): TaskManager | undefined {
  return defaultFactory.get(name);
}

/**
 * Destroy a TaskManager instance
 *
 * @param name - Name of the instance to destroy
 * @returns Promise that resolves to true if destroyed, false if not found
 */
export async function destroyTaskManager(
  name: string = "default",
): Promise<boolean> {
  return await defaultFactory.destroy(name);
}

/**
 * Destroy all TaskManager instances
 */
export async function destroyAllTaskManagers(): Promise<void> {
  return await defaultFactory.destroyAll();
}

/**
 * Schedule a job and wait for it to complete using a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to use
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job result
 *
 * @example
 * ```typescript
 * const manager = await createTaskManager('main');
 * const result = await scheduleAndWaitWith(manager, {
 *   jobFile: 'jobs/ProcessDataJob.ts',
 *   jobPayload: { data: [1, 2, 3, 4, 5] },
 *   jobTimeout: 10000
 * });
 * ```
 */
export async function scheduleAndWaitWith(
  manager: TaskManager,
  jobPayload: JobPayload,
): Promise<JobResult> {
  return await manager.scheduleAndWait(jobPayload);
}

/**
 * Schedule a job without waiting using a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to use
 * @param jobPayload - The job configuration
 * @returns Promise that resolves with the job ID
 */
export async function scheduleWith(
  manager: TaskManager,
  jobPayload: JobPayload,
): Promise<string> {
  return await manager.schedule(jobPayload);
}

/**
 * Register a whenFree callback with a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to use
 * @param callback - Function to call when queue is free
 */
export function whenFreeWith(
  manager: TaskManager,
  callback: WhenFreeCallback,
): void {
  manager.whenFree(callback);
}

/**
 * Remove a whenFree callback from a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to use
 * @param callback - The callback to remove
 * @returns true if removed, false otherwise
 */
export function removeWhenFreeCallbackWith(
  manager: TaskManager,
  callback: WhenFreeCallback,
): boolean {
  return manager.removeWhenFreeCallback(callback);
}

/**
 * Check if a specific TaskManager instance is idle
 *
 * @param manager - The TaskManager instance to check
 * @returns Promise that resolves to true if idle
 */
export async function isIdleWith(manager: TaskManager): Promise<boolean> {
  return await manager.isIdle();
}

/**
 * Wait for a specific TaskManager instance to become idle
 *
 * @param manager - The TaskManager instance to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise that resolves when idle or rejects on timeout
 */
export async function whenIdleWith(
  manager: TaskManager,
  timeoutMs?: number,
): Promise<void> {
  return await manager.whenIdle(timeoutMs);
}

/**
 * Get status of a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to query
 * @returns Status object
 */
export async function getStatusWith(manager: TaskManager): Promise<any> {
  return await manager.getStatus();
}

/**
 * Get queue statistics from a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to query
 * @returns Queue statistics object
 */
export async function getQueueStatsWith(manager: TaskManager): Promise<any> {
  return await manager.getQueueStats();
}

/**
 * Get worker statistics from a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to query
 * @returns Worker statistics object
 */
export async function getWorkerStatsWith(manager: TaskManager): Promise<any> {
  return await manager.getWorkerStats();
}

/**
 * Get jobs by status from a specific TaskManager instance
 *
 * @param manager - The TaskManager instance to query
 * @param status - Job status to filter by
 * @returns Array of jobs with the specified status
 */
export async function getJobsByStatusWith(
  manager: TaskManager,
  status: string,
): Promise<any[]> {
  return await manager.getJobsByStatus(status);
}

/**
 * ============================================
 * Utility Functions
 * ============================================
 */

/**
 * Create a TaskManager factory with custom defaults
 *
 * @param defaultConfig - Default configuration for all instances
 * @param defaultProjectRoot - Default project root for all instances
 * @returns New TaskManagerFactory instance
 *
 * @example
 * ```typescript
 * const factory = createFactory({
 *   backend: 'postgresql',
 *   databaseUrl: 'postgres://localhost/myapp'
 * });
 *
 * // All managers created from this factory will use PostgreSQL by default
 * const manager1 = await factory.create('queue1');
 * const manager2 = await factory.create('queue2');
 * ```
 */
export function createFactory(
  defaultConfig: QueueConfig = {},
  defaultProjectRoot?: string,
): TaskManagerFactory {
  return new TaskManagerFactory(defaultConfig, defaultProjectRoot);
}

/**
 * Get statistics for all TaskManager instances
 *
 * @returns Statistics object for all instances
 */
export async function getAllTaskManagerStats(): Promise<Record<string, any>> {
  return await defaultFactory.getAllStats();
}

/**
 * List all TaskManager instance names
 *
 * @returns Array of instance names
 */
export function listTaskManagers(): string[] {
  return defaultFactory.list();
}

/**
 * Check if a TaskManager instance exists
 *
 * @param name - Name of the instance to check
 * @returns true if instance exists
 */
export function hasTaskManager(name: string): boolean {
  return defaultFactory.has(name);
}

/**
 * Wait for all TaskManager instances to become idle
 *
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise that resolves when all are idle or rejects on timeout
 */
export async function waitForAllTaskManagers(
  timeoutMs?: number,
): Promise<void> {
  return await defaultFactory.waitForAllIdle(timeoutMs);
}

/**
 * Check if all TaskManager instances are idle
 *
 * @returns Promise that resolves to true if all are idle
 */
export async function areAllTaskManagersIdle(): Promise<boolean> {
  return await defaultFactory.areAllIdle();
}
