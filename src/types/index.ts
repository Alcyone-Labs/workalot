import { PathLike } from "node:fs";

/**
 * Job status enumeration
 */
export enum JobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * Job payload structure that gets passed to scheduleNow
 */
export interface JobPayload {
  jobFile: string | PathLike;
  jobPayload: Record<string, any>;
  jobTimeout?: number; // Default to 5000ms execution time
}

/**
 * Job scheduling request for jobs to schedule other jobs
 */
export interface JobSchedulingRequest {
  type: 'scheduleAndWait' | 'schedule';
  jobPayload: JobPayload;
  requestId: string;
}

/**
 * Base job execution context
 */
export interface BaseJobExecutionContext {
  jobId: string;
  startTime: number;
  queueTime: number;
  timeout: number;
}

/**
 * Enhanced job execution context with scheduling capabilities
 */
export interface JobExecutionContext extends BaseJobExecutionContext {
  // Scheduling API for jobs
  scheduleAndWait: (jobPayload: JobPayload) => Promise<string>; // Returns request ID
  schedule: (jobPayload: JobPayload) => string; // Returns request ID

  // Internal - accumulated scheduling requests
  _schedulingRequests: JobSchedulingRequest[];
}

/**
 * Job result structure returned from job execution
 */
export interface JobResult {
  results: Record<string, any>;
  executionTime: number; // Time taken to execute in milliseconds
  queueTime: number; // Time spent waiting in queue in milliseconds
  schedulingRequests?: JobSchedulingRequest[]; // Jobs scheduled by this job
}

/**
 * Queue item structure for internal queue management
 */
export interface QueueItem {
  id: string;
  jobPayload: JobPayload;
  status: JobStatus;
  lastUpdated: Date;
  requestedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: JobResult;
  error?: Error;
  workerId?: number;
}

/**
 * Configuration for the job queue system
 */
export interface QueueConfig {
  maxInMemoryAge?: number; // in milliseconds
  maxThreads?: number; // If undefined, set to os.cpus().length - 2
  persistenceFile?: string; // JSON file path for persistence
  healthCheckInterval?: number; // Default 5000ms
  jobRecoveryEnabled?: boolean; // Enable/disable job recovery service

  // Database backend configuration
  backend?: 'memory' | 'pglite' | 'postgresql' | 'sqlite';
  databaseUrl?: string; // For PGLite/PostgreSQL/SQLite backends

  // Worker configuration
  silent?: boolean; // Suppress worker console output for benchmarks
}

/**
 * Interface that all job classes must implement
 */
export interface IJob {
  /**
   * Returns the job's unique identifier
   * If undefined, the queue manager will generate a unique ID
   * @param payload - Optional payload to generate ID from
   */
  getJobId(payload?: Record<string, any>): string | undefined;

  /**
   * Executes the job with the provided payload
   * @param payload - The job payload
   * @param context - The execution context for the job
   * @returns The job result or throws an error
   */
  run(
    payload: Record<string, any>,
    context: JobExecutionContext,
  ): Promise<Record<string, any>> | Record<string, any>;
}

/**
 * Worker message types for communication between main thread and workers
 */
export enum WorkerMessageType {
  PING = "ping",
  PONG = "pong",
  EXECUTE_JOB = "execute_job",
  EXECUTE_BATCH_JOBS = "execute_batch_jobs",
  JOB_RESULT = "job_result",
  BATCH_RESULT = "batch_result",
  JOB_ERROR = "job_error",
  WORKER_READY = "worker_ready",
  WORKER_ERROR = "worker_error",
  // Worker-local queue messages
  FILL_QUEUE = "fill_queue",
  REQUEST_JOBS = "request_jobs",
  JOB_ACK = "job_ack",
  QUEUE_STATUS = "queue_status",
  QUEUE_RESULT = "queue_result",
}

/**
 * Message structure for worker communication
 */
export interface WorkerMessage {
  type: WorkerMessageType;
  id?: string;
  payload?: any;
  error?: string;
}

/**
 * Batch job execution context
 */
export interface BatchJobContext {
  jobId: string;
  jobPayload: JobPayload;
  context: BaseJobExecutionContext;
}

/**
 * Result of a single job in a batch
 */
export interface BatchJobResult {
  jobId: string;
  success: boolean;
  result?: JobResult;
  error?: string;
}

/**
 * Batch execution result
 */
export interface BatchExecutionResult {
  batchId: string;
  results: BatchJobResult[];
  totalJobs: number;
  successCount: number;
  failureCount: number;
}

/**
 * Worker queue configuration
 */
export interface WorkerQueueConfig {
  workerQueueSize: number;
  queueThreshold: number;
  ackTimeout: number;
  enableWorkerQueues: boolean;
}

/**
 * Worker queue status
 */
export interface WorkerQueueStatus {
  workerId: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  totalProcessed: number;
  queueUtilization: number;
  needsMoreJobs: boolean;
}

/**
 * Queue orchestrator message payloads
 */
export interface FillQueuePayload {
  jobs: BatchJobContext[];
}

export interface RequestJobsPayload {
  workerId: number;
  requestedCount: number;
  currentQueueSize: number;
}

export interface JobAckPayload {
  jobId: string;
  workerId: number;
}

export interface QueueResultPayload {
  jobId: string;
  workerId: number;
  result?: JobResult;
  error?: string;
  processingTime: number;
}

/**
 * Worker state tracking
 */
export interface WorkerState {
  id: number;
  busy: boolean;
  currentJobId?: string;
  activeMessageId?: string;
  lastPing?: Date;
  ready: boolean;
}

/**
 * Callback function type for whenFree API
 */
export type WhenFreeCallback = () => void;

/**
 * Promise resolver for scheduled jobs
 */
export interface JobPromiseResolver {
  resolve: (result: JobResult) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

/**
 * TaskManager events interface
 */
export interface TaskManagerEvents {
  ready: () => void;
  "job-scheduled": (jobId: string) => void;
  "job-completed": (jobId: string, result: JobResult) => void;
  "job-failed": (jobId: string, error: string) => void;
  "queue-empty": () => void;
  "queue-not-empty": () => void;
  "all-workers-busy": () => void;
  "workers-available": () => void;
}

/**
 * Queue statistics interface
 */
export interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  oldestPending?: Date;
}
