import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diagnostics, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Optional: Enable diagnostic logging for debugging OTEL itself
// diagnostics.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

export interface TelemetryConfig {
  serviceName?: string;
  serviceVersion?: string;
  enableConsoleExporter?: boolean;
}

let sdk: NodeSDK | undefined;

export function initTelemetry(config: TelemetryConfig = {}) {
  if (sdk) {
    console.warn('Telemetry SDK already initialized');
    return;
  }

  const serviceName = config.serviceName || 'workalot';
  const serviceVersion = config.serviceVersion || '1.0.0';

  // Trace Exporter
  // For production, this should likely be OTLPTraceExporter
  const traceExporter = new ConsoleSpanExporter();

  // Metric Reader
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new ConsoleMetricExporter(),
    exportIntervalMillis: 60000, // Export metrics every minute
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable specific auto-instrumentations if they are too noisy
        // '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    console.log(`Telemetry SDK started for service: ${serviceName}`);
  } catch (error) {
    console.error('Failed to start Telemetry SDK:', error);
  }

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk?.shutdown()
      .then(() => console.log('Telemetry SDK shut down'))
      .catch((error) => console.error('Error shutting down Telemetry SDK', error))
      .finally(() => process.exit(0));
  });
}

export function shutdownTelemetry() {
    if (sdk) {
        return sdk.shutdown();
    }
    return Promise.resolve();
}
