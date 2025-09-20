import { WorkflowOrchestrator } from './WorkflowOrchestrator.js';
import { SpecializedWorker } from './SpecializedWorker.js';
import { PostgreSQLQueue } from '../../src/queue/PostgreSQLQueue.js';
import { JobPayload, JobStatus } from '../../src/types/index.js';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Complete example demonstrating the new extensible Workalot architecture
 *
 * This example shows:
 * - Custom orchestrator with workflow support
 * - Specialized workers with custom behavior
 * - WebSocket-based communication
 * - PostgreSQL queue with LISTEN/NOTIFY
 * - Complex workflow orchestration
 */

async function main() {
  console.log('Starting Custom Workalot Orchestration Example...\n');

  // 1. Create PostgreSQL queue backend
  const postgresQueue = new PostgreSQLQueue({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'workalot',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    enableNotifications: true,
    tableName: 'custom_jobs',
    retentionDays: 7,
  });

  // Initialize the queue
  await postgresQueue.initialize();
  console.log('PostgreSQL queue initialized with LISTEN/NOTIFY support\n');

  // 2. Create custom orchestrator with workflow support
  const orchestrator = new WorkflowOrchestrator({
    wsPort: 8080,
    wsHostname: 'localhost',
    queueBackend: postgresQueue,
    workerQueueSize: 100,
    queueThreshold: 20,
    distributionStrategy: 'custom', // Use custom worker selection
    maxRetries: 3,
    retryDelay: 1000,
  });

  // Set up orchestrator event handlers
  orchestrator.on('worker-registered', ({ workerId }) => {
    console.log(`✓ Worker ${workerId} registered with orchestrator`);
  });

  orchestrator.on('job-completed', ({ jobId, workerId, processingTime }) => {
    console.log(`✓ Job ${jobId} completed by worker ${workerId} in ${processingTime}ms`);
  });

  orchestrator.on('job-failed', ({ jobId, error, workerId }) => {
    console.error(`✗ Job ${jobId} failed on worker ${workerId}: ${error}`);
  });

  orchestrator.on('workflow-started', ({ workflowId, name }) => {
    console.log(`▶ Workflow started: ${name} (${workflowId})`);
  });

  orchestrator.on('workflow-step-completed', ({ workflowId, stepId, result }) => {
    console.log(`  → Step ${stepId} completed in workflow ${workflowId}`);
  });

  orchestrator.on('workflow-completed', ({ workflowId, results }) => {
    console.log(`✓ Workflow ${workflowId} completed successfully`);
    console.log('  Results:', results);
  });

  // Start the orchestrator
  await orchestrator.start();
  console.log('Custom orchestrator started\n');

  // 3. Create specialized workers with different capabilities
  const workers: SpecializedWorker[] = [];

  // Data processing specialist
  const dataWorker = new SpecializedWorker({
    workerId: 1,
    wsUrl: 'ws://localhost:8080/worker',
    projectRoot: __dirname,
    specializations: ['DataProcessorJob', 'DataTransformerJob', 'DataValidatorJob'],
    maxConcurrentJobs: 10,
    enableCaching: true,
    cacheSize: 500,
    customProcessingStrategy: 'priority',
  });

  // ML inference specialist
  const mlWorker = new SpecializedWorker({
    workerId: 2,
    wsUrl: 'ws://localhost:8080/worker',
    projectRoot: __dirname,
    specializations: ['MLInferenceJob', 'ModelTrainingJob'],
    maxConcurrentJobs: 3, // ML jobs are resource-intensive
    enableCaching: true,
    cacheSize: 100,
    customProcessingStrategy: 'sequential',
  });

  // General purpose worker
  const generalWorker = new SpecializedWorker({
    workerId: 3,
    wsUrl: 'ws://localhost:8080/worker',
    projectRoot: __dirname,
    specializations: [], // No specializations, handles any job
    maxConcurrentJobs: 20,
    enableCaching: false,
    customProcessingStrategy: 'parallel',
  });

  // Initialize all workers
  await Promise.all([
    dataWorker.initialize(),
    mlWorker.initialize(),
    generalWorker.initialize(),
  ]);

  workers.push(dataWorker, mlWorker, generalWorker);
  console.log('All specialized workers initialized\n');

  // 4. Define and start a complex workflow
  const dataProcessingWorkflow = await orchestrator.startWorkflow({
    id: 'data-pipeline-001',
    name: 'Data Processing Pipeline',
    steps: new Map([
      ['extract', {
        jobPayload: {
          jobFile: path.join(__dirname, '../jobs/DataExtractorJob.js'),
          jobPayload: {
            source: 'database',
            query: 'SELECT * FROM users',
            priority: 10,
          },
        },
      }],
      ['transform', {
        jobPayload: {
          jobFile: path.join(__dirname, '../jobs/DataTransformerJob.js'),
          jobPayload: {
            transformationType: 'normalize',
            priority: 8,
          },
        },
        dependencies: ['extract'],
        onComplete: async (result) => {
          console.log('Transform completed:', result);
        },
      }],
      ['validate', {
        jobPayload: {
          jobFile: path.join(__dirname, '../jobs/DataValidatorJob.js'),
          jobPayload: {
            validationRules: ['required', 'unique', 'format'],
            priority: 9,
          },
        },
        dependencies: ['transform'],
      }],
      ['ml-analysis', {
        jobPayload: {
          jobFile: path.join(__dirname, '../jobs/MLInferenceJob.js'),
          jobPayload: {
            model: 'sentiment-analysis',
            priority: 5,
          },
        },
        dependencies: ['validate'],
      }],
      ['notify', {
        jobPayload: {
          jobFile: path.join(__dirname, '../jobs/NotificationJob.js'),
          jobPayload: {
            channel: 'email',
            recipients: ['team@example.com'],
            priority: 1,
          },
        },
        dependencies: ['ml-analysis'],
        onComplete: async (result) => {
          console.log('Notification sent:', result);
        },
        onError: async (error) => {
          console.error('Notification failed:', error);
        },
      }],
    ]),
  });

  console.log(`Started workflow: ${dataProcessingWorkflow}\n`);

  // 5. Schedule individual high-priority jobs
  const urgentJobs = [
    {
      jobFile: path.join(__dirname, '../jobs/DataProcessorJob.js'),
      jobPayload: {
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: Math.random() })),
        priority: 100, // High priority
        __affinity: { workerId: 1 }, // Prefer worker 1
      },
    },
    {
      jobFile: path.join(__dirname, '../jobs/MLInferenceJob.js'),
      jobPayload: {
        input: { text: 'This is a test inference' },
        model: 'text-classification',
        priority: 90,
      },
    },
  ];

  const jobIds = await Promise.all(
    urgentJobs.map(job => orchestrator.scheduleJob(job))
  );

  console.log('Scheduled urgent jobs:', jobIds);

  // 6. Monitor queue statistics
  const monitorInterval = setInterval(async () => {
    const orchestratorStats = orchestrator.getStats();
    const queueStats = await postgresQueue.getStats();

    console.log('\n=== System Statistics ===');
    console.log('Orchestrator:', orchestratorStats);
    console.log('Queue:', queueStats);
    console.log('========================\n');
  }, 5000);

  // 7. Demonstrate custom message routing
  setTimeout(async () => {
    console.log('\nRequesting metrics from all workers...');

    // Send custom message to all workers
    for (const worker of workers) {
      await worker.sendMessage({
        type: 'GET_METRICS',
        payload: {},
      });
    }
  }, 3000);

  // 8. Handle PostgreSQL notifications
  postgresQueue.onJobUpdate((event) => {
    console.log('PostgreSQL Notification:', event);
  });

  // 9. Demonstrate job recovery
  setTimeout(async () => {
    console.log('\nRecovering stalled jobs...');
    const recovered = await postgresQueue.recoverStalledJobs(60000); // Jobs stalled for 1 minute
    console.log(`Recovered ${recovered} stalled jobs`);
  }, 10000);

  // 10. Graceful shutdown after 30 seconds
  setTimeout(async () => {
    console.log('\nInitiating graceful shutdown...');

    clearInterval(monitorInterval);

    // Get final statistics
    const finalStats = {
      orchestrator: orchestrator.getStats(),
      queue: await postgresQueue.getStats(),
      workers: workers.map(w => ({
        workerId: w.config.workerId,
        stats: w.getStats(),
      })),
    };

    console.log('\n=== Final Statistics ===');
    console.log(JSON.stringify(finalStats, null, 2));
    console.log('========================\n');

    // Shutdown workers
    await Promise.all(workers.map(w => w.shutdown()));
    console.log('All workers shut down');

    // Shutdown orchestrator
    await orchestrator.stop();
    console.log('Orchestrator shut down');

    // Shutdown queue
    await postgresQueue.shutdown();
    console.log('Queue shut down');

    console.log('\n✓ Graceful shutdown complete');
    process.exit(0);
  }, 30000);

  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    clearInterval(monitorInterval);

    await Promise.all(workers.map(w => w.shutdown()));
    await orchestrator.stop();
    await postgresQueue.shutdown();

    process.exit(0);
  });
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the example
main().catch(console.error);
