/**
 * Telemetry types for Workalot
 */

export interface TelemetryConfig {
  /** Enable/disable telemetry entirely */
  enabled: boolean;
  /** Service name for tracing attribution */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Sampling rate for spans (0.0 - 1.0) */
  sampleRate?: number;
  /** OpenTelemetry collector endpoint for traces */
  otlpEndpoint?: string;
  /** Prometheus metrics export configuration */
  prometheus?: {
    /** Enable Prometheus metrics export */
    enabled: boolean;
    /** Port to expose metrics on (default: 9090) */
    port?: number;
    /** Path to expose metrics on (default: /metrics) */
    path?: string;
  };
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string>;
}

export interface JobSpanAttributes {
  /** Job unique identifier */
  'job.id': string;
  /** Job type/name */
  'job.type': string;
  /** Job file path */
  'job.file': string;
  /** Worker ID that processed the job */
  'worker.id'?: number;
  /** Queue time in milliseconds */
  'job.queue_time_ms'?: number;
  /** Execution time in milliseconds */
  'job.execution_time_ms'?: number;
  /** Job payload size in bytes (approximate) */
  'job.payload_size'?: number;
  /** Whether job succeeded */
  'job.success'?: boolean;
  /** Error message if job failed */
  'error.message'?: string;
  /** Error type if job failed */
  'error.type'?: string;
}

export interface QueueMetrics {
  /** Current queue depth by status */
  depth: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  /** Oldest pending job timestamp */
  oldestPending?: Date;
}

export interface WorkerMetrics {
  /** Worker ID */
  workerId: number;
  /** Current state */
  state: 'idle' | 'busy' | 'error' | 'disconnected';
  /** Jobs processed by this worker */
  jobsProcessed: number;
  /** Jobs failed by this worker */
  jobsFailed: number;
  /** Current utilization percentage (0-100) */
  utilization: number;
  /** Current job ID if busy */
  currentJobId?: string;
  /** Time spent processing jobs in ms */
  totalProcessingTime: number;
}

export interface SystemMetrics {
  /** Memory usage in bytes */
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  /** CPU usage percentage (0-100) */
  cpuUsage: number;
  /** Event loop lag in milliseconds */
  eventLoopLag?: number;
  /** Active handles */
  activeHandles?: number;
  /** Active requests */
  activeRequests?: number;
}

export type TelemetryEventType = 
  | 'job.scheduled'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'job.retry'
  | 'worker.registered'
  | 'worker.unregistered'
  | 'worker.error'
  | 'queue.stalled'
  | 'queue.recovered';

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: Date;
  jobId?: string;
  workerId?: number;
  attributes?: Record<string, any>;
}

export interface HistogramValue {
  /** Number of observations */
  count: number;
  /** Sum of all values */
  sum: number;
  /** Buckets with counts */
  buckets: { le: number; count: number }[];
}
