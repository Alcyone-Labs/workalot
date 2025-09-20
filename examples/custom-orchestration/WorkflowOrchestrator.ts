import { BaseOrchestrator, OrchestratorConfig, WorkerState, JobDistributionContext } from '../../src/orchestration/BaseOrchestrator.js';
import { JobPayload, JobResult, WorkerMessage } from '../../src/types/index.js';

/**
 * Example of a custom orchestrator that implements workflow support
 * and custom job distribution logic
 */
export class WorkflowOrchestrator extends BaseOrchestrator {
  private workflowDefinitions = new Map<string, any>();
  private jobDependencies = new Map<string, Set<string>>();
  private jobRetries = new Map<string, number>();
  private workerSpecializations = new Map<number, Set<string>>();

  constructor(config: OrchestratorConfig) {
    super(config);
  }

  /**
   * Called when orchestrator starts
   */
  protected async onStart(): Promise<void> {
    console.log('WorkflowOrchestrator: Starting with custom logic...');

    // Register custom message routes for workflow control
    this.registerWorkflowRoutes();

    // Load workflow definitions from database or config
    await this.loadWorkflowDefinitions();
  }

  /**
   * Called when orchestrator stops
   */
  protected async onStop(): Promise<void> {
    console.log('WorkflowOrchestrator: Performing cleanup...');

    // Save workflow state
    await this.saveWorkflowState();

    // Clean up resources
    this.workflowDefinitions.clear();
    this.jobDependencies.clear();
    this.jobRetries.clear();
  }

  /**
   * Called when a worker is registered
   */
  protected onWorkerRegistered(workerId: number, state: WorkerState): void {
    console.log(`WorkflowOrchestrator: Worker ${workerId} registered`);

    // Assign worker specializations based on metadata
    if (state.customMetadata?.specializations) {
      this.workerSpecializations.set(
        workerId,
        new Set(state.customMetadata.specializations)
      );
    }
  }

  /**
   * Called when a worker is unregistered
   */
  protected onWorkerUnregistered(workerId: number, state: WorkerState): void {
    console.log(`WorkflowOrchestrator: Worker ${workerId} unregistered`);

    // Clean up worker specializations
    this.workerSpecializations.delete(workerId);

    // Reassign any pending jobs from this worker
    this.reassignWorkerJobs(workerId);
  }

  /**
   * Called before a job is scheduled
   * Can validate or transform the job payload
   */
  protected async beforeJobSchedule(jobPayload: JobPayload): Promise<JobPayload> {
    // Add metadata for tracking
    const enhancedPayload = {
      ...jobPayload,
      jobPayload: {
        ...jobPayload.jobPayload,
        __metadata: {
          timestamp: Date.now(),
          version: '1.0',
          source: 'WorkflowOrchestrator',
        },
      },
    };

    // Validate job type
    if (!this.isValidJobType(enhancedPayload)) {
      throw new Error(`Invalid job type: ${enhancedPayload.jobFile}`);
    }

    return enhancedPayload;
  }

  /**
   * Called after a job is scheduled
   */
  protected async onJobScheduled(jobId: string, jobPayload: JobPayload): Promise<void> {
    console.log(`WorkflowOrchestrator: Job ${jobId} scheduled`);

    // Track job for workflow management
    if (jobPayload.jobPayload.__workflow) {
      const { workflowId, dependencies } = jobPayload.jobPayload.__workflow;

      if (dependencies && dependencies.length > 0) {
        this.jobDependencies.set(jobId, new Set(dependencies));
      }
    }
  }

  /**
   * Called when a job is completed
   */
  protected async onJobCompleted(
    jobId: string,
    result: JobResult,
    workerId: number
  ): Promise<void> {
    console.log(`WorkflowOrchestrator: Job ${jobId} completed by worker ${workerId}`);

    // Clear job from retry tracking
    this.jobRetries.delete(jobId);

    // Check if this job unblocks any dependencies
    await this.checkAndScheduleDependentJobs(jobId);

    // Check if this completes a workflow
    if (result.results?.__workflow) {
      await this.handleWorkflowStepCompletion(
        result.results.__workflow.workflowId,
        result.results.__workflow.stepId,
        result
      );
    }

    // Update worker statistics
    this.updateWorkerStats(workerId, true);
  }

