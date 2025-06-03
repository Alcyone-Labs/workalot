#!/usr/bin/env node

import { 
  initializeTaskManager, 
  scheduleNow, 
  whenFree, 
  shutdown,
  getStatus,
  getQueueStats,
  getWorkerStats,
  isIdle
} from '../../src/index.js';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Sample Consumer Application
 * 
 * This application demonstrates a real-world usage of the task management library
 * for processing data files, generating reports, and sending notifications.
 */
class SampleConsumerApp {
  private isRunning = false;
  private processedCount = 0;
  private startTime = Date.now();

  async start() {
    console.log('🚀 Starting Sample Consumer Application...');
    
    try {
      // Initialize task manager with custom configuration
      await initializeTaskManager({
        maxThreads: 6,
        maxInMemoryAge: 10 * 60 * 1000, // 10 minutes
        persistenceFile: resolve(__dirname, 'data/queue-state.json'),
        healthCheckInterval: 3000
      });

      console.log('✅ Task Manager initialized');
      this.isRunning = true;

      // Set up monitoring
      this.setupMonitoring();

      // Set up completion handler
      this.setupCompletionHandler();

      // Process sample workload
      await this.processWorkload();

    } catch (error) {
      console.error('❌ Application failed to start:', error);
      process.exit(1);
    }
  }

  private setupMonitoring() {
    // Monitor system status every 5 seconds
    const monitorInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(monitorInterval);
        return;
      }

