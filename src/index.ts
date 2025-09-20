// Main API exports (primary interface)
export {
  // Main functions as described in documentation
  initializeTaskManager,
  scheduleAndWait,
  schedule,
  whenFree,
  removeWhenFreeCallback,

  // Additional utility functions
  getStatus,
  isIdle,
  whenIdle,
  getQueueStats,
  getWorkerStats,
  getJobsByStatus,
  shutdown,
  getTaskManager,
  isInitialized,

  // Classes for advanced usage
  TaskManager,

  // Singleton pattern (consider using TaskManagerFactory instead)
  TaskManagerSingleton,
  taskManager,
} from "./api/index.js";

// Factory pattern (recommended over singleton)
export {
  TaskManagerFactory,
  TaskManagerFactoryPresets,
  defaultFactory,
  type TaskManagerInstance,
} from "./api/TaskManagerFactory.js";

// Simplified components for basic use cases
export {
  SimpleWorker,
  type SimpleWorkerConfig,
} from "./workers/base/SimpleWorker.js";

export {
  SimpleOrchestrator,
  type SimpleOrchestratorConfig,
} from "./orchestration/SimpleOrchestrator.js";

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
  WorkerState,

  // Queue types
  QueueStats,

  // Batch types
  BatchJobContext,
  BatchExecutionResult,
  BatchJobResult,

  // Additional types
  JobExecutionContext,
  WorkerQueueStatus,
  WorkerQueueConfig,
} from "./types/index.js";

// Value exports
export {
  WorkerMessageType,
} from "./types/index.js";

// Job system exports (for creating custom jobs)
export {
  BaseJob,
  JobLoader,
  JobExecutor,
  JobRegistry,
  JobLoadError,
  JobValidationError,
  JobTimeoutError,
  JobExecutionError,
} from "./jobs/index.js";

// Queue system exports (for advanced usage)
export {
  QueueManager,
  IQueueBackend,
  QueueFactory,
  type QueueStats as QueueBackendStats,
} from "./queue/index.js";

// Queue backend implementations
export { PostgreSQLQueue } from "./queue/PostgreSQLQueue.js";
export { SQLiteQueue, type SQLiteQueueConfig } from "./queue/SQLiteQueue.js";
export { PGLiteQueue, type PGLiteQueueConfig } from "./queue/PGLiteQueue.js";

// Worker system exports
export { WorkerManager, JobScheduler } from "./workers/index.js";

// Export additional worker components directly from their source files
export { JobRecoveryService } from "./workers/JobRecoveryService.js";
export { QueueOrchestrator } from "./workers/QueueOrchestrator.js";
export { WorkerLocalQueue } from "./workers/WorkerLocalQueue.js";

// Export WorkerManager configuration type
export type { WorkerManagerConfig } from "./workers/WorkerManager.js";

// Extensible Architecture Components (for building custom orchestrators and workers)
export {
  // Base Orchestrator for custom orchestration
  BaseOrchestrator,
  type OrchestratorConfig,
  type WorkerState as OrchestratorWorkerState,
  type JobDistributionContext,
  type WorkflowStep,
  type WorkflowDefinition,
} from "./orchestration/BaseOrchestrator.js";

export {
  // Base Worker for custom worker behavior
  BaseWorker,
  type BaseWorkerConfig,
} from "./workers/base/BaseWorker.js";

// WebSocket Communication Layer
export {
  WebSocketServer,
  type WebSocketConnection,
  type WebSocketServerConfig,
  type MessageRoute,
  type PendingMessage,
} from "./communication/WebSocketServer.js";

export {
  WebSocketClient,
  type WebSocketClientConfig,
} from "./communication/WebSocketClient.js";

// Re-export common utilities
export { ulid } from "ulidx";
