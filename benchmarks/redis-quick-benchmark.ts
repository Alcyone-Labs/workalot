#!/usr/bin/env bun
/**
 * Quick Redis benchmark - standalone script
 */

import { TaskManager } from "../src/index.js";
import { cpus } from "node:os";

const CORES = [2, 4, 6];
const JOB_COUNTS = [1000, 10000];

interface BenchmarkResult {
  cores: number;
  jobs: number;
  queueingTime: number;
  executionTime: number;
  totalTime: number;
  jobsPerSecond: number;
}

async function runBenchmark(cores: number, totalJobs: number): Promise<BenchmarkResult> {
  console.log(`\n🔥 Running: ${cores} cores, ${totalJobs} jobs`);

  const manager = new TaskManager({
    backend: "redis",
    databaseUrl: "redis://localhost:6379",
    maxThreads: cores,
    silent: true,
  });

  await manager.initialize();

  // Queueing phase
  const queueStart = Date.now();
  const jobPromises: Promise<any>[] = [];

  for (let i = 0; i < totalJobs; i++) {
    const promise = manager.schedule({
      jobFile: "examples/PingJob.ts",
      jobPayload: { iteration: i },
    });
    jobPromises.push(promise);
  }

  const queueEnd = Date.now();
  const queueingTime = queueEnd - queueStart;

  console.log(`  ⏱️  Queued ${totalJobs} jobs in ${queueingTime}ms`);

  // Execution phase
  const execStart = Date.now();
  await Promise.all(jobPromises);
  const execEnd = Date.now();
  const executionTime = execEnd - execStart;

  const totalTime = execEnd - queueStart;
  const jobsPerSecond = Math.round((totalJobs / totalTime) * 1000);

  console.log(`  ✅ Completed in ${totalTime}ms (${jobsPerSecond} jobs/sec)`);

  await manager.shutdown();

  return {
    cores,
    jobs: totalJobs,
    queueingTime,
    executionTime,
    totalTime,
    jobsPerSecond,
  };
}

async function main() {
  console.log("🚀 Redis Quick Benchmark");
  console.log(`📊 System: ${cpus().length} cores available`);
  console.log("");

  const results: BenchmarkResult[] = [];

  for (const jobCount of JOB_COUNTS) {
    for (const coreCount of CORES) {
      if (coreCount > cpus().length) {
        console.log(`⏭️  Skipping ${coreCount} cores (only ${cpus().length} available)`);
        continue;
      }

      try {
        const result = await runBenchmark(coreCount, jobCount);
        results.push(result);
      } catch (error) {
        console.error(`❌ Benchmark failed:`, error);
      }
    }
  }

  // Print summary
  console.log("\n\n📊 BENCHMARK SUMMARY");
  console.log("═".repeat(80));
  console.log("Cores | Jobs  | Queue Time | Exec Time | Total Time | Jobs/sec");
  console.log("─".repeat(80));

  for (const result of results) {
    console.log(
      `${result.cores.toString().padStart(5)} | ` +
        `${result.jobs.toString().padStart(5)} | ` +
        `${result.queueingTime.toString().padStart(10)}ms | ` +
        `${result.executionTime.toString().padStart(9)}ms | ` +
        `${result.totalTime.toString().padStart(10)}ms | ` +
        `${result.jobsPerSecond.toString().padStart(8)}`,
    );
  }

  console.log("═".repeat(80));

  // Find best performance
  const best = results.reduce((prev, curr) =>
    curr.jobsPerSecond > prev.jobsPerSecond ? curr : prev,
  );

  console.log(`\n🏆 Best: ${best.cores} cores, ${best.jobs} jobs → ${best.jobsPerSecond} jobs/sec`);
}

main().catch(console.error);