      try {
        const status = await getStatus();
        const queueStats = await getQueueStats();
        const workerStats = await getWorkerStats();

        console.log('\n📊 System Status:');
        console.log(`   Queue: ${queueStats.pending} pending, ${queueStats.processing} processing, ${queueStats.completed} completed`);
        console.log(`   Workers: ${workerStats.available}/${workerStats.total} available`);
        console.log(`   Processed: ${this.processedCount} jobs`);
        console.log(`   Runtime: ${Math.round((Date.now() - this.startTime) / 1000)}s`);
      } catch (error) {
        console.error('❌ Monitoring error:', error);
      }
    }, 5000);
  }

  private setupCompletionHandler() {
    whenFree(() => {
      console.log('\n🎉 All jobs completed! Queue is now free.');
      this.showFinalStats();
    });
  }

  private async processWorkload() {
    console.log('\n📝 Processing sample workload...');

    // Simulate different types of jobs
    const jobs = [
      // Data processing jobs
      ...this.createDataProcessingJobs(),
      
      // Report generation jobs
      ...this.createReportJobs(),
      
      // Notification jobs
      ...this.createNotificationJobs(),
      
      // Cleanup jobs
      ...this.createCleanupJobs()
    ];

    console.log(`\n🔄 Scheduling ${jobs.length} jobs...`);

    // Process jobs in batches to demonstrate different patterns
    await this.processBatch('Data Processing', jobs.slice(0, 5));
    await this.processBatch('Report Generation', jobs.slice(5, 8));
    await this.processBatch('Notifications', jobs.slice(8, 12));
    await this.processBatch('Cleanup', jobs.slice(12));

    console.log('\n✅ All jobs scheduled successfully');
  }

  private async processBatch(batchName: string, jobs: any[]) {
    console.log(`\n📦 Processing batch: ${batchName} (${jobs.length} jobs)`);

    const promises = jobs.map(async (job, index) => {
      try {
        const result = await scheduleNow(job);
        this.processedCount++;
        console.log(`   ✅ ${batchName} job ${index + 1} completed in ${result.executionTime}ms`);
        return result;
      } catch (error) {
        console.error(`   ❌ ${batchName} job ${index + 1} failed:`, error.message);
        throw error;
      }
    });

    try {
      await Promise.all(promises);
      console.log(`   🎯 ${batchName} batch completed successfully`);
    } catch (error) {
      console.error(`   ⚠️  ${batchName} batch had failures`);
    }
  }

  private createDataProcessingJobs() {
    return [
      {
        jobFile: 'examples/sample-consumer/jobs/DataProcessorJob.ts',
        jobPayload: {
          inputFile: 'data/sample1.json',
          operation: 'transform',
          outputFile: 'data/processed1.json'
        },
        jobTimeout: 10000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/DataProcessorJob.ts',
        jobPayload: {
          inputFile: 'data/sample2.json',
          operation: 'validate',
          outputFile: 'data/validated2.json'
        },
        jobTimeout: 8000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/DataProcessorJob.ts',
        jobPayload: {
          inputFile: 'data/sample3.json',
          operation: 'aggregate',
          outputFile: 'data/aggregated3.json'
        },
        jobTimeout: 12000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/DataAnalysisJob.ts',
        jobPayload: {
          dataset: 'sales_data',
          analysisType: 'trend',
          period: '2024-Q1'
        },
        jobTimeout: 15000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/DataAnalysisJob.ts',
        jobPayload: {
          dataset: 'user_behavior',
          analysisType: 'pattern',
          period: '2024-01'
        },
        jobTimeout: 20000
      }
    ];
  }

  private createReportJobs() {
    return [
      {
        jobFile: 'examples/sample-consumer/jobs/ReportGeneratorJob.ts',
        jobPayload: {
          reportType: 'daily_summary',
          date: '2024-01-15',
          format: 'pdf'
        },
        jobTimeout: 25000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/ReportGeneratorJob.ts',
        jobPayload: {
          reportType: 'weekly_analytics',
          week: '2024-W03',
          format: 'excel'
        },
        jobTimeout: 30000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/ReportGeneratorJob.ts',
        jobPayload: {
          reportType: 'monthly_dashboard',
          month: '2024-01',
          format: 'html'
        },
        jobTimeout: 35000
      }
    ];
  }

  private createNotificationJobs() {
    return [
      {
        jobFile: 'examples/sample-consumer/jobs/NotificationJob.ts',
        jobPayload: {
          type: 'email',
          recipients: ['admin@example.com'],
          subject: 'Daily Report Ready',
          template: 'daily_report_notification'
        },
        jobTimeout: 5000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/NotificationJob.ts',
        jobPayload: {
          type: 'slack',
          channel: '#analytics',
          message: 'Weekly analytics report has been generated',
          priority: 'normal'
        },
        jobTimeout: 3000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/NotificationJob.ts',
        jobPayload: {
          type: 'webhook',
          url: 'https://api.example.com/notifications',
          payload: { event: 'report_generated', timestamp: Date.now() }
        },
        jobTimeout: 8000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/NotificationJob.ts',
        jobPayload: {
          type: 'sms',
          recipients: ['+1234567890'],
          message: 'Critical alert: Monthly dashboard is ready for review'
        },
        jobTimeout: 4000
      }
    ];
  }

  private createCleanupJobs() {
    return [
      {
        jobFile: 'examples/sample-consumer/jobs/CleanupJob.ts',
        jobPayload: {
          operation: 'archive_old_files',
          directory: 'data/temp',
          olderThan: '7d'
        },
        jobTimeout: 10000
      },
      {
        jobFile: 'examples/sample-consumer/jobs/CleanupJob.ts',
        jobPayload: {
          operation: 'clear_cache',
          cacheType: 'redis',
          pattern: 'analytics:*'
        },
        jobTimeout: 5000
      }
    ];
  }

  private async showFinalStats() {
    try {
      const finalStats = await getQueueStats();
      const workerStats = await getWorkerStats();
      const totalTime = Math.round((Date.now() - this.startTime) / 1000);

      console.log('\n📈 Final Statistics:');
      console.log(`   Total Jobs Processed: ${this.processedCount}`);
      console.log(`   Successful: ${finalStats.completed}`);
      console.log(`   Failed: ${finalStats.failed}`);
      console.log(`   Total Runtime: ${totalTime}s`);
      console.log(`   Average: ${(this.processedCount / totalTime).toFixed(2)} jobs/second`);
      console.log(`   Workers Used: ${workerStats.total}`);

      // Wait a moment then shutdown
      setTimeout(async () => {
        await this.stop();
      }, 2000);

    } catch (error) {
      console.error('❌ Error showing final stats:', error);
      await this.stop();
    }
  }

  async stop() {
    console.log('\n🛑 Shutting down application...');
    this.isRunning = false;

    try {
      await shutdown();
      console.log('✅ Application shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  try {
    await shutdown();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  try {
    await shutdown();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// Start the application
const app = new SampleConsumerApp();
app.start().catch(console.error);
