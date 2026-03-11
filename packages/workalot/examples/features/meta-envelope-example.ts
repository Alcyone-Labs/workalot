import { JobExecutionContext } from "#/types/index.js";

/**
 * Example demonstrating the metaEnvelope feature in JobExecutionContext
 */
export class MetaEnvelopeExample {
  /**
   * Example job that uses metaEnvelope to pass structured data between steps
   */
  static async exampleJobWithMetaEnvelope(
    payload: Record<string, any>,
    context: JobExecutionContext,
  ): Promise<Record<string, any>> {
    // Initialize meta envelope if not present
    if (!context.metaEnvelope) {
      context.metaEnvelope = {
        workflowId: payload.workflowId || "default",
        stepNumber: 1,
        previousResults: [],
        metadata: {},
      };
    }

    // Add current step result to meta envelope
    const stepResult = {
      step: "data-processing",
      timestamp: new Date().toISOString(),
      success: true,
      data: payload,
    };

    context.metaEnvelope.previousResults?.push(stepResult);
    if (context.metaEnvelope.stepNumber !== undefined) {
      context.metaEnvelope.stepNumber++;
    }

    // Store additional metadata
    context.metaEnvelope.metadata = {
      ...context.metaEnvelope.metadata,
      lastProcessedAt: new Date().toISOString(),
      processingTime: Date.now() - context.startTime,
    };

    return {
      message: "Step completed successfully",
      stepResult,
      workflowProgress: context.metaEnvelope,
    };
  }

  /**
   * Example of how to access meta envelope in subsequent jobs
   */
  static async subsequentJobWithMetaEnvelope(
    payload: Record<string, any>,
    context: JobExecutionContext,
  ): Promise<Record<string, any>> {
    if (!context.metaEnvelope) {
      throw new Error("Meta envelope not found - this job should be part of a workflow");
    }

    const workflowId = context.metaEnvelope.workflowId;
    const stepNumber = context.metaEnvelope.stepNumber;
    const previousResults = context.metaEnvelope.previousResults;

    console.log(`Processing step ${stepNumber} of workflow ${workflowId}`);
    console.log(`Previous results: ${previousResults?.length || 0} steps completed`);

    // Add current step to the envelope
    const currentStep = {
      step: "validation",
      timestamp: new Date().toISOString(),
      success: true,
      validationResults: payload,
    };

    context.metaEnvelope.previousResults?.push(currentStep);
    if (context.metaEnvelope.stepNumber !== undefined) {
      context.metaEnvelope.stepNumber++;
    }

    return {
      workflowId,
      stepNumber,
      currentStep,
      totalSteps: context.metaEnvelope.previousResults?.length || 0,
    };
  }
}
