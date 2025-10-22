import { BaseJob } from "../../src/jobs/BaseJob.js";
import { JobExecutionContext } from "../../src/types/index.js";

/**
 * Example job that demonstrates how jobs can schedule other jobs
 * This creates a workflow pattern where one job can trigger follow-up jobs
 */
export class WorkflowJob extends BaseJob {
  constructor() {
    super("WorkflowJob");
  }

  async run(
    payload: Record<string, any>,
    context: JobExecutionContext
  ): Promise<Record<string, any>> {
    this.validatePayload(payload, ["workflowType"]);

    const { workflowType, data } = payload;
    const results: any[] = [];

    try {
      console.log(`🔄 Starting workflow: ${workflowType}`);

      switch (workflowType) {
        case "data_processing_pipeline":
          return await this.runDataProcessingPipeline(data, context);

        case "user_onboarding":
          return await this.runUserOnboardingWorkflow(data, context);

        case "batch_processing":
          return await this.runBatchProcessingWorkflow(data, context);

        default:
          throw new Error(`Unknown workflow type: ${workflowType}`);
      }
    } catch (error) {
      return this.createErrorResult(
        `Workflow failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { workflowType, data }
      );
    }
  }

  /**
   * Example: Data processing pipeline that schedules jobs sequentially
   */
  private async runDataProcessingPipeline(
    data: any,
    context: JobExecutionContext
  ) {
    const results: any[] = [];

    // Step 1: Validate data (schedule for later execution)
    console.log("  Step 1: Scheduling data validation...");
    const validationRequestId = context.schedule({
      jobFile: "examples/_jobs/MathJob.ts",
      jobPayload: {
        operation: "add", // Using 'add' since 'validate' doesn't exist in MathJob
        numbers: data.inputData || [1, 2, 3],
      },
    });
    results.push({
      step: "validation_scheduled",
      requestId: validationRequestId,
    });

    // Step 2: Schedule data processing
    console.log("  Step 2: Scheduling data processing...");
    const processingRequestId = await context.scheduleAndWait({
      jobFile: "examples/_jobs/MathJob.ts",
      jobPayload: {
        operation: "multiply",
        numbers: data.inputData || [2, 3, 4],
      },
    });
    results.push({
      step: "processing_scheduled",
      requestId: processingRequestId,
    });

    // Step 3: Generate report (fire and forget)
    console.log("  Step 3: Scheduling report generation...");
    const reportJobId = context.schedule({
      jobFile: "examples/_jobs/PingJob.ts",
      jobPayload: {
        message: `Report for data processing pipeline`,
      },
    });
    results.push({ step: "report_scheduled", jobId: reportJobId });

    return this.createSuccessResult({
      workflowType: "data_processing_pipeline",
      stepsCompleted: 3,
      results,
      summary: "Data processing pipeline completed successfully",
    });
  }

  /**
   * Example: User onboarding workflow with parallel job execution
   */
  private async runUserOnboardingWorkflow(
    data: any,
    context: JobExecutionContext
  ) {
    const { userId, email, preferences } = data;

    console.log(`  Onboarding user: ${userId}`);

    // Schedule multiple jobs in parallel (fire and forget)
    const jobIds = [
      // Send welcome email
      context.schedule({
        jobFile: "examples/_jobs/PingJob.ts",
        jobPayload: {
          message: `Welcome email for ${email}`,
        },
      }),

      // Setup user preferences
      context.schedule({
        jobFile: "examples/_jobs/MathJob.ts",
        jobPayload: {
          operation: "multiply",
          numbers: [preferences?.length || 1, 10], // Simulate preference processing
        },
      }),

      // Create user profile
      context.schedule({
        jobFile: "examples/_jobs/PingJob.ts",
        jobPayload: {
          message: `Creating profile for user ${userId}`,
        },
      }),
    ];

    // Schedule a critical follow-up job
    console.log("  Scheduling account activation...");
    const activationRequestId = context.schedule({
      jobFile: "examples/_jobs/MathJob.ts",
      jobPayload: {
        operation: "add",
        numbers: [1, 1], // Simulate activation (1 + 1 = 2 = activated)
      },
    });

    return this.createSuccessResult({
      workflowType: "user_onboarding",
      userId,
      backgroundJobIds: jobIds,
      activationRequestId,
      summary: `User ${userId} onboarding initiated with ${jobIds.length} background jobs`,
    });
  }

  /**
   * Example: Batch processing workflow that schedules many jobs
   */
  private async runBatchProcessingWorkflow(
    data: any,
    context: JobExecutionContext
  ) {
    const { batchSize = 5, items = [] } = data;
    const jobIds: string[] = [];

    console.log(
      `  Processing batch of ${items.length} items in chunks of ${batchSize}`
    );

    // Schedule jobs for each batch
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const jobId = context.schedule({
        jobFile: "examples/_jobs/MathJob.ts",
        jobPayload: {
          operation: "add",
          numbers: batch,
        },
      });

      jobIds.push(jobId);
    }

    // Schedule a cleanup job to run after all batches
    const cleanupJobId = context.schedule({
      jobFile: "examples/_jobs/PingJob.ts",
      jobPayload: {
        message: `Cleanup after processing ${jobIds.length} batches`,
      },
    });

    return this.createSuccessResult({
      workflowType: "batch_processing",
      totalItems: items.length,
      batchCount: jobIds.length,
      batchJobIds: jobIds,
      cleanupJobId,
      summary: `Scheduled ${jobIds.length} batch processing jobs + 1 cleanup job`,
    });
  }
}

// Export as default for easy importing
export default WorkflowJob;
