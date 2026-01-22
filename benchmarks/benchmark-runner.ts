import { TaskManager, getQueueStats } from "../src/index.js";
import { PerformanceMonitor } from "./performance-monitor.js";
import {
  BenchmarkConfig,
  BenchmarkResult,
  PhaseResult,
  TaskType,
  WorkerStats,
  scaleTaskTypes,
} from "./benchmark-config.js";
import { getLogger } from "./benchmark-logger.js";
import * as cliProgress from "cli-progress";

export class BenchmarkRunner {
  private monitor = new PerformanceMonitor();
  private workerTracker = new WorkerTracker();
  private progressBar: cliProgress.SingleBar | null = null;
  private workerManagerListeners: Array<{ event: string; listener: Function }> = [];

  /**
   * Reset the benchmark runner state between benchmarks
   */
  private resetState(): void {
    // Reset monitor
    this.monitor = new PerformanceMonitor();

    // Reset worker tracker
    this.workerTracker = new WorkerTracker();

    // Clean up progress bar if it exists
    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }

    // Clear worker manager listeners
    this.workerManagerListeners = [];
  }

  /**
   * Detect if we're running in a compiled environment (Node.js with compiled JS)
   * vs a TypeScript runtime (Bun, Deno)
   */
  private isCompiledEnvironment(): boolean {
    // Check if we're running from the dist directory
    const currentFile = import.meta.url;
    return currentFile.includes("/dist/");
  }

  /**
   * Run a single benchmark configuration
   */
  async runBenchmark(config: BenchmarkConfig, timeout?: number): Promise<BenchmarkResult> {
    // Reset state to ensure clean benchmark execution
    this.resetState();

    const logger = getLogger();
    logger.benchmarkStart(config);

    const startTime = Date.now();

    // Initialize task manager
    logger.info("SETUP", "Initializing task manager", {
      maxThreads: config.cores,
      backend: config.backend,
      databaseUrl: config.databaseUrl,
    });

    // Create a new TaskManager instance for this benchmark
    const taskManager = new TaskManager({
      maxThreads: config.cores,
      backend: config.backend,
      databaseUrl: config.databaseUrl,
      maxInMemoryAge: 5 * 60 * 1000, // 5 minutes
      healthCheckInterval: 1000,
      silent: true, // Enable silent mode for benchmarks
      jobRecoveryEnabled: false, // Disable job recovery during benchmarks
    });

    await taskManager.initialize();
    logger.info("SETUP", "TaskManager initialized successfully");

    // Workers are now in silent mode, no need for console interception

    // Generate job payloads
    const jobs = this.generateJobs(config);
    logger.info("SETUP", `Generated ${jobs.length} job payloads`);

    // Combined Phase: Queue and Execute jobs in a realistic pattern
    logger.phaseStart("execution", { cores: config.cores, totalJobs: jobs.length });
    const executionPhase = await this.measureQueueAndExecutePhase(
      jobs,
      config.cores,
      timeout || 300000,
      taskManager,
    );
    logger.phaseComplete("execution", executionPhase.duration);

    // For compatibility, create a minimal queueing phase result
    const queueingPhase = {
      duration: 0, // Queueing is now integrated into execution
      cpuUsage: [],
      memoryUsage: [],
      peakCPU: 0,
      peakMemory: 0,
      averageCPU: 0,
      averageMemory: 0,
      workerStats: [],
    };

    const totalTime = Date.now() - startTime;
    const jobsPerSecond = config.totalJobs / (totalTime / 1000);

    // Cleanup
    logger.info("CLEANUP", "Cleaning up worker event listeners");
    try {
      // Clean up worker event listeners before shutting down
      const workerManager = (taskManager as any).jobScheduler?.workerManager;
      if (workerManager) {
        this.cleanupWorkerListeners(workerManager);
        logger.info("CLEANUP", "Worker event listeners cleaned up");
      }
    } catch (error) {
      logger.warn(
        "CLEANUP",
        `Failed to clean up worker listeners: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    logger.info("CLEANUP", "Shutting down task manager");
    try {
      // Add timeout to shutdown to prevent hanging
      const shutdownPromise = taskManager.shutdown();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("TaskManager shutdown timed out after 10 seconds")),
          10000,
        );
      });

      await Promise.race([shutdownPromise, timeoutPromise]);
      logger.info("CLEANUP", "Task manager shutdown completed");
    } catch (error) {
      logger.error(
        "CLEANUP",
        `Task manager shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw the error, just log it and continue cleanup
      logger.warn("CLEANUP", "Continuing with cleanup despite shutdown error");
    }

    // Clean up queue state file and database files to prevent conflicts in next benchmark
    logger.info("CLEANUP", "Cleaning up queue state file");
    try {
      const fs = await import("node:fs/promises");
      await fs.unlink("queue-state.json");
      logger.info("CLEANUP", "Queue state file cleaned up");
    } catch (error) {
      // File might not exist, ignore
      logger.debug("CLEANUP", "Queue state file not found (expected)");
    }

    // Clean up SQLite database files
    if (config.backend === "sqlite" && config.databaseUrl && config.databaseUrl !== "memory://") {
      try {
        const fs = await import("node:fs/promises");
        await fs.unlink(config.databaseUrl);
        // Also clean up potential WAL and SHM files
        await fs.unlink(config.databaseUrl + "-wal").catch(() => {});
        await fs.unlink(config.databaseUrl + "-shm").catch(() => {});
      } catch (error) {
        // Files might not exist, ignore
      }
    }

    // Clean up PGLite database files
    if (config.backend === "pglite" && config.databaseUrl && config.databaseUrl !== "memory://") {
      try {
        const fs = await import("node:fs/promises");
        await fs.unlink(config.databaseUrl);
        // PGLite might create additional files, clean them up too
        await fs.unlink(config.databaseUrl + "-wal").catch(() => {});
        await fs.unlink(config.databaseUrl + "-shm").catch(() => {});
      } catch (error) {
        // Files might not exist, ignore
      }
    }

    logger.info("CLEANUP", "Creating benchmark result");
    const result: BenchmarkResult = {
      config,
      queueingPhase,
      executionPhase,
      totalTime,
      jobsPerSecond,
      timestamp: new Date().toISOString(),
    };

    logger.info("CLEANUP", "Logging benchmark completion");
    logger.benchmarkComplete(config, result);

    logger.info("CLEANUP", "Benchmark runner completed successfully");
    return result;
  }

  /**
   * Generate job payloads based on configuration
   */
  private generateJobs(config: BenchmarkConfig): any[] {
    const jobs: any[] = [];
    const logger = getLogger();

    // Apply difficulty scaling to task types
    const scaledTaskTypes = config.difficulty
      ? scaleTaskTypes(config.taskTypes, config.difficulty)
      : config.taskTypes;

    logger.debug("JOBS", "Task types after difficulty scaling", {
      original: config.taskTypes,
      scaled: scaledTaskTypes,
      difficulty: config.difficulty,
    });

    // Create weighted distribution of task types
    const distribution = this.createTaskDistribution(scaledTaskTypes, config.totalJobs);

    for (let i = 0; i < config.totalJobs; i++) {
      const taskType = distribution[i];

      // Determine the correct job file path based on runtime
      const jobFilePath = this.isCompiledEnvironment()
        ? "dist/benchmarks/BenchmarkJob.js"
        : "benchmarks/BenchmarkJob.ts";

      jobs.push({
        jobFile: jobFilePath,
        jobPayload: {
          taskType: taskType.name,
          cpuCycles: taskType.cpuCycles,
          jobIndex: i,
        },
        jobTimeout: 30000, // 30 second timeout
      });
    }

    return jobs;
  }

  /**
   * Create weighted distribution of task types
   */
  private createTaskDistribution(taskTypes: TaskType[], totalJobs: number): TaskType[] {
    const distribution: TaskType[] = [];

    // Calculate job counts for each task type
    let remainingJobs = totalJobs;
    const taskCounts = taskTypes.map((taskType, index) => {
      if (index === taskTypes.length - 1) {
        // Last task type gets remaining jobs
        return remainingJobs;
      }
      const count = Math.floor(totalJobs * taskType.weight);
      remainingJobs -= count;
      return count;
    });

    // Create distribution array
    taskTypes.forEach((taskType, index) => {
      for (let i = 0; i < taskCounts[index]; i++) {
        distribution.push(taskType);
      }
    });

    // Shuffle for random distribution
    for (let i = distribution.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distribution[i], distribution[j]] = [distribution[j], distribution[i]];
    }

    return distribution;
  }

  /**
   * Connect WorkerTracker to TaskManager events
   */
  private connectWorkerTracker(taskManager?: TaskManager): void {
    if (!taskManager) {
      console.warn("TaskManager not available for worker tracking");
      return;
    }

    // Suppress console output during benchmark execution to avoid interfering with progress bars

    // Get the JobScheduler from TaskManager
    const jobScheduler = (taskManager as any).jobScheduler;
    if (!jobScheduler) {
      console.warn("JobScheduler not available for worker tracking");
      return;
    }

    // Get the WorkerManager from JobScheduler
    const workerManager = (jobScheduler as any).workerManager;
    if (!workerManager) {
      console.warn("WorkerManager not available for worker tracking");
      return;
    }

    // Clean up any existing listeners
    this.cleanupWorkerListeners(workerManager);

    // Connect to worker events (both single job and batch events)
    const jobStartedListener = (workerId: number, jobId: string) => {
      this.workerTracker.jobStarted(workerId);
    };
    const jobCompletedListener = (workerId: number, jobId: string, result: any) => {
      this.workerTracker.jobCompleted(workerId);
    };
    const jobFailedListener = (workerId: number, jobId: string, error: string) => {
      this.workerTracker.jobCompleted(workerId); // Still count as completed for tracking
    };
    const batchStartedListener = (workerId: number, batchId: string, jobCount: number) => {
      // Mark worker as busy for the entire batch
      for (let i = 0; i < jobCount; i++) {
        this.workerTracker.jobStarted(workerId);
      }
    };
    const batchCompletedListener = (workerId: number, batchId: string, result: any) => {
      // Mark all jobs in batch as completed
      const jobCount = result.totalJobs || 0;
      for (let i = 0; i < jobCount; i++) {
        this.workerTracker.jobCompleted(workerId);
      }
    };

    // Add listeners and track them for cleanup
    workerManager.on("job-started", jobStartedListener);
    workerManager.on("job-completed", jobCompletedListener);
    workerManager.on("job-failed", jobFailedListener);
    workerManager.on("batch-started", batchStartedListener);
    workerManager.on("batch-completed", batchCompletedListener);

    // Store listeners for cleanup
    this.workerManagerListeners = [
      { event: "job-started", listener: jobStartedListener },
      { event: "job-completed", listener: jobCompletedListener },
      { event: "job-failed", listener: jobFailedListener },
      { event: "batch-started", listener: batchStartedListener },
      { event: "batch-completed", listener: batchCompletedListener },
    ];
  }

  /**
   * Clean up worker manager listeners
   */
  private cleanupWorkerListeners(workerManager: any): void {
    for (const { event, listener } of this.workerManagerListeners) {
      workerManager.off(event, listener);
    }
    this.workerManagerListeners = [];
  }

  /**
   * Measure combined queue and execute phase performance
   * This queues jobs gradually while workers execute them, simulating realistic workload
   */
  private async measureQueueAndExecutePhase(
    jobs: any[],
    workerCount: number,
    timeout: number,
    taskManager: TaskManager,
  ): Promise<PhaseResult> {
    const logger = getLogger();

    // Create progress bar for execution
    this.progressBar = new cliProgress.SingleBar({
      format:
        "Processing Jobs |{bar}| {percentage}% | {value}/{total} jobs | Rate: {rate} jobs/s | ETA: {eta}s",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
    this.progressBar.start(jobs.length, 0);

    // Start monitoring and worker tracking
    this.monitor.start();
    this.workerTracker.start(workerCount);
    this.connectWorkerTracker(taskManager);
    const startTime = Date.now();

    // Start progress tracking
    const progressInterval = this.startProgressTracking(jobs.length, startTime, taskManager);

    try {
      // Queue jobs more aggressively to keep workers busy
      const batchSize = Math.max(10, workerCount * 5); // Larger batches for better throughput
      let queuedCount = 0;
      let completedCount = 0;

      // Initial large batch to get workers started and keep them busy
      const initialBatch = Math.min(batchSize * 3, jobs.length);
      for (let i = 0; i < initialBatch; i++) {
        await taskManager.schedule(jobs[i]);
        queuedCount++;
      }

      // Continue queueing while monitoring completion
      while (completedCount < jobs.length) {
        // Check if we need to queue more jobs
        const stats = await taskManager.getQueueStats();
        completedCount = stats.completed;
        const pendingCount = stats.pending;

        // Queue more jobs if we're running low on pending jobs
        // Keep a larger buffer to ensure workers never run out of work
        if (pendingCount < workerCount * 10 && queuedCount < jobs.length) {
          const toQueue = Math.min(batchSize, jobs.length - queuedCount);
          for (let i = 0; i < toQueue; i++) {
            await taskManager.schedule(jobs[queuedCount]);
            queuedCount++;
          }
        }

        // Check for timeout
        if (Date.now() - startTime > timeout) {
          throw new Error(`Benchmark execution timed out after ${timeout}ms`);
        }

        // Shorter pause to be more responsive
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Suppress logging during execution to avoid interfering with progress bars
      // logger.info('EXECUTION', `All ${jobs.length} jobs completed successfully`);
    } catch (error) {
      logger.error(
        "EXECUTION",
        `Execution phase failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    // Stop progress tracking
    clearInterval(progressInterval);

    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }

    // Clean up worker event listeners
    try {
      const workerManager = (taskManager as any).jobScheduler?.workerManager;
      if (workerManager) {
        this.cleanupWorkerListeners(workerManager);
        // Suppress logging during execution to avoid interfering with progress bars
        // logger.info('EXECUTION', 'Worker event listeners cleaned up');
      }
    } catch (error) {
      logger.warn(
        "EXECUTION",
        `Failed to clean up worker listeners: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const duration = Date.now() - startTime;
    const measurements = this.monitor.stop();

    const cpuStats = PerformanceMonitor.calculateStats(measurements.cpu);
    const memoryStats = PerformanceMonitor.calculateStats(measurements.memory);

    logger.systemStats({
      phase: "queueing",
      duration,
      peakCPU: cpuStats.peak,
      peakMemory: memoryStats.peak,
      averageCPU: cpuStats.average,
      averageMemory: memoryStats.average,
    });

    return {
      duration,
      cpuUsage: measurements.cpu,
      memoryUsage: measurements.memory,
      peakCPU: cpuStats.peak,
      peakMemory: memoryStats.peak,
      averageCPU: cpuStats.average,
      averageMemory: memoryStats.average,
      workerStats: this.workerTracker.getStats(),
    };
  }

  /**
   * Measure execution phase performance
   */
  private async measureExecutionPhase(
    workerCount: number,
    totalJobs: number,
    timeout?: number,
    taskManager?: TaskManager,
  ): Promise<PhaseResult> {
    const logger = getLogger();

    // Create progress bar for execution
    this.progressBar = new cliProgress.SingleBar({
      format:
        "Executing Jobs |{bar}| {percentage}% | {value}/{total} jobs | Rate: {rate} jobs/s | ETA: {eta}s",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
    this.progressBar.start(totalJobs, 0);

    this.monitor.start(100); // Monitor every 100ms
    this.workerTracker.start(workerCount);
    this.connectWorkerTracker(taskManager);
    const startTime = Date.now();

    // Start progress tracking
    const progressInterval = this.startProgressTracking(totalJobs, startTime, taskManager);

    try {
      // Wait for all jobs to complete with enhanced timeout handling
      await this.waitForCompletion(totalJobs, timeout || 300000, taskManager);
    } catch (error) {
      logger.error(
        "EXECUTION",
        `Execution phase failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Log final stats for debugging
      try {
        const finalStats = await getQueueStats();
        logger.error("EXECUTION", `Final queue stats: ${JSON.stringify(finalStats)}`);
      } catch (statsError) {
        logger.error("EXECUTION", `Failed to get final stats: ${statsError}`);
      }

      throw error;
    }

    // Stop progress tracking
    clearInterval(progressInterval);

    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }

    // Clean up worker event listeners
    if (taskManager) {
      try {
        const workerManager = (taskManager as any).jobScheduler?.workerManager;
        if (workerManager) {
          this.cleanupWorkerListeners(workerManager);
          logger.info("EXECUTION", "Worker event listeners cleaned up");
        }
      } catch (error) {
        logger.warn(
          "EXECUTION",
          `Failed to clean up worker listeners: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const duration = Date.now() - startTime;
    const measurements = this.monitor.stop();

    const cpuStats = PerformanceMonitor.calculateStats(measurements.cpu);
    const memoryStats = PerformanceMonitor.calculateStats(measurements.memory);

    logger.systemStats({
      phase: "execution",
      duration,
      peakCPU: cpuStats.peak,
      peakMemory: memoryStats.peak,
      averageCPU: cpuStats.average,
      averageMemory: memoryStats.average,
      workerStats: this.workerTracker.getStats(),
    });

    return {
      duration,
      cpuUsage: measurements.cpu,
      memoryUsage: measurements.memory,
      peakCPU: cpuStats.peak,
      peakMemory: memoryStats.peak,
      averageCPU: cpuStats.average,
      averageMemory: memoryStats.average,
      workerStats: this.workerTracker.getStats(),
    };
  }

  /**
   * Start progress tracking for execution phase
   */
  private startProgressTracking(
    totalJobs: number,
    startTime: number,
    taskManager?: TaskManager,
  ): NodeJS.Timeout {
    const logger = getLogger();
    let lastCompletedCount = 0;
    let lastUpdateTime = startTime;

    return setInterval(async () => {
      try {
        const stats = taskManager ? await taskManager.getQueueStats() : await getQueueStats();
        const completedJobs = stats.completed;
        const currentTime = Date.now();

        // Update progress bar
        if (this.progressBar) {
          // Calculate rate
          const timeDiff = (currentTime - lastUpdateTime) / 1000; // seconds
          const jobsDiff = completedJobs - lastCompletedCount;
          const rate = timeDiff > 0 ? Math.round(jobsDiff / timeDiff) : 0;

          this.progressBar.update(completedJobs, { rate });
        }

        // Log progress every 1000 completed jobs
        if (completedJobs - lastCompletedCount >= 1000) {
          logger.debug("EXECUTION", `Completed ${completedJobs}/${totalJobs} jobs`);
        }

        lastCompletedCount = completedJobs;
        lastUpdateTime = currentTime;
      } catch (error) {
        logger.error("PROGRESS", "Error updating progress", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 250); // Update every 250ms
  }

  /**
   * Wait for job completion with enhanced monitoring and timeout handling
   */
  private async waitForCompletion(
    totalJobs: number,
    timeoutMs: number,
    taskManager?: TaskManager,
  ): Promise<void> {
    const logger = getLogger();
    const startTime = Date.now();
    let lastStatsTime = startTime;
    let lastCompletedCount = 0;
    let stuckJobsWarningCount = 0;

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          const currentTime = Date.now();
          const elapsed = currentTime - startTime;

          // Check if we've exceeded the timeout
          if (elapsed > timeoutMs) {
            clearInterval(checkInterval);

            // Get final stats for debugging
            try {
              const finalStats = taskManager
                ? await taskManager.getQueueStats()
                : await getQueueStats();
              logger.error(
                "TIMEOUT",
                `Benchmark timed out after ${timeoutMs}ms. Final stats: ${JSON.stringify(finalStats)}`,
              );
            } catch (statsError) {
              logger.error(
                "TIMEOUT",
                `Benchmark timed out and failed to get final stats: ${statsError}`,
              );
            }

            reject(new Error(`Benchmark execution timed out after ${timeoutMs}ms`));
            return;
          }

          // Check current stats
          const stats = taskManager ? await taskManager.getQueueStats() : await getQueueStats();
          const completedJobs = stats.completed;

          // Check if all jobs are completed
          if (completedJobs >= totalJobs) {
            clearInterval(checkInterval);
            logger.info("COMPLETION", `All ${totalJobs} jobs completed successfully`);
            resolve();
            return;
          }

          // Check for stuck jobs (no progress for 30 seconds)
          if (currentTime - lastStatsTime > 30000) {
            if (completedJobs === lastCompletedCount) {
              stuckJobsWarningCount++;
              logger.warn(
                "STUCK_JOBS",
                `No progress for 30s. Stats: ${JSON.stringify(stats)}. Warning #${stuckJobsWarningCount}`,
              );

              // If we've been stuck for too long, try to recover
              if (stuckJobsWarningCount >= 3) {
                logger.error(
                  "STUCK_JOBS",
                  `Jobs appear to be permanently stuck. Attempting recovery...`,
                );

                // Try to trigger job recovery if available
                try {
                  if (taskManager) {
                    // Access the job scheduler and its recovery service
                    const jobScheduler = (taskManager as any).jobScheduler;
                    if (jobScheduler && jobScheduler.jobRecoveryService) {
                      await jobScheduler.jobRecoveryService.triggerCheck();
                      logger.info("RECOVERY", "Job recovery triggered");
                    }
                  }
                } catch (recoveryError) {
                  logger.error("RECOVERY", `Job recovery failed: ${recoveryError}`);
                }

                stuckJobsWarningCount = 0; // Reset counter after recovery attempt
              }
            } else {
              stuckJobsWarningCount = 0; // Reset counter if progress was made
            }

            lastStatsTime = currentTime;
            lastCompletedCount = completedJobs;
          }
        } catch (error) {
          clearInterval(checkInterval);
          reject(
            new Error(
              `Error while waiting for completion: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }, 2000); // Check every 2 seconds
    });
  }
}

/**
 * Tracks worker-level job execution statistics
 */
class WorkerTracker {
  private workerStats = new Map<
    number,
    {
      jobsProcessed: number;
      totalExecutionTime: number;
      lastJobStart?: number;
      idleTime: number;
      lastIdleStart?: number;
    }
  >();
  private phaseStartTime = 0;

  /**
   * Start tracking for a new phase
   */
  start(workerCount: number): void {
    this.phaseStartTime = Date.now();
    this.workerStats.clear();

    // Initialize stats for all workers
    for (let i = 0; i < workerCount; i++) {
      this.workerStats.set(i, {
        jobsProcessed: 0,
        totalExecutionTime: 0,
        idleTime: 0,
        lastIdleStart: Date.now(),
      });
    }
  }

  /**
   * Record job start for a worker
   */
  jobStarted(workerId: number): void {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.lastJobStart = Date.now();
      if (stats.lastIdleStart) {
        stats.idleTime += Date.now() - stats.lastIdleStart;
        stats.lastIdleStart = undefined;
      }
    }
  }

  /**
   * Record job completion for a worker
   */
  jobCompleted(workerId: number): void {
    const stats = this.workerStats.get(workerId);
    if (stats && stats.lastJobStart) {
      const executionTime = Date.now() - stats.lastJobStart;
      stats.jobsProcessed++;
      stats.totalExecutionTime += executionTime;
      stats.lastJobStart = undefined;
      stats.lastIdleStart = Date.now();
    }
  }

  /**
   * Get final statistics for all workers
   */
  getStats(): WorkerStats[] {
    const phaseDuration = Date.now() - this.phaseStartTime;
    const results: WorkerStats[] = [];

    for (const [workerId, stats] of this.workerStats.entries()) {
      // Add final idle time if worker is currently idle
      let finalIdleTime = stats.idleTime;
      if (stats.lastIdleStart) {
        finalIdleTime += Date.now() - stats.lastIdleStart;
      }

      const averageJobTime =
        stats.jobsProcessed > 0 ? stats.totalExecutionTime / stats.jobsProcessed : 0;

      const utilizationPercentage =
        phaseDuration > 0 ? ((phaseDuration - finalIdleTime) / phaseDuration) * 100 : 0;

      results.push({
        workerId,
        jobsProcessed: stats.jobsProcessed,
        totalExecutionTime: stats.totalExecutionTime,
        averageJobTime,
        idleTime: finalIdleTime,
        utilizationPercentage,
      });
    }

    return results.sort((a, b) => a.workerId - b.workerId);
  }
}
