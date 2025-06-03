import { 
  initializeTaskManager, 
  scheduleNow, 
  whenFree, 
  shutdown,
  getStatus 
} from '../src/index.js';

/**
 * Basic usage example demonstrating the main API
 */
async function basicUsageExample() {
  try {
    console.log('🚀 Initializing Task Manager...');
    
    // Initialize the task manager with configuration
    await initializeTaskManager({
      maxThreads: 4,
      maxInMemoryAge: 60000, // 1 minute
      persistenceFile: 'task-queue.json',
      healthCheckInterval: 5000
    });

    console.log('✅ Task Manager initialized successfully');

    // Get initial status
    const initialStatus = await getStatus();
    console.log('📊 Initial Status:', {
      workers: initialStatus.workers,
      queue: initialStatus.queue
    });

    console.log('\n📝 Scheduling jobs...');

    // Schedule a simple ping job
    console.log('1. Scheduling ping job...');
    const pingResult = await scheduleNow({
      jobFile: 'examples/PingJob.ts',
      jobPayload: { message: 'Hello from basic example!' }
    });
    console.log('✅ Ping job completed:', pingResult.results);

    // Schedule a math job
    console.log('2. Scheduling math job...');
    const mathResult = await scheduleNow({
      jobFile: 'examples/MathJob.ts',
      jobPayload: {
        operation: 'add',
        numbers: [10, 20, 30, 40, 50]
      },
      jobTimeout: 5000
    });
    console.log('✅ Math job completed:', mathResult.results);

    // Schedule multiple jobs concurrently
    console.log('3. Scheduling multiple jobs concurrently...');
    const concurrentJobs = [
      scheduleNow({
        jobFile: 'examples/MathJob.ts',
        jobPayload: { operation: 'multiply', numbers: [2, 3, 4] }
      }),
      scheduleNow({
        jobFile: 'examples/MathJob.ts',
        jobPayload: { operation: 'average', numbers: [10, 20, 30] }
      }),
      scheduleNow({
        jobFile: 'examples/PingJob.ts',
        jobPayload: { message: 'Concurrent job' }
      })
    ];

    const concurrentResults = await Promise.all(concurrentJobs);
    console.log('✅ All concurrent jobs completed:');
    concurrentResults.forEach((result, index) => {
      console.log(`   Job ${index + 1}:`, result.results);
    });

    // Demonstrate whenFree callback
    console.log('\n⏳ Setting up whenFree callback...');
    whenFree(() => {
      console.log('🎉 Queue is now free! All jobs have been completed.');
    });

    // Schedule one more job to trigger the whenFree callback
    console.log('4. Scheduling final job...');
    await scheduleNow({
      jobFile: 'examples/PingJob.ts',
      jobPayload: { message: 'Final job' }
    });

    // Wait a moment for the whenFree callback to be triggered
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get final status
    const finalStatus = await getStatus();
    console.log('\n📊 Final Status:', {
      workers: finalStatus.workers,
      queue: finalStatus.queue
    });

    console.log('\n🏁 Example completed successfully!');

  } catch (error) {
    console.error('❌ Error in basic usage example:', error);
  } finally {
    // Always shutdown gracefully
    console.log('\n🛑 Shutting down Task Manager...');
    await shutdown();
    console.log('✅ Task Manager shut down successfully');
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  basicUsageExample().catch(console.error);
}

export { basicUsageExample };