  /**
   * Called when a job fails
   */
  protected async onJobFailed(
    jobId: string,
    error: Error,
    workerId: number
  ): Promise<void> {
    console.log(`WorkflowOrchestrator: Job ${jobId} failed on worker ${workerId}: ${error.message}`);

    // Check retry policy
    const retryCount = this.jobRetries.get(jobId) || 0;

    if (retryCount < (this.config.maxRetries || 3)) {
      console.log(`WorkflowOrchestrator: Retrying job ${jobId} (attempt ${retryCount + 1})`);

      // Update retry count
      this.jobRetries.set(jobId, retryCount + 1);

      // Reschedule with exponential backoff
      const delay = Math.pow(2, retryCount) * (this.config.retryDelay || 1000);
      setTimeout(async () => {
        await this.rescheduleJob(jobId);
      }, delay);
    } else {
      console.log(`WorkflowOrchestrator: Job ${jobId} exceeded max retries`);

      // Mark workflow as failed if part of workflow
      await this.handleWorkflowFailure(jobId, error);

      // Clean up
      this.jobRetries.delete(jobId);
      this.jobDependencies.delete(jobId);
    }

    // Update worker statistics
    this.updateWorkerStats(workerId, false);
  }

  /**
   * Custom worker selection logic
   */
  protected async selectWorker(context: JobDistributionContext): Promise<WorkerState | null> {
    const { job, availableWorkers } = context;

    if (availableWorkers.length === 0) {
      return null;
    }

    // Extract job type from payload
    const jobType = this.extractJobType(job.jobPayload);

    // First, try to find a specialized worker
    const specializedWorkers = availableWorkers.filter(worker => {
      const specializations = this.workerSpecializations.get(worker.workerId);
      return specializations && specializations.has(jobType);
    });

    if (specializedWorkers.length > 0) {
      // Select least loaded specialized worker
      return specializedWorkers.reduce((min, worker) =>
        worker.status.pendingJobs < min.status.pendingJobs ? worker : min
      );
    }

    // Check for affinity rules
    if (job.jobPayload.jobPayload?.__affinity) {
      const affinityWorkerId = job.jobPayload.jobPayload.__affinity.workerId;
      const affinityWorker = availableWorkers.find(w => w.workerId === affinityWorkerId);

      if (affinityWorker) {
        return affinityWorker;
      }
    }

    // Default to least loaded worker
    return availableWorkers.reduce((min, worker) => {
      // Calculate load score
      const loadScore = this.calculateWorkerLoad(worker);
      const minLoadScore = this.calculateWorkerLoad(min);

      return loadScore < minLoadScore ? worker : min;
    });
  }

  /**
   * Register custom message routes for workflow control
   */
  private registerWorkflowRoutes(): void {
    // Handle workflow status requests
    this.addMessageRoute(
      'WORKFLOW_STATUS',
      async (connection, message) => {
        const workflowId = message.payload?.workflowId;
        const workflow = this.workflows.get(workflowId);

        if (workflow) {
          await this.wsServer.sendToWorker(connection.workerId!, {
            type: 'WORKFLOW_STATUS_RESPONSE',
            payload: {
              workflowId,
              name: workflow.name,
              completedSteps: Array.from(workflow.completedSteps),
              totalSteps: workflow.steps.size,
              results: Object.fromEntries(workflow.results),
            },
          });
        }
      },
      100
    );

    // Handle workflow cancellation
    this.addMessageRoute(
      'CANCEL_WORKFLOW',
      async (connection, message) => {
        const workflowId = message.payload?.workflowId;
        await this.cancelWorkflow(workflowId);
      },
      100
    );

    // Handle worker specialization updates
    this.addMessageRoute(
      'UPDATE_SPECIALIZATIONS',
      async (connection, message) => {
        const workerId = connection.workerId;
        if (workerId !== undefined) {
          const specializations = message.payload?.specializations;
          if (specializations) {
            this.workerSpecializations.set(workerId, new Set(specializations));
            console.log(`Updated specializations for worker ${workerId}:`, specializations);
          }
        }
      },
      100
    );
  }

  /**
   * Load workflow definitions
   */
  private async loadWorkflowDefinitions(): Promise<void> {
    // Example workflow definition
    const exampleWorkflow = {
      id: 'data-processing-workflow',
      name: 'Data Processing Pipeline',
      steps: [
        { id: 'extract', type: 'DataExtractorJob', dependencies: [] },
        { id: 'transform', type: 'DataTransformerJob', dependencies: ['extract'] },
        { id: 'validate', type: 'DataValidatorJob', dependencies: ['transform'] },
        { id: 'load', type: 'DataLoaderJob', dependencies: ['validate'] },
        { id: 'notify', type: 'NotificationJob', dependencies: ['load'] },
      ],
    };

    this.workflowDefinitions.set(exampleWorkflow.id, exampleWorkflow);
  }

