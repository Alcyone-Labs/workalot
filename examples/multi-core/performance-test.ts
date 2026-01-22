#!/usr/bin/env bun
/**
 * Performance Testing Example for @alcyone-labs/workalot
 *
 * This example demonstrates how to benchmark the job queue system
 * and measure performance across different configurations.
 */

import { TaskManager } from "../../src/index.js";
import { BaseJob } from "../../src/jobs/index.js";

// Simple CPU-intensive job for performance testing
export default class PerformanceTestJob extends BaseJob {
  async run(payload: { iterations: number; jobIndex: number }) {
    this.validatePayload(payload, ["iterations", "jobIndex"]);

    const { iterations, jobIndex } = payload;

    // Simulate CPU work
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i * jobIndex);
    }

    return this.createSuccessResult({
      jobIndex,
      iterations,
      result: Math.floor(result),
      completedAt: Date.now(),
    });
  }
}

async function performanceTest() {
  console.log("Workalot Performance Test\n");

  // Test configurations with different backends
  const configs = [
    { cores: 2, jobs: 1000, name: "2-cores-1k-jobs", backend: "memory" as const },
    { cores: 4, jobs: 1000, name: "4-cores-1k-jobs", backend: "memory" as const },
    { cores: 6, jobs: 1000, name: "6-cores-1k-jobs", backend: "memory" as const },
  ];

  for (const config of configs) {
    console.log(`\n[${configs.indexOf(config) + 1}/${configs.length}] Running: ${config.name}`);
    console.log(`Configuration: ${config.cores} cores, ${config.jobs} jobs\n`);

    const taskManager = new TaskManager({
      backend: config.backend,
      maxThreads: config.cores,
      silent: true,
    });

    await taskManager.initialize();

    // Measure job queueing time
    console.log("📝 Queueing jobs...");
    const queueStartTime = Date.now();

    const jobPromises = [];
    for (let i = 0; i < config.jobs; i++) {
      jobPromises.push(
        taskManager.scheduleAndWait({
          jobFile: "examples/multi-core/performance-test.ts",
          jobPayload: {
            iterations: 1000, // Light CPU work
            jobIndex: i,
          },
        }),
      );
    }

    const queueTime = Date.now() - queueStartTime;
    console.log(`✅ Queued ${config.jobs} jobs in ${queueTime}ms\n`);

    // Measure execution time
    console.log("⚡ Executing jobs...");
    const executionStartTime = Date.now();

    const results = await Promise.all(jobPromises);

    const executionTime = Date.now() - executionStartTime;
    const totalTime = queueTime + executionTime;

    // Calculate performance metrics
    const throughput = Math.round((config.jobs / totalTime) * 1000);
    const avgExecutionTime =
      results.reduce((sum: number, r: any) => sum + r.executionTime, 0) / results.length;

    // Get final system status
    const status = await taskManager.getStatus();

    // Display results
    console.log("📊 Performance Results:");
    console.log(`   ⏱️  Total time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`   🚀 Throughput: ${throughput.toFixed(0)} jobs/sec`);
    console.log(`   📝 Queueing: ${queueTime}ms`);
    console.log(`   ⚡ Execution: ${executionTime}ms`);
    console.log(`   📈 Avg job time: ${avgExecutionTime.toFixed(2)}ms`);
    console.log(`   👥 Job distribution: ${status.workers.distribution.join(":")}`);

    // Calculate scaling efficiency
    if (configs.indexOf(config) > 0) {
      const baseConfig = configs[0];
      const expectedThroughput = (throughput / config.cores) * baseConfig.cores;
      const actualThroughput = throughput;
      const efficiency = (actualThroughput / expectedThroughput) * 100;
      console.log(`   📊 Scaling efficiency: ${efficiency.toFixed(1)}%`);
    }

    await taskManager.shutdown();

    // Cool down between tests
    if (configs.indexOf(config) < configs.length - 1) {
      console.log("\n⏳ Cooling down for 2 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log("\n🎉 Performance test completed!");
  console.log("\nPerformance Tips:");
  console.log("- Use memory backend for maximum throughput");
  console.log("- Scale worker count with CPU cores for linear performance");
  console.log("- Monitor worker utilization for optimal efficiency");
  console.log("- Batch job submission for reduced overhead on large workloads");
}

/**
 * Comprehensive backend comparison test
 */
async function backendComparison() {
  console.log("\n" + "=".repeat(70));
  console.log("BACKEND PERFORMANCE COMPARISON");
  console.log("=".repeat(70));
  console.log("Testing different backend configurations with identical workloads\n");

  const jobCount = 500;
  const cores = 4;

  // Backend configurations to test
  const backends = [
    {
      name: "Memory (Pure In-Memory)",
      config: {
        backend: "memory" as const,
        maxThreads: cores,
        silent: true,
      },
      description: "Fastest option, no persistence",
    },
    {
      name: "Memory + JSON Persistence",
      config: {
        backend: "memory" as const,
        maxThreads: cores,
        persistenceFile: "benchmark-queue-state.json",
        silent: true,
      },
      description: "Memory speed with JSON file backup",
    },
    {
      name: "PGLite In-Memory",
      config: {
        backend: "pglite" as const,
        databaseUrl: "memory://",
        maxThreads: cores,
        silent: true,
      },
      description: "PostgreSQL features with memory performance",
    },
    {
      name: "PGLite File-Based",
      config: {
        backend: "pglite" as const,
        databaseUrl: "./benchmark-queue.db",
        maxThreads: cores,
        silent: true,
      },
      description: "Full persistence with PostgreSQL features",
    },
  ];

  const results: Array<{
    name: string;
    description: string;
    duration: number;
    throughput: number;
    avgJobTime: number;
  }> = [];

  for (const backend of backends) {
    console.log(`Testing: ${backend.name}`);
    console.log(`Description: ${backend.description}`);

    try {
      const taskManager = new TaskManager(backend.config);
      await taskManager.initialize();

      // Warm up
      await taskManager.scheduleAndWait({
        jobFile: "examples/multi-core/performance-test.ts",
        jobPayload: { iterations: 1000, jobIndex: 0, timestamp: Date.now(), random: Math.random() },
      });

      // Actual benchmark
      const startTime = Date.now();

      const jobs = Array.from({ length: jobCount }, (_, i) =>
        taskManager.scheduleAndWait({
          jobFile: "examples/multi-core/performance-test.ts",
          jobPayload: {
            iterations: 1000,
            jobIndex: i,
            timestamp: Date.now(),
            random: Math.random(),
          },
        }),
      );

      await Promise.all(jobs);

      const endTime = Date.now();
      const duration = endTime - startTime;
      const throughput = Math.round((jobCount / duration) * 1000);
      const avgJobTime = Number((duration / jobCount).toFixed(2));

      results.push({
        name: backend.name,
        description: backend.description,
        duration,
        throughput,
        avgJobTime,
      });

      console.log(`  Duration: ${duration}ms`);
      console.log(`  Throughput: ${throughput} jobs/sec`);
      console.log(`  Avg job time: ${avgJobTime}ms\n`);

      await taskManager.shutdown();
    } catch (error) {
      console.log(`  ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  // Summary table
  console.log("SUMMARY COMPARISON");
  console.log("=".repeat(70));
  console.log("Backend".padEnd(25) + "Throughput".padEnd(15) + "Avg Time".padEnd(12) + "Use Case");
  console.log("-".repeat(70));

  results.forEach((result) => {
    const throughputStr = `${result.throughput} jobs/sec`;
    const avgTimeStr = `${result.avgJobTime}ms`;
    console.log(
      result.name.padEnd(25) +
        throughputStr.padEnd(15) +
        avgTimeStr.padEnd(12) +
        result.description,
    );
  });

  console.log("\nRECOMMENDATIONS:");
  console.log("- Memory: Best for temporary, high-speed processing");
  console.log("- Memory + JSON: Good balance of speed and basic persistence");
  console.log("- PGLite In-Memory: Best for SQL features without file I/O");
  console.log("- PGLite File: Best for full persistence with SQL capabilities");
}

// Run the performance test
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  const args = process.argv.slice(2);

  if (args.includes("--backends") || args.includes("-b")) {
    backendComparison().catch(console.error);
  } else if (args.includes("--all") || args.includes("-a")) {
    performanceTest()
      .then(() => backendComparison())
      .catch(console.error);
  } else {
    performanceTest().catch(console.error);
  }
}
