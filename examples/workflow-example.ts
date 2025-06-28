#!/usr/bin/env bun

/**
 * Example demonstrating how jobs can schedule other jobs
 * This shows various workflow patterns using the WorkflowJob
 */

import { initializeTaskManager, scheduleAndWait, shutdown } from '../src/api/functions.js';

async function main() {
  try {
    console.log('🚀 Initializing task manager...');
    await initializeTaskManager({
      backend: 'memory',
      maxThreads: 4
    });

    console.log('✅ Task manager initialized!\n');

    // Example 1: Sequential data processing pipeline
    console.log('📋 Example 1: Data Processing Pipeline');
    console.log('=====================================');
    
    const pipelineResult = await scheduleAndWait({
      jobFile: 'examples/WorkflowJob.ts',
      jobPayload: {
        workflowType: 'data_processing_pipeline',
        data: {
          inputData: [10, 20, 30, 40, 50]
        }
      }
    });
    
    console.log('Pipeline Result:', JSON.stringify(pipelineResult.results, null, 2));
    console.log('');

    // Example 2: User onboarding workflow with parallel jobs
    console.log('👤 Example 2: User Onboarding Workflow');
    console.log('======================================');
    
    const onboardingResult = await scheduleAndWait({
      jobFile: 'examples/WorkflowJob.ts',
      jobPayload: {
        workflowType: 'user_onboarding',
        data: {
          userId: 'user_12345',
          email: 'newuser@example.com',
          preferences: ['email_notifications', 'sms_alerts', 'push_notifications']
        }
      }
    });
    
    console.log('Onboarding Result:', JSON.stringify(onboardingResult.results, null, 2));
    console.log('');

    // Example 3: Batch processing workflow
    console.log('📦 Example 3: Batch Processing Workflow');
    console.log('=======================================');
    
    const batchResult = await scheduleAndWait({
      jobFile: 'examples/WorkflowJob.ts',
      jobPayload: {
        workflowType: 'batch_processing',
        data: {
          batchSize: 3,
          items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        }
      }
    });
    
    console.log('Batch Result:', JSON.stringify(batchResult.results, null, 2));
    console.log('');

    // Wait a moment for background jobs to complete
    console.log('⏳ Waiting for background jobs to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('🎉 All workflow examples completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    console.log('🔄 Shutting down task manager...');
    await shutdown();
    console.log('✅ Shutdown complete');
  }
}

// Run the example
main().catch(console.error);
