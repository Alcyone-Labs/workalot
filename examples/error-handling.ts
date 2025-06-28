#!/usr/bin/env bun
/**
 * Error Handling Example for @alcyone-labs/workalot
 * 
 * This example demonstrates comprehensive error handling patterns
 * including job failures, timeouts, and system errors.
 */

import { TaskManager } from '../src/index.js';
import { BaseJob } from '../src/jobs/index.js';

// Job that can succeed, fail, or timeout based on payload
export default class ErrorTestJob extends BaseJob {
  async run(payload: { 
    behavior: 'success' | 'error' | 'timeout';
    message?: string;
    delay?: number;
  }) {
    this.validatePayload(payload, ['behavior']);
    
    const { behavior, message = 'Test message', delay = 100 } = payload;
    
    switch (behavior) {
      case 'success':
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.createSuccessResult({
          message: `Success: ${message}`,
          timestamp: new Date().toISOString()
        });
        
      case 'error':
        await new Promise(resolve => setTimeout(resolve, delay));
        throw new Error(`Simulated error: ${message}`);
        
      case 'timeout':
        // This will cause a timeout if delay > jobTimeout
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.createSuccessResult({
          message: `Should not reach here: ${message}`
        });
        
      default:
        throw new Error(`Unknown behavior: ${behavior}`);
    }
  }
}

async function errorHandlingExample() {
  console.log('🛡️ Workalot Error Handling Example\n');

  const taskManager = new TaskManager({
    backend: 'memory',
    maxThreads: 2,
    silent: false
  });

  await taskManager.initialize();

  // Set up event listeners for monitoring
  taskManager.on('job-completed', (jobId, result) => {
    console.log(`✅ Job ${jobId.substring(0, 8)} completed successfully`);
  });

  taskManager.on('job-failed', (jobId, error) => {
    console.log(`❌ Job ${jobId.substring(0, 8)} failed: ${error}`);
  });

  console.log('📝 Example 1: Successful job execution');
  try {
    const result = await taskManager.scheduleAndWait({
      jobFile: 'examples/error-handling.ts',
      jobPayload: { 
        behavior: 'success',
        message: 'This should work fine'
      }
    });
    console.log('Success result:', result.results.message);
  } catch (error) {
    console.log('Unexpected error:', error instanceof Error ? error.message : String(error));
  }
  console.log('');

  console.log('📝 Example 2: Job execution error');
  try {
    const result = await taskManager.scheduleAndWait({
      jobFile: 'examples/error-handling.ts',
      jobPayload: { 
        behavior: 'error',
        message: 'This will fail intentionally'
      }
    });
    console.log('Should not reach here:', result);
  } catch (error) {
    console.log('Caught expected error:', error instanceof Error ? error.message : String(error));
  }
  console.log('');

  console.log('📝 Example 3: Job timeout handling');
  try {
    const result = await taskManager.scheduleAndWait({
      jobFile: 'examples/error-handling.ts',
      jobPayload: { 
        behavior: 'timeout',
        message: 'This will timeout',
        delay: 2000 // 2 seconds delay
      },
      jobTimeout: 1000 // 1 second timeout
    });
    console.log('Should not reach here:', result);
  } catch (error) {
    console.log('Caught timeout error:', error instanceof Error ? error.message : String(error));
  }
  console.log('');

  console.log('📝 Example 4: Invalid job file handling');
  try {
    const result = await taskManager.scheduleAndWait({
      jobFile: 'non-existent-job.ts',
      jobPayload: { data: 'test' }
    });
    console.log('Should not reach here:', result);
  } catch (error) {
    console.log('Caught file error:', error instanceof Error ? error.message : String(error));
  }
  console.log('');

  console.log('📝 Example 5: Batch error handling with mixed results');
  const batchPromises = [
    // Success
    taskManager.scheduleAndWait({
      jobFile: 'examples/error-handling.ts',
      jobPayload: { behavior: 'success', message: 'Batch job 1' }
    }).catch((error: Error) => ({ error: error instanceof Error ? error.message : String(error) })),
    
    // Error
    taskManager.scheduleAndWait({
      jobFile: 'examples/error-handling.ts',
      jobPayload: { behavior: 'error', message: 'Batch job 2' }
    }).catch((error: Error) => ({ error: error instanceof Error ? error.message : String(error) })),
    
    // Success
    taskManager.scheduleAndWait({
      jobFile: 'examples/error-handling.ts',
      jobPayload: { behavior: 'success', message: 'Batch job 3' }
    }).catch((error: Error) => ({ error: error instanceof Error ? error.message : String(error) })),
  ];

  const batchResults = await Promise.all(batchPromises);
  
  console.log('Batch results:');
  batchResults.forEach((result: any, index: number) => {
    if ('error' in result) {
      console.log(`  Job ${index + 1}: ❌ ${result.error}`);
    } else {
      console.log(`  Job ${index + 1}: ✅ ${result.results.message}`);
    }
  });
  console.log('');

  console.log('📝 Example 6: System status during errors');
  const status = await taskManager.getStatus();
  console.log('Final system status:');
  console.log(`- Total jobs processed: ${status.queue.total}`);
  console.log(`- Successful: ${status.queue.completed}`);
  console.log(`- Failed: ${status.queue.failed}`);
  console.log(`- Workers available: ${status.workers.available}/${status.workers.total}`);

  await taskManager.shutdown();
  console.log('\n✅ TaskManager shut down gracefully');
  
  console.log('\n🎉 Error handling example completed!');
  console.log('\nError Handling Best Practices:');
  console.log('- Always wrap job execution in try-catch blocks');
  console.log('- Set appropriate timeouts for your jobs');
  console.log('- Use event listeners to monitor job failures');
  console.log('- Validate job payloads early in the job execution');
  console.log('- Handle batch operations with Promise.allSettled() for partial failures');
}

// Run the example
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  errorHandlingExample().catch(console.error);
}
