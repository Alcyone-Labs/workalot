// Main API exports (primary interface)
export {
  // Main functions as described in documentation
  initializeTaskManager,
  scheduleNow,
  whenFree,
  removeWhenFreeCallback,
  
  // Additional utility functions
  scheduleJob,
  getStatus,
  isIdle,
  getQueueStats,
  getWorkerStats,
  shutdown,
  getTaskManager,
  isInitialized,
  
  // Classes for advanced usage
  TaskManager,
  TaskManagerSingleton,
  taskManager
} from './api/index.js';

// Type exports
export type {
  // Core types
  JobPayload,
  JobResult,
  QueueConfig,
  WhenFreeCallback,
  JobStatus,
  QueueItem,
  IJob,

  // Event types
  TaskManagerEvents,

  // Worker types
  WorkerMessage,
  WorkerMessageType,
  WorkerState,

  // Queue types
  QueueStats
} from './types/index.js';

// Job system exports (for creating custom jobs)
export {
  BaseJob,
  JobLoader,
  JobExecutor,
  JobRegistry,
  JobLoadError,
  JobValidationError,
  JobTimeoutError,
  JobExecutionError
} from './jobs/index.js';

// Queue system exports (for advanced usage)
export {
  QueueManager,
  IQueueBackend
} from './queue/index.js';

// Worker system exports (for advanced usage)
export {
  WorkerManager,
  JobScheduler
} from './workers/index.js';
