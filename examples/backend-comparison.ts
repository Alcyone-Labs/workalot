/**
 * Backend Comparison Example
 *
 * This example demonstrates the different queue backends available in Workalot
 * and compares their performance characteristics.
 */

import {
  createTaskManager,
  scheduleAndWaitWith,
  scheduleWith,
  destroyTaskManager,
  TaskManagerFactory,
} from "@alcyone-labs/workalot";

// Test job for benchmarking
class BenchmarkJob {
  async run(payload: { id: number; data: string }): Promise<any> {
    // Simulate some processing
    const start = Date.now();
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      sum += i * payload.id;
    }

    return {
      id: payload.id,
      processed: true,
      sum,
      processingTime: Date.now() - start,
    };
  }
}

interface BackendTest {
  name: string;
  config: any;
  description: string;
  pros: string[];
  cons: string[];
}

async function testBackend(test: BackendTest, numJobs: number = 100) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${test.name}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Description: ${test.description}\n`);

  console.log("Pros:");
  test.pros.forEach(pro => console.log(`  ✅ ${pro}`));

  console.log("\nCons:");
  test.cons.forEach(con => console.log(`  ⚠️  ${con}`));

  console.log("\nRunning benchmark...");

  try {
    // Create manager with specific backend
    const manager = await createTaskManager(test.name, test.config);

    // Generate test jobs
    const jobs = Array.from({ length: numJobs }, (_, i) => ({
      jobFile: "examples/backend-comparison.ts",
      jobPayload: {
        id: i,
        data: `Job ${i} - ${test.name}`,
      },
    }));

    // Measure scheduling time
    const scheduleStart = Date.now();
    const promises = jobs.map(job => scheduleWith(manager, job));
    const jobIds = await Promise.all(promises);
    const scheduleDuration = Date.now() - scheduleStart;

    console.log(`  📝 Scheduled ${numJobs} jobs in ${scheduleDuration}ms`);
    console.log(`     (${(numJobs / (scheduleDuration / 1000)).toFixed(2)} jobs/sec)`);

    // Wait for all jobs to complete
    const processingStart = Date.now();

    // Poll until all jobs are complete
    let completed = false;
    while (!completed) {
      const stats = await manager.getQueueStats();
      if (stats.pending === 0 && stats.processing === 0) {
        completed = true;
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const processingDuration = Date.now() - processingStart;

    console.log(`  ✅ Processed ${numJobs} jobs in ${processingDuration}ms`);
    console.log(`     (${(numJobs / (processingDuration / 1000)).toFixed(2)} jobs/sec)`);

    // Get final stats
    const finalStats = await manager.getQueueStats();
    console.log(`\n  Final Statistics:`);
    console.log(`    - Completed: ${finalStats.completed || numJobs}`);
    console.log(`    - Failed: ${finalStats.failed || 0}`);
    console.log(`    - Total time: ${scheduleDuration + processingDuration}ms`);
    console.log(`    - Overall throughput: ${(numJobs / ((scheduleDuration + processingDuration) / 1000)).toFixed(2)} jobs/sec`);

    // Clean up
    await destroyTaskManager(test.name);

    return {
      name: test.name,
      scheduleDuration,
      processingDuration,
      totalDuration: scheduleDuration + processingDuration,
      throughput: numJobs / ((scheduleDuration + processingDuration) / 1000),
    };

  } catch (error) {
    console.error(`  ❌ Error testing ${test.name}:`, error);
    return null;
  }
}

async function main() {
  console.log("=== Workalot Backend Comparison ===\n");

  const backends: BackendTest[] = [
    {
      name: "memory",
      config: {
        backend: "memory",
        maxThreads: 4,
        silent: true,
      },
      description: "In-memory queue with no persistence",
      pros: [
        "Blazing fast performance (100,000+ jobs/sec)",
        "Zero configuration required",
        "Minimal latency (microseconds)",
        "Perfect for testing and development",
        "No I/O overhead",
      ],
      cons: [
        "No persistence - data lost on restart",
        "Single process only",
        "Limited by available RAM",
        "Not suitable for production",
        "No advanced querying capabilities",
      ],
    },
    {
      name: "sqlite-memory",
      config: {
        backend: "sqlite",
        databaseUrl: "memory://",
        maxThreads: 4,
        silent: true,
      },
      description: "SQLite in-memory mode",
      pros: [
        "High performance (10,000-50,000 jobs/sec)",
        "SQL querying capabilities",
        "ACID compliance",
        "Good for testing with SQL features",
        "WAL mode for better concurrency",
      ],
      cons: [
        "No persistence in memory mode",
        "Single writer limitation",
        "Memory usage grows with queue size",
        "Single machine only",
      ],
    },
    {
      name: "sqlite-file",
      config: {
        backend: "sqlite",
        databaseUrl: "./benchmark-queue.db",
        maxThreads: 4,
        silent: true,
      },
      description: "SQLite with file-based persistence",
      pros: [
        "Good performance with persistence",
        "Automatic disk persistence",
        "Single file database (easy backup)",
        "Zero dependencies with Bun",
        "Production ready for single-server apps",
      ],
      cons: [
        "Slower than in-memory options",
        "File locking on network filesystems",
        "Performance degrades with large databases",
        "Single machine only",
      ],
    },
    {
      name: "pglite",
      config: {
        backend: "pglite",
        databaseUrl: "memory://",
        maxThreads: 4,
        silent: true,
      },
      description: "PostgreSQL-compatible WebAssembly database",
      pros: [
        "Full PostgreSQL compatibility",
        "Advanced SQL features (CTEs, window functions)",
        "Rich data types (JSON, arrays)",
        "No server required",
        "Good for PostgreSQL development/testing",
      ],
      cons: [
        "WebAssembly overhead (slower)",
        "Higher memory usage",
        "Slow startup time (1-2 seconds)",
        "Experimental status",
        "Limited ecosystem",
      ],
    },
  ];

  // Optional: Add PostgreSQL if connection string is provided
  if (process.env.DATABASE_URL) {
    backends.push({
      name: "postgresql",
      config: {
        backend: "postgresql",
        databaseUrl: process.env.DATABASE_URL,
        maxThreads: 4,
        silent: true,
      },
      description: "Full PostgreSQL database",
      pros: [
        "Enterprise features (replication, HA)",
        "Horizontal scalability",
        "LISTEN/NOTIFY for real-time",
        "Advanced monitoring tools",
        "Production proven",
      ],
      cons: [
        "Requires database server",
        "Network latency",
        "Complex setup and maintenance",
        "Higher infrastructure costs",
        "Overkill for simple needs",
      ],
    });
  }

  // Test different job counts to see scaling
  const jobCounts = [10, 100, 500];
  const results: any[] = [];

  for (const jobCount of jobCounts) {
    console.log(`\n${"#".repeat(60)}`);
    console.log(`TESTING WITH ${jobCount} JOBS`);
    console.log(`${"#".repeat(60)}`);

    for (const backend of backends) {
      const result = await testBackend(backend, jobCount);
      if (result) {
        results.push({
          ...result,
          jobCount,
        });
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary comparison
  console.log(`\n${"=".repeat(60)}`);
  console.log("PERFORMANCE SUMMARY");
  console.log(`${"=".repeat(60)}\n`);

  // Group results by job count
  for (const jobCount of jobCounts) {
    console.log(`\n📊 Results for ${jobCount} jobs:`);
    console.log("Backend".padEnd(20) + "Schedule (ms)".padEnd(15) + "Process (ms)".padEnd(15) + "Total (ms)".padEnd(15) + "Throughput (j/s)");
    console.log("-".repeat(80));

    const jobResults = results.filter(r => r.jobCount === jobCount);
    jobResults.sort((a, b) => b.throughput - a.throughput);

    for (const result of jobResults) {
      console.log(
        result.name.padEnd(20) +
        result.scheduleDuration.toString().padEnd(15) +
        result.processingDuration.toString().padEnd(15) +
        result.totalDuration.toString().padEnd(15) +
        result.throughput.toFixed(2)
      );
    }
  }

  // Recommendations
  console.log(`\n${"=".repeat(60)}`);
  console.log("RECOMMENDATIONS");
  console.log(`${"=".repeat(60)}\n`);

  console.log("🎯 Choose the right backend for your use case:\n");
  console.log("1. Development & Testing → Memory Backend");
  console.log("   Fast iteration, no setup required\n");

  console.log("2. Single Server Production → SQLite File");
  console.log("   Good balance of performance and persistence\n");

  console.log("3. Distributed System → PostgreSQL");
  console.log("   Horizontal scaling, enterprise features\n");

  console.log("4. PostgreSQL Compatibility Testing → PGLite");
  console.log("   Test PostgreSQL features without a server\n");

  console.log("5. Maximum Throughput → Memory Backend");
  console.log("   When persistence is not required\n");

  // Clean up SQLite file
  try {
    const fs = await import("fs/promises");
    await fs.unlink("./benchmark-queue.db").catch(() => {});
    await fs.unlink("./benchmark-queue.db-shm").catch(() => {});
    await fs.unlink("./benchmark-queue.db-wal").catch(() => {});
  } catch {
    // Ignore cleanup errors
  }

  console.log("\n✅ Backend comparison complete!");
}

// Run the comparison
main().catch(console.error);
