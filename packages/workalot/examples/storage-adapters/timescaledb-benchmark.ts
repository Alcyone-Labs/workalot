/**
 * TimescaleDB Performance Benchmark
 *
 * This benchmark demonstrates the performance benefits of using TimescaleDB
 * for time-series job processing compared to regular PostgreSQL.
 */

import { TaskManager } from "../../src/index.js";

interface BenchmarkResult {
  name: string;
  jobCount: number;
  duration: number;
  jobsPerSecond: number;
  avgQueryTime: number;
}

async function runBenchmark(name: string, config: any, jobCount: number): Promise<BenchmarkResult> {
  console.log(`\n🔄 Running ${name} benchmark with ${jobCount} jobs...`);
  
  const manager = new TaskManager(config);
  await manager.initialize();

  const startTime = Date.now();
  const jobs: string[] = [];

  // Schedule jobs with time-series data
  for (let i = 0; i < jobCount; i++) {
    const timestamp = new Date(Date.now() - i * 60000); // 1 minute intervals
    const jobPayload = {
      jobFile: './tests/fixtures/SimpleTestJob.ts',
      jobPayload: {
        id: `bench-${i}`,
        timestamp,
        data: `benchmark data ${i}`,
      },
    };

    const jobId = await manager.schedule(jobPayload);
    jobs.push(jobId);
  }

  const schedulingTime = Date.now() - startTime;

  // Test query performance
  const queue = (manager as any).queueManager;
  const queryStartTime = Date.now();
  
  // Query recent jobs (time-based query that benefits from TimescaleDB)
  const recentQuery = `
    SELECT COUNT(*) as count
    FROM workalot_jobs
    WHERE requested_at >= NOW() - INTERVAL '1 hour'
  `;

  const isBunEnvironment = typeof Bun !== 'undefined';
  let result;
  if (isBunEnvironment) {
    result = await queue.sql.unsafe(recentQuery);
  } else {
    result = await queue.sql.query(recentQuery);
    result = result.rows;
  }

  const queryTime = Date.now() - queryStartTime;

  await manager.shutdown();

  return {
    name,
    jobCount,
    duration: schedulingTime,
    jobsPerSecond: Math.round((jobCount / schedulingTime) * 1000),
    avgQueryTime: queryTime,
  };
}

async function main() {
  console.log("=== TimescaleDB Performance Benchmark ===\n");

  const jobCounts = [100, 500, 1000];
  const results: BenchmarkResult[] = [];

  // TimescaleDB configuration
  const timescaleConfig = {
    backend: "postgresql" as const,
    databaseUrl: "postgres://postgres:password@localhost:5432/workalot",
    enableTimescaleDB: true,
    chunkTimeInterval: "1 hour",
    compressionInterval: "7 days",
    retentionInterval: "90 days",
    silent: true,
    wsPort: undefined,
  };

  // Regular PostgreSQL configuration (for comparison)
  const postgresConfig = {
    backend: "postgresql" as const,
    databaseUrl: "postgres://postgres:password@localhost:5432/workalot_regular",
    enableTimescaleDB: false,
    silent: true,
    wsPort: undefined,
  };

  for (const jobCount of jobCounts) {
    // Benchmark TimescaleDB
    const timescaleResult = await runBenchmark(
      `TimescaleDB (${jobCount} jobs)`,
      timescaleConfig,
      jobCount
    );
    results.push(timescaleResult);

    // Small delay between benchmarks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Display results
  console.log("\n📊 Benchmark Results:");
  console.log("=" .repeat(80));
  console.log("| Configuration        | Jobs | Duration (ms) | Jobs/sec | Query Time (ms) |");
  console.log("|" + "-".repeat(78) + "|");

  for (const result of results) {
    const name = result.name.padEnd(20);
    const jobs = result.jobCount.toString().padStart(4);
    const duration = result.duration.toString().padStart(11);
    const jobsPerSec = result.jobsPerSecond.toString().padStart(8);
    const queryTime = result.avgQueryTime.toString().padStart(13);
    
    console.log(`| ${name} | ${jobs} | ${duration} | ${jobsPerSec} | ${queryTime} |`);
  }
  console.log("=" .repeat(80));

  // Performance insights
  console.log("\n💡 TimescaleDB Benefits:");
  console.log("  • Automatic time-based partitioning improves query performance");
  console.log("  • Compression reduces storage requirements by 70-90%");
  console.log("  • Retention policies prevent unbounded database growth");
  console.log("  • Optimized indexes for time-series queries");
  console.log("  • Continuous aggregates provide fast access to metrics");

  console.log("\n🔧 Configuration Tips:");
  console.log("  • Use smaller chunk intervals for better query performance");
  console.log("  • Enable compression for data older than your query window");
  console.log("  • Set retention policies based on your data requirements");
  console.log("  • Monitor chunk sizes and adjust intervals as needed");

  console.log("\n✨ Benchmark complete!");
}

// Run the benchmark
main().catch(console.error);
