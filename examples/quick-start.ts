#!/usr/bin/env bun
/**
 * Quick Start Example for @alcyone-labs/workalot
 * 
 * This example demonstrates the basic usage of the job queue system
 * with a simple "Hello World" job that showcases core features.
 */

import { TaskManager } from '../src/index.js';
import { BaseJob } from '../src/jobs/index.js';

// Define a simple job class
export default class HelloJob extends BaseJob {
  async run(payload: { name: string; delay?: number }) {
    // Validate required fields
    this.validatePayload(payload, ['name']);
    
    // Simulate some work
    const delay = payload.delay || 100;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Return success result
    return this.createSuccessResult({
      message: `Hello, ${payload.name}!`,
      timestamp: new Date().toISOString(),
      processedIn: delay
    });
  }
}

async function quickStartExample() {
  console.log('Workalot Quick Start Example\n');

  // Initialize TaskManager with memory backend for best performance
  const taskManager = new TaskManager({
    backend: 'memory',
    maxThreads: 4,
    silent: false // Set to true to reduce console output
  });

  await taskManager.initialize();
  console.log('TaskManager initialized\n');

  // Example 1: Schedule a single job and wait for completion
  console.log('Example 1: Single job execution');
  const result = await taskManager.scheduleAndWait({
    jobFile: 'examples/quick-start.ts',
    jobPayload: { name: 'World', delay: 50 }
  });

  console.log('Job result:', result.results);
  console.log(`Execution time: ${result.executionTime}ms\n`);

  // Example 2: Schedule multiple jobs concurrently
  console.log('Example 2: Multiple concurrent jobs');
  const startTime = Date.now();
  
  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(
      taskManager.scheduleAndWait({
        jobFile: 'examples/quick-start.ts',
        jobPayload: { name: `User${i}`, delay: 25 }
      })
    );
  }

  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;
  
  console.log(`Processed ${results.length} jobs in ${totalTime}ms`);
  console.log(`Average: ${(totalTime / results.length).toFixed(2)}ms per job\n`);

  // Example 3: Fire-and-forget job scheduling
  console.log('Example 3: Fire-and-forget scheduling');
  const jobIds = [];
  
  for (let i = 1; i <= 5; i++) {
    const jobId = await taskManager.schedule({
      jobFile: 'examples/quick-start.ts',
      jobPayload: { name: `Background${i}`, delay: 10 }
    });
    jobIds.push(jobId);
  }

  console.log(`Scheduled ${jobIds.length} background jobs`);
  
  // Wait for all jobs to complete
  await taskManager.whenIdle();
  console.log('All background jobs completed\n');

  // Example 4: Real-time monitoring
  console.log('Example 4: System monitoring');
  const status = await taskManager.getStatus();

  console.log('System Status:');
  console.log(`- Queue: ${status.queue.total} total, ${status.queue.completed} completed`);
  console.log(`- Workers: ${status.workers.total} total, ${status.workers.available} available`);
  console.log(`- Performance: ${status.workers.distribution.join(':')} job distribution\n`);

  // Graceful shutdown
  await taskManager.shutdown();
  console.log('TaskManager shut down gracefully');

  console.log('\nQuick start example completed!');
  console.log('Next steps:');
  console.log('- Check out examples/performance-test.ts for performance benchmarking');
  console.log('- See examples/sample-consumer/ for a complete application example');
  console.log('- Read the README.md for comprehensive API documentation');
}

// Run the example
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  quickStartExample().catch(console.error);
}
