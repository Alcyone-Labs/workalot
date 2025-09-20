import { BaseWorker, BaseWorkerConfig } from '../../src/workers/base/BaseWorker.js';
import { BatchJobContext, WorkerMessage } from '../../src/types/index.js';

export interface SpecializedWorkerConfig extends BaseWorkerConfig {
  specializations?: string[];
  maxConcurrentJobs?: number;
  enableCaching?: boolean;
  cacheSize?: number;
  customProcessingStrategy?: 'sequential' | 'parallel' | 'priority';
}

/**
 * Example of a specialized worker with custom behavior
 * This worker demonstrates:
 * - Job type specialization
 * - Custom caching mechanism
 * - Priority-based job processing
 * - Custom metrics collection
 */
export class SpecializedWorker extends BaseWorker {
  private specializations: Set<string>;
  private jobCache = new Map<string, any>();
  private maxConcurrentJobs: number;
  private currentConcurrentJobs = 0;
  private enableCaching: boolean;
  private cacheSize: number;
  private processingStrategy: string;
  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    specializedJobsProcessed: 0,
    genericJobsProcessed: 0,
    averageExecutionTime: 0,
    executionTimes: [] as number[],
  };

  constructor(config: SpecializedWorkerConfig) {
    super(config);

    this.specializations = new Set(config.specializations || []);
    this.maxConcurrentJobs = config.maxConcurrentJobs || 5;
    this.enableCaching = config.enableCaching !== false;
    this.cacheSize = config.cacheSize || 100;
    this.processingStrategy = config.customProcessingStrategy || 'priority';
  }

  /**
   * Called before worker initialization
   */
  protected async onBeforeInitialize(): Promise<void> {
    console.log(`SpecializedWorker ${this.config.workerId}: Initializing with specializations:`,
      Array.from(this.specializations));

    // Send specializations to orchestrator
    await this.registerSpecializations();

    // Load any cached data from persistent storage
    await this.loadCachedData();
  }

  /**
   * Called after worker initialization
   */
  protected async onAfterInitialize(): Promise<void> {
    console.log(`SpecializedWorker ${this.config.workerId}: Ready with ${this.specializations.size} specializations`);

    // Start metrics collection
    this.startMetricsCollection();
  }

  /**
   * Called before worker shutdown
   */
  protected async onBeforeShutdown(): Promise<void> {
    console.log(`SpecializedWorker ${this.config.workerId}: Saving state before shutdown...`);

    // Save cache to persistent storage
    await this.saveCachedData();

    // Report final metrics
    this.reportMetrics();
  }

  /**
   * Called when connected to the orchestrator
   */
  protected onConnected(): void {
    console.log(`SpecializedWorker ${this.config.workerId}: Connected to orchestrator`);

    // Re-register specializations after reconnection
    this.registerSpecializations().catch(err => {
      console.error('Failed to re-register specializations:', err);
    });
  }

  /**
   * Called before job execution
   * Returns false to skip the job
   */
  protected async beforeJobExecution(job: BatchJobContext): Promise<boolean> {
    // Check if we're at max concurrent jobs
    if (this.currentConcurrentJobs >= this.maxConcurrentJobs) {
      console.log(`SpecializedWorker ${this.config.workerId}: Max concurrent jobs reached, deferring job ${job.jobId}`);
      return false;
    }

    // Check if this is a specialized job type we handle
    const jobType = this.extractJobType(job);
    const isSpecialized = this.specializations.has(jobType);

    if (!isSpecialized && this.hasSpecializedWorkersAvailable()) {
      // Let specialized workers handle this if available
      console.log(`SpecializedWorker ${this.config.workerId}: Deferring non-specialized job ${job.jobId}`);
      return false;
    }

    this.currentConcurrentJobs++;
    return true;
  }

  /**
   * Custom job execution with caching and specialization
   */
  protected async onExecuteJob(job: BatchJobContext): Promise<any> {
    const startTime = Date.now();
    const jobType = this.extractJobType(job);
    const isSpecialized = this.specializations.has(jobType);

    // Check cache first
    if (this.enableCaching) {
      const cacheKey = this.generateCacheKey(job);
      const cachedResult = this.jobCache.get(cacheKey);

      if (cachedResult) {
        this.metrics.cacheHits++;
        console.log(`SpecializedWorker ${this.config.workerId}: Cache hit for job ${job.jobId}`);
        return cachedResult;
      }

      this.metrics.cacheMisses++;
    }

    let result: any;

    if (isSpecialized) {
      // Use specialized processing
      result = await this.executeSpecializedJob(job);
      this.metrics.specializedJobsProcessed++;
    } else {
      // Use default processing
      result = await super.onExecuteJob(job);
      this.metrics.genericJobsProcessed++;
    }

    // Cache the result
    if (this.enableCaching) {
      this.cacheResult(job, result);
    }

    // Update metrics
    const executionTime = Date.now() - startTime;
    this.updateExecutionMetrics(executionTime);

    return result;
  }

  /**
   * Called after job execution
   */
  protected async afterJobExecution(
    job: BatchJobContext,
    result: any,
    processingTime: number
  ): Promise<void> {
    this.currentConcurrentJobs = Math.max(0, this.currentConcurrentJobs - 1);

    console.log(`SpecializedWorker ${this.config.workerId}: Job ${job.jobId} completed in ${processingTime}ms`);

    // Analyze result for optimization opportunities
    await this.analyzeJobResult(job, result, processingTime);
  }

  /**
   * Called when job execution fails
   */
  protected async onJobExecutionError(
    job: BatchJobContext,
    error: Error,
    processingTime: number
  ): Promise<void> {
    this.currentConcurrentJobs = Math.max(0, this.currentConcurrentJobs - 1);

    console.error(`SpecializedWorker ${this.config.workerId}: Job ${job.jobId} failed:`, error);

    // Clear any cached data for this job type
    if (this.enableCaching) {
      const cacheKey = this.generateCacheKey(job);
      this.jobCache.delete(cacheKey);
    }

    // Check if error is due to specialization mismatch
    const jobType = this.extractJobType(job);
    if (this.specializations.has(jobType) && this.isSpecializationError(error)) {
      console.log(`SpecializedWorker ${this.config.workerId}: Removing specialization for ${jobType} due to repeated errors`);
      this.specializations.delete(jobType);
      await this.registerSpecializations();
    }
  }

  /**
   * Called before filling the queue
   * Can filter or reorder jobs
   */
  protected async beforeQueueFill(jobs: BatchJobContext[]): Promise<BatchJobContext[]> {
    // Sort jobs based on processing strategy
    let sortedJobs = [...jobs];

    switch (this.processingStrategy) {
      case 'priority':
        sortedJobs.sort((a, b) => {
          const aPriority = a.jobPayload.jobPayload?.priority || 0;
          const bPriority = b.jobPayload.jobPayload?.priority || 0;
          return bPriority - aPriority;
        });
        break;

      case 'sequential':
        // Keep original order
        break;

      case 'parallel':
        // Shuffle for better distribution
        sortedJobs = this.shuffleArray(sortedJobs);
        break;
    }

    // Filter jobs based on specialization if we're busy
    if (this.currentConcurrentJobs > this.maxConcurrentJobs * 0.8) {
      const specializedJobs = sortedJobs.filter(job => {
        const jobType = this.extractJobType(job);
        return this.specializations.has(jobType);
      });

      if (specializedJobs.length > 0) {
        console.log(`SpecializedWorker ${this.config.workerId}: Prioritizing ${specializedJobs.length} specialized jobs`);
        return specializedJobs;
      }
    }

    return sortedJobs;
  }

  /**
   * Handle custom messages
   */
  protected async onCustomMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case 'GET_METRICS':
        await this.sendMessage({
          type: 'METRICS_RESPONSE',
          payload: {
            workerId: this.config.workerId,
            metrics: this.getDetailedMetrics(),
          },
        });
        break;

      case 'UPDATE_SPECIALIZATIONS':
        const newSpecializations = message.payload?.specializations;
        if (newSpecializations) {
          this.specializations = new Set(newSpecializations);
          console.log(`SpecializedWorker ${this.config.workerId}: Updated specializations:`, newSpecializations);
        }
        break;

      case 'CLEAR_CACHE':
        this.jobCache.clear();
        this.metrics.cacheHits = 0;
        this.metrics.cacheMisses = 0;
        console.log(`SpecializedWorker ${this.config.workerId}: Cache cleared`);
        break;
    }
  }

  // Private helper methods

  private async registerSpecializations(): Promise<void> {
    await this.sendMessage({
      type: 'UPDATE_SPECIALIZATIONS',
      payload: {
        workerId: this.config.workerId,
        specializations: Array.from(this.specializations),
      },
    });
  }

  private extractJobType(job: BatchJobContext): string {
    const jobFile = job.jobPayload.jobFile.toString();
    const parts = jobFile.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace('.js', '').replace('.ts', '');
  }

  private async executeSpecializedJob(job: BatchJobContext): Promise<any> {
    const jobType = this.extractJobType(job);

    console.log(`SpecializedWorker ${this.config.workerId}: Executing specialized job ${job.jobId} of type ${jobType}`);

    // Custom processing based on job type
    switch (jobType) {
      case 'DataProcessorJob':
        return this.processDataJob(job);

      case 'ImageProcessorJob':
        return this.processImageJob(job);

      case 'MLInferenceJob':
        return this.processMLJob(job);

      default:
        // Fall back to default execution
        return super.onExecuteJob(job);
    }
  }

  private async processDataJob(job: BatchJobContext): Promise<any> {
    // Specialized data processing logic
    const data = job.jobPayload.jobPayload.data;

    // Simulate complex data processing
    const processed = {
      recordsProcessed: data?.length || 0,
      processingTime: Date.now(),
      workerId: this.config.workerId,
      specialized: true,
    };

    return processed;
  }

  private async processImageJob(job: BatchJobContext): Promise<any> {
    // Specialized image processing logic
    const imagePath = job.jobPayload.jobPayload.imagePath;

    // Simulate image processing
    return {
      imagePath,
      processed: true,
      workerId: this.config.workerId,
      specialized: true,
    };
  }

  private async processMLJob(job: BatchJobContext): Promise<any> {
    // Specialized ML inference logic
    const modelInput = job.jobPayload.jobPayload.input;

    // Simulate ML inference
    return {
      prediction: Math.random(),
      confidence: Math.random(),
      workerId: this.config.workerId,
      specialized: true,
    };
  }

  private generateCacheKey(job: BatchJobContext): string {
    const jobType = this.extractJobType(job);
    const payload = JSON.stringify(job.jobPayload.jobPayload);
    return `${jobType}:${this.hashString(payload)}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private cacheResult(job: BatchJobContext, result: any): void {
    const cacheKey = this.generateCacheKey(job);

    // Implement LRU cache
    if (this.jobCache.size >= this.cacheSize) {
      const firstKey = this.jobCache.keys().next().value;
      this.jobCache.delete(firstKey);
    }

    this.jobCache.set(cacheKey, result);
  }

  private hasSpecializedWorkersAvailable(): boolean {
    // In a real implementation, this would query the orchestrator
    return false;
  }

  private isSpecializationError(error: Error): boolean {
    // Check if error indicates specialization is no longer valid
    return error.message.includes('specialization') ||
           error.message.includes('not supported');
  }

  private updateExecutionMetrics(executionTime: number): void {
    this.metrics.executionTimes.push(executionTime);

    // Keep only last 100 execution times
    if (this.metrics.executionTimes.length > 100) {
      this.metrics.executionTimes.shift();
    }

    // Calculate average
    const sum = this.metrics.executionTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageExecutionTime = sum / this.metrics.executionTimes.length;
  }

  private async analyzeJobResult(
    job: BatchJobContext,
    result: any,
    processingTime: number
  ): Promise<void> {
    // Analyze patterns for optimization
    if (processingTime > 5000) {
      console.log(`SpecializedWorker ${this.config.workerId}: Long-running job detected (${processingTime}ms)`);
      // Could adjust strategy or notify orchestrator
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private async loadCachedData(): Promise<void> {
    // In a real implementation, load from Redis, file system, etc.
    console.log(`SpecializedWorker ${this.config.workerId}: Loading cached data...`);
  }

  private async saveCachedData(): Promise<void> {
    // In a real implementation, save to persistent storage
    console.log(`SpecializedWorker ${this.config.workerId}: Saving ${this.jobCache.size} cached entries...`);
  }

  private startMetricsCollection(): void {
    // Start periodic metrics reporting
    setInterval(() => {
      this.reportMetrics();
    }, 60000); // Report every minute
  }

  private reportMetrics(): void {
    const metrics = this.getDetailedMetrics();
    console.log(`SpecializedWorker ${this.config.workerId} Metrics:`, metrics);

    // Send to orchestrator or metrics service
    this.sendMessage({
      type: 'WORKER_METRICS',
      payload: {
        workerId: this.config.workerId,
        metrics,
      },
    }).catch(err => console.error('Failed to send metrics:', err));
  }

  private getDetailedMetrics(): any {
    return {
      ...this.metrics,
      cacheSize: this.jobCache.size,
      cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
      specializationRate: this.metrics.specializedJobsProcessed /
        (this.metrics.specializedJobsProcessed + this.metrics.genericJobsProcessed) || 0,
      currentConcurrentJobs: this.currentConcurrentJobs,
      maxConcurrentJobs: this.maxConcurrentJobs,
      specializations: Array.from(this.specializations),
      ...this.getStats(),
    };
  }
}
