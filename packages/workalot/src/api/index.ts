// Main TaskManager class
export { TaskManager, type TaskManagerEvents, type TelemetryHooks } from './TaskManager.js';

// Singleton wrapper
export { TaskManagerSingleton, taskManager } from './TaskManagerSingleton.js';

// Convenience functions (main API)
export {
  initializeTaskManager,
  scheduleAndWait,
  schedule,
  whenFree,
  removeWhenFreeCallback,
  getStatus,
  isIdle,
  whenIdle,
  getQueueStats,
  getWorkerStats,
  getJobsByStatus,
  shutdown,
  getTaskManager,
  isInitialized
} from './functions.js';
