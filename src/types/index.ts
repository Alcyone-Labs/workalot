import { PathLike } from 'fs';

/**
 * Job status enumeration
 */
export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
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
 * Job result structure returned from job execution
 */
export interface JobResult {
  results: Record<string, any>;
  executionTime: number; // Time taken to execute in milliseconds
  queueTime: number; // Time spent waiting in queue in milliseconds
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
   * @returns The job result or throws an error
   */
  run(payload: Record<string, any>): Promise<Record<string, any>> | Record<string, any>;
}

/**
 * Worker message types for communication between main thread and workers
 */
export enum WorkerMessageType {
  PING = 'ping',
  PONG = 'pong',
  EXECUTE_JOB = 'execute_job',
  JOB_RESULT = 'job_result',
  JOB_ERROR = 'job_error',
  WORKER_READY = 'worker_ready',
  WORKER_ERROR = 'worker_error'
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
 * Worker state tracking
 */
export interface WorkerState {
  id: number;
  busy: boolean;
  currentJobId?: string;
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
  'ready': () => void;
  'job-scheduled': (jobId: string) => void;
  'job-completed': (jobId: string, result: JobResult) => void;
  'job-failed': (jobId: string, error: string) => void;
  'queue-empty': () => void;
  'queue-not-empty': () => void;
  'all-workers-busy': () => void;
  'workers-available': () => void;
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
