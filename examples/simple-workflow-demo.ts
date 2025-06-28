#!/usr/bin/env bun

/**
 * Simple demonstration of jobs scheduling other jobs
 */

import { initializeTaskManager, scheduleAndWait, shutdown } from '../src/api/functions.js';

async function main() {
  try {
    console.log('🚀 Initializing task manager...');
    await initializeTaskManager({
      backend: 'memory',
      maxThreads: 2
    });

    console.log('✅ Task manager initialized!\n');

    // Example: A workflow job that schedules follow-up jobs
    console.log('📋 Running workflow that schedules other jobs...');
    
    const workflowResult = await scheduleAndWait({
      jobFile: 'examples/WorkflowJob.ts',
      jobPayload: {
        workflowType: 'data_processing_pipeline',
        data: {
          inputData: [1, 2, 3, 4, 5]
        }
      }
    });
    
    console.log('✅ Workflow completed!');
    console.log('📊 Workflow scheduled', workflowResult.results.data.results.length, 'follow-up jobs');
    
    // Show the scheduled jobs
    workflowResult.results.data.results.forEach((result: any, index: number) => {
      console.log(`   ${index + 1}. ${result.step}: ${result.requestId || result.jobId}`);
    });

    // Wait a moment for the scheduled jobs to complete
    console.log('\n⏳ Waiting for scheduled jobs to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('🎉 All jobs completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    console.log('\n🔄 Shutting down task manager...');
    await shutdown();
    console.log('✅ Shutdown complete');
  }
}

// Run the demo
main().catch(console.error);
