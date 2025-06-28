import { TaskManager } from '../src/index.js';
import { BaseJob } from '../src/jobs/index.js';

/**
 * Example job that demonstrates database-like operations
 */
class DatabaseJob extends BaseJob {
  async run(payload: any): Promise<any> {
    const { operation, data } = payload;
    
    // Simulate database operations with different complexities
    switch (operation) {
      case 'simple_query':
        await this.sleep(10);
        return this.createSuccessResult({
          result: `Processed ${data.records} records`,
          timestamp: new Date().toISOString(),
          operation: 'simple_query'
        });
        
      case 'complex_aggregation':
        await this.sleep(50);
        return this.createSuccessResult({
          result: `Aggregated ${data.tables} tables with ${data.rows} total rows`,
          timestamp: new Date().toISOString(),
          operation: 'complex_aggregation',
          metrics: {
            avgProcessingTime: Math.random() * 100,
            memoryUsed: Math.floor(Math.random() * 1000000)
          }
        });
        
      case 'batch_insert':
        await this.sleep(25);
        return this.createSuccessResult({
          result: `Inserted ${data.batchSize} records into ${data.table}`,
          timestamp: new Date().toISOString(),
          operation: 'batch_insert',
          insertedIds: Array.from({length: data.batchSize}, (_, i) => i + 1)
        });
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * PGLite In-Memory Example
 * 
 * This example demonstrates the power of PGLite in-memory mode:
 * - Full PostgreSQL compatibility
 * - In-memory performance
 * - Real-time job notifications
 * - Advanced SQL querying capabilities
 */
async function pgliteInMemoryExample() {
  console.log('PGLite In-Memory Example\n');
  console.log('Benefits of PGLite In-Memory:');
  console.log('- Full PostgreSQL features (SQL, transactions, notifications)');
  console.log('- Memory-level performance (no disk I/O)');
  console.log('- Real-time job status updates');
  console.log('- Advanced querying and analytics\n');

  // Initialize TaskManager with PGLite in-memory backend
  const taskManager = new TaskManager({
    backend: 'pglite',
    databaseUrl: 'memory://',  // This is the key - in-memory PGLite
    maxThreads: 4,
    silent: false
  });

  await taskManager.initialize();
  console.log('TaskManager initialized with PGLite in-memory backend\n');

  try {
    // Example 1: Basic job execution with database-like operations
    console.log('Example 1: Database-like job operations');
    
    const simpleJob = await taskManager.scheduleAndWait({
      jobFile: 'examples/pglite-inmemory.ts',
      jobPayload: {
        operation: 'simple_query',
        data: { records: 1000 }
      }
    });

    console.log('Simple query result:', simpleJob.results);

    // Example 2: Complex operations that benefit from SQL features
    console.log('\nExample 2: Complex aggregation job');

    const complexJob = await taskManager.scheduleAndWait({
      jobFile: 'examples/pglite-inmemory.ts',
      jobPayload: {
        operation: 'complex_aggregation',
        data: { tables: 5, rows: 50000 }
      }
    });
    
    console.log('Complex aggregation result:', complexJob.results);

    // Example 3: Batch processing with transaction-like behavior
    console.log('\nExample 3: Batch processing jobs');
    
    const batchJobs = await Promise.all([
      taskManager.scheduleAndWait({
        jobFile: 'examples/pglite-inmemory.ts',
        jobPayload: {
          operation: 'batch_insert',
          data: { table: 'users', batchSize: 100 }
        }
      }),
      taskManager.scheduleAndWait({
        jobFile: 'examples/pglite-inmemory.ts',
        jobPayload: {
          operation: 'batch_insert',
          data: { table: 'orders', batchSize: 250 }
        }
      }),
      taskManager.scheduleAndWait({
        jobFile: 'examples/pglite-inmemory.ts',
        jobPayload: {
          operation: 'batch_insert',
          data: { table: 'products', batchSize: 75 }
        }
      })
    ]);
    
    console.log('Batch processing completed:');
    batchJobs.forEach((job, index) => {
      console.log(`  Batch ${index + 1}:`, job.results.result);
    });

    // Example 4: Real-time monitoring with SQL-like queries
    console.log('\nExample 4: System monitoring and analytics');
    
    const status = await taskManager.getStatus();
    console.log('System Status:');
    console.log(`- Queue: ${status.queue.total} total, ${status.queue.completed} completed`);
    console.log(`- Workers: ${status.workers.total} total, ${status.workers.available} available`);
    console.log(`- Performance: ${status.workers.distribution.join(':')} job distribution`);
    
    // Example 5: Advanced queue analytics (leveraging SQL capabilities)
    console.log('\nExample 5: Advanced queue analytics');
    console.log('With PGLite, you can run complex SQL queries on job data:');
    console.log('- SELECT COUNT(*) FROM jobs WHERE status = \'completed\' AND created_at > NOW() - INTERVAL \'1 hour\'');
    console.log('- SELECT AVG(execution_time) FROM jobs WHERE job_type = \'batch_insert\'');
    console.log('- SELECT worker_id, COUNT(*) as job_count FROM job_executions GROUP BY worker_id');
    
    console.log('\nPGLite In-Memory provides the perfect balance:');
    console.log('✓ PostgreSQL features and compatibility');
    console.log('✓ Memory-level performance');
    console.log('✓ No file system dependencies');
    console.log('✓ Real-time notifications and monitoring');
    console.log('✓ Advanced SQL analytics capabilities');

  } catch (error) {
    console.error('Error in PGLite in-memory example:', error);
  } finally {
    // Graceful shutdown
    await taskManager.shutdown();
    console.log('\nTaskManager shut down gracefully');
  }
}

// Performance comparison function
async function performanceComparison() {
  console.log('\n' + '='.repeat(60));
  console.log('PERFORMANCE COMPARISON: Memory vs PGLite In-Memory');
  console.log('='.repeat(60));
  
  const jobCount = 100;
  const configs = [
    {
      name: 'Memory Backend',
      config: { backend: 'memory' as const, maxThreads: 4 }
    },
    {
      name: 'PGLite In-Memory',
      config: { backend: 'pglite' as const, databaseUrl: 'memory://', maxThreads: 4 }
    }
  ];
  
  for (const { name, config } of configs) {
    console.log(`\nTesting ${name}...`);
    
    const taskManager = new TaskManager(config);
    await taskManager.initialize();
    
    const startTime = Date.now();
    
    // Schedule jobs concurrently
    const jobs = Array.from({ length: jobCount }, (_, i) => 
      taskManager.scheduleAndWait({
        jobFile: 'examples/pglite-inmemory.ts',
        jobPayload: {
          operation: 'simple_query',
          data: { records: 100 + i }
        }
      })
    );
    
    await Promise.all(jobs);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    const throughput = Math.round((jobCount / duration) * 1000);
    
    console.log(`${name} Results:`);
    console.log(`  Jobs: ${jobCount}`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Throughput: ${throughput} jobs/sec`);
    
    await taskManager.shutdown();
  }
}

// Export the job class for the task manager
export default DatabaseJob;

// Run the example if this file is executed directly
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  try {
    await pgliteInMemoryExample();
    await performanceComparison();
    
    console.log('\nNext steps:');
    console.log('- Try examples/performance-test.ts for comprehensive benchmarks');
    console.log('- See examples/sample-consumer/ for production-like usage');
    console.log('- Check README.md for complete API documentation');
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}