  /**
   * Save workflow state
   */
  private async saveWorkflowState(): Promise<void> {
    // Save active workflows to persistent storage
    for (const [workflowId, workflow] of this.workflows) {
      console.log(`Saving state for workflow ${workflowId}`);
      // Implementation would save to database
    }
  }

  /**
   * Check if job type is valid
   */
  private isValidJobType(jobPayload: JobPayload): boolean {
    // Implement job type validation
    const validTypes = [
      'DataExtractorJob',
      'DataTransformerJob',
      'DataValidatorJob',
      'DataLoaderJob',
      'NotificationJob',
    ];

    const jobType = this.extractJobType(jobPayload);
    return validTypes.includes(jobType);
  }

  /**
   * Extract job type from payload
   */
  private extractJobType(jobPayload: JobPayload): string {
    const jobFile = jobPayload.jobFile.toString();
    const parts = jobFile.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace('.js', '').replace('.ts', '');
  }

  /**
   * Calculate worker load score
   */
  private calculateWorkerLoad(worker: WorkerState): number {
    const pendingWeight = 1.0;
    const processingWeight = 2.0;
    const utilizationWeight = 0.5;

    return (
      worker.status.pendingJobs * pendingWeight +
      worker.status.processingJobs * processingWeight +
      worker.status.queueUtilization * utilizationWeight
    );
  }

  /**
   * Update worker statistics
   */
  private updateWorkerStats(workerId: number, success: boolean): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      if (!worker.customMetadata) {
        worker.customMetadata = {};
      }

      if (!worker.customMetadata.stats) {
        worker.customMetadata.stats = {
          successCount: 0,
          failureCount: 0,
          successRate: 0,
        };
      }

      if (success) {
        worker.customMetadata.stats.successCount++;
      } else {
        worker.customMetadata.stats.failureCount++;
      }

      const total = worker.customMetadata.stats.successCount + worker.customMetadata.stats.failureCount;
      worker.customMetadata.stats.successRate =
        total > 0 ? worker.customMetadata.stats.successCount / total : 0;
    }
  }

  /**
   * Reassign jobs from a disconnected worker
   */
  private async reassignWorkerJobs(workerId: number): Promise<void> {
    console.log(`Reassigning jobs from worker ${workerId}`);
    // Implementation would query jobs assigned to this worker and reschedule them
  }

  /**
   * Check and schedule dependent jobs
   */
  private async checkAndScheduleDependentJobs(completedJobId: string): Promise<void> {
    for (const [jobId, dependencies] of this.jobDependencies) {
      dependencies.delete(completedJobId);

      if (dependencies.size === 0) {
        console.log(`All dependencies met for job ${jobId}, scheduling...`);
        // Schedule the job
        await this.rescheduleJob(jobId);
        this.jobDependencies.delete(jobId);
      }
    }
  }

  /**
   * Handle workflow step completion
   */
  private async handleWorkflowStepCompletion(
    workflowId: string,
    stepId: string,
    result: JobResult
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return;
    }

    console.log(`Workflow ${workflowId}: Step ${stepId} completed`);

    // Additional workflow logic here
  }

  /**
   * Handle workflow failure
   */
  private async handleWorkflowFailure(jobId: string, error: Error): Promise<void> {
    // Find associated workflow and mark as failed
    for (const [workflowId, workflow] of this.workflows) {
      // Check if job is part of this workflow
      // Implementation would check workflow steps
      console.log(`Workflow ${workflowId} failed due to job ${jobId}: ${error.message}`);
    }
  }

  /**
   * Cancel a workflow
   */
  private async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return;
    }

    console.log(`Cancelling workflow ${workflowId}`);

    // Cancel all pending jobs in workflow
    // Implementation would cancel jobs

    this.workflows.delete(workflowId);

    this.emit('workflow-cancelled', { workflowId });
  }

  /**
   * Reschedule a job
   */
  private async rescheduleJob(jobId: string): Promise<void> {
    // Implementation would requeue the job
    console.log(`Rescheduling job ${jobId}`);
  }
}
