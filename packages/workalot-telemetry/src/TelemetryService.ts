import {
  context,
  trace,
  Span,
  SpanStatusCode,
  Tracer,
  Attributes,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  TelemetryConfig,
  JobSpanAttributes,
  QueueMetrics,
  WorkerMetrics,
  SystemMetrics,
  TelemetryEvent,
  TelemetryEventType,
} from './types.js';

/**
 * TelemetryService provides comprehensive observability for Workalot
 * 
 * Features:
 * - Distributed tracing via OpenTelemetry
 * - Prometheus metrics export
 * - Job lifecycle tracking
 * - Queue and worker metrics
 * - System resource monitoring
 */
export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private config: TelemetryConfig;
  private tracer: Tracer;
  private sdk?: NodeSDK;
  private activeSpans = new Map<string, Span>();
  private jobTypes = new Map<string, string>(); // Track job types separately for metrics
  private eventHandlers: ((event: TelemetryEvent) => void)[] = [];
  private isInitialized = false;

  // Metrics
  private jobCounter?: any;
  private jobDurationHistogram?: any;
  private queueDepthGauge?: any;
  private workerUtilizationGauge?: any;
  private systemMemoryGauge?: any;
  private systemCpuGauge?: any;

  private constructor(config: TelemetryConfig) {
    this.config = {
      sampleRate: 1.0,
      prometheus: { enabled: false },
      ...config,
    };
    this.tracer = trace.getTracer('workalot');
  }

  /**
   * Get or create the telemetry service singleton
   */
  static getInstance(config?: TelemetryConfig): TelemetryService {
    if (!TelemetryService.instance) {
      if (!config) {
        throw new Error('TelemetryService must be initialized with config first');
      }
      TelemetryService.instance = new TelemetryService(config);
    }
    return TelemetryService.instance;
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static resetInstance(): void {
    TelemetryService.instance = null;
  }

  /**
   * Initialize the telemetry service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized || !this.config.enabled) {
      return;
    }

    const resource = resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: this.config.serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: this.config.serviceVersion || '2.0.0',
      ...this.config.resourceAttributes,
    });

    // Configure trace exporter
    const traceExporter = this.config.otlpEndpoint
      ? new OTLPTraceExporter({ url: this.config.otlpEndpoint })
      : undefined;

    // Configure Prometheus exporter
    let prometheusExporter: PrometheusExporter | undefined;
    if (this.config.prometheus?.enabled) {
      prometheusExporter = new PrometheusExporter(
        {
          port: this.config.prometheus.port || 9090,
          endpoint: this.config.prometheus.path || '/metrics',
        },
        () => {
          console.log(
            `📊 Prometheus metrics available at http://localhost:${
              this.config.prometheus?.port || 9090
            }${this.config.prometheus?.path || '/metrics'}`
          );
        }
      );
    }

    // Initialize SDK
    this.sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader: prometheusExporter,
    });

    await this.sdk.start();

    // Initialize custom metrics
    this.initializeMetrics();

    this.isInitialized = true;
    console.log('🔍 Telemetry service initialized');
  }

  /**
   * Shutdown telemetry service
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // End all active spans
    for (const [jobId, span] of this.activeSpans) {
      span.end();
    }
    this.activeSpans.clear();

    await this.sdk?.shutdown();
    this.isInitialized = false;
    console.log('🔍 Telemetry service shut down');
  }

  /**
   * Start a job span
   */
  startJobSpan(jobId: string, attributes: JobSpanAttributes): Span {
    if (!this.isInitialized || !this.shouldSample()) {
      // Return a no-op span
      return trace.getSpan(context.active()) || trace.wrapSpanContext({ traceId: '', spanId: '', traceFlags: 0 });
    }

    const span = this.tracer.startSpan('job.execute', {
      attributes: {
        ...attributes,
        'job.id': jobId,
      },
    });

    this.activeSpans.set(jobId, span);
    // Track job type for metrics
    if (attributes['job.type']) {
      this.jobTypes.set(jobId, attributes['job.type']);
    }
    return span;
  }

  /**
   * End a job span with status
   */
  endJobSpan(
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled',
    result?: { executionTime?: number; queueTime?: number; error?: Error }
  ): void {
    const span = this.activeSpans.get(jobId);
    if (!span) return;

    // Add result attributes
    if (result?.executionTime !== undefined) {
      span.setAttribute('job.execution_time_ms', result.executionTime);
    }
    if (result?.queueTime !== undefined) {
      span.setAttribute('job.queue_time_ms', result.queueTime);
    }

    // Set status
    if (status === 'completed') {
      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttribute('job.success', true);
      this.jobCounter?.add(1, { status: 'completed' });
    } else {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: result?.error?.message || status,
      });
      span.setAttribute('job.success', false);
      if (result?.error) {
        span.recordException(result.error);
        span.setAttribute('error.message', result.error.message);
        span.setAttribute('error.type', result.error.name);
      }
      this.jobCounter?.add(1, { status });
    }

    // Record duration if available
    if (result?.executionTime !== undefined) {
      const jobType = this.jobTypes.get(jobId) || 'unknown';
      this.jobDurationHistogram?.record(result.executionTime, {
        status,
        job_type: jobType,
      });
    }
    
    // Clean up job type tracking
    this.jobTypes.delete(jobId);

    span.end();
    this.activeSpans.delete(jobId);
  }

  /**
   * Record queue metrics
   */
  recordQueueMetrics(metrics: QueueMetrics): void {
    if (!this.isInitialized) return;

    this.queueDepthGauge?.record(metrics.depth.pending, { status: 'pending' });
    this.queueDepthGauge?.record(metrics.depth.processing, { status: 'processing' });
    this.queueDepthGauge?.record(metrics.depth.completed, { status: 'completed' });
    this.queueDepthGauge?.record(metrics.depth.failed, { status: 'failed' });
    this.queueDepthGauge?.record(metrics.depth.cancelled, { status: 'cancelled' });
  }

  /**
   * Record worker metrics
   */
  recordWorkerMetrics(metrics: WorkerMetrics): void {
    if (!this.isInitialized) return;

    this.workerUtilizationGauge?.record(metrics.utilization, {
      worker_id: String(metrics.workerId),
      state: metrics.state,
    });
  }

  /**
   * Record system metrics
   */
  recordSystemMetrics(metrics: SystemMetrics): void {
    if (!this.isInitialized) return;

    this.systemMemoryGauge?.record(metrics.memory.rss, { type: 'rss' });
    this.systemMemoryGauge?.record(metrics.memory.heapUsed, { type: 'heap_used' });
    this.systemCpuGauge?.record(metrics.cpuUsage);
  }

  /**
   * Emit a telemetry event
   */
  emitEvent(event: TelemetryEvent): void {
    if (!this.isInitialized) return;

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Telemetry event handler error:', error);
      }
    }
  }

  /**
   * Subscribe to telemetry events
   */
  onEvent(handler: (event: TelemetryEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Get Prometheus metrics as string
   */
  async getPrometheusMetrics(): Promise<string> {
    if (!this.isInitialized || !this.config.prometheus?.enabled) {
      return '# Telemetry not initialized or Prometheus disabled\n';
    }

    // This would typically come from the Prometheus exporter
    // For now, return a placeholder
    return '# Workalot Metrics\n# (Prometheus metrics endpoint active)\n';
  }

  /**
   * Get current configuration
   */
  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  /**
   * Check if telemetry is initialized
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  private shouldSample(): boolean {
    return Math.random() < (this.config.sampleRate || 1.0);
  }

  private initializeMetrics(): void {
    // These would be properly initialized with the MeterProvider
    // For now, we'll create references that can be used later
    const meterProvider = new MeterProvider({
      resource: resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]: this.config.serviceName,
      }),
    });

    const meter = meterProvider.getMeter('workalot');

    this.jobCounter = meter.createCounter('workalot_jobs_total', {
      description: 'Total number of jobs processed',
    });

    this.jobDurationHistogram = meter.createHistogram('workalot_job_duration_ms', {
      description: 'Job execution duration in milliseconds',
      unit: 'ms',
    });

    this.queueDepthGauge = meter.createUpDownCounter('workalot_queue_depth', {
      description: 'Current queue depth by status',
    });

    this.workerUtilizationGauge = meter.createGauge('workalot_worker_utilization', {
      description: 'Worker utilization percentage',
      unit: '%',
    });

    this.systemMemoryGauge = meter.createGauge('workalot_system_memory_bytes', {
      description: 'System memory usage in bytes',
      unit: 'bytes',
    });

    this.systemCpuGauge = meter.createGauge('workalot_system_cpu_percent', {
      description: 'System CPU usage percentage',
      unit: '%',
    });
  }
}
