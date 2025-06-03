// Main TaskManager class
export { TaskManager, type TaskManagerEvents } from './TaskManager.js';

// Singleton wrapper
export { TaskManagerSingleton, taskManager } from './TaskManagerSingleton.js';

// Convenience functions (main API)
export {
  initializeTaskManager,
  scheduleNow,
  whenFree,
  removeWhenFreeCallback,
  scheduleJob,
  getStatus,
  isIdle,
  getQueueStats,
  getWorkerStats,
  shutdown,
  getTaskManager,
  isInitialized
} from './functions.js';
