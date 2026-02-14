#!/usr/bin/env bun

/**
 * SQLite Backend Example
 *
 * Demonstrates the high-performance SQLite backend with both in-memory
 * and file-based persistence options. Shows runtime-optimized driver
 * selection (Bun's native SQLite vs better-sqlite3).
 */

import {
  initializeTaskManager,
  scheduleAndWait,
  getQueueStats,
  shutdown,
} from "#/index.js";
import { BaseJob } from "#/jobs/BaseJob.js";

// Simple job for demonstration
export class GreetingJob extends BaseJob {
  constructor() {
    super("GreetingJob");
  }

  async run(payload: {
    name: string;
    language: string;
  }): Promise<Record<string, any>> {
    this.validatePayload(payload, ["name", "language"]);

    const greetings = {
      en: "Hello",
      es: "Hola",
      fr: "Bonjour",
      de: "Hallo",
      it: "Ciao",
    };

    const greeting =
      greetings[payload.language as keyof typeof greetings] || greetings.en;

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 10));

    return this.createSuccessResult({
      message: `${greeting}, ${payload.name}!`,
      language: payload.language,
      timestamp: new Date().toISOString(),
    });
  }
}

async function demonstrateSQLiteBackend() {
  console.log("🗄️  SQLite Backend Demonstration\n");

  // 1. In-Memory SQLite (Recommended for most use cases)
  console.log("1️⃣  Testing In-Memory SQLite Backend...");

  await initializeTaskManager({
    backend: "sqlite",
    databaseUrl: "memory://", // In-memory database
    maxThreads: 4,
    silent: true, // Reduce noise for demo
  });

  console.log("✅ SQLite in-memory backend initialized");

  // Schedule multiple jobs
  const jobs = [
    { name: "Alice", language: "en" },
    { name: "Bob", language: "es" },
    { name: "Charlie", language: "fr" },
    { name: "Diana", language: "de" },
    { name: "Eva", language: "it" },
  ];

  console.log(`📋 Scheduling ${jobs.length} greeting jobs...`);

  const startTime = Date.now();
  const results = await Promise.all(
    jobs.map((job) =>
      scheduleAndWait({
        jobFile: "examples/storage-adapters/sqlite-backend.ts",
        jobPayload: job,
      })
    )
  );

  const duration = Date.now() - startTime;
  console.log(`⚡ Completed ${jobs.length} jobs in ${duration}ms`);
  console.log(
    `📊 Throughput: ${Math.round(jobs.length / (duration / 1000))} jobs/sec`
  );

  // Show results
  console.log("\n📝 Job Results:");
  results.forEach((result: any, index: number) => {
    console.log(
      `   ${index + 1}. ${result.results.data.message} (${
        result.executionTime
      }ms)`
    );
  });

  // Show queue statistics
  const stats = await getQueueStats();
  console.log("\n📈 Queue Statistics:");
  console.log(
    `   Total: ${stats.total}, Completed: ${stats.completed}, Failed: ${stats.failed}`
  );

  await shutdown();
  console.log("✅ In-memory SQLite backend shutdown complete\n");

  // 2. File-Based SQLite (For persistence)
  console.log("2️⃣  Testing File-Based SQLite Backend...");

  await initializeTaskManager({
    backend: "sqlite",
    databaseUrl: "./examples/demo-queue.db", // File-based database
    maxThreads: 2,
    silent: true,
  });

  console.log("✅ SQLite file-based backend initialized");

  // Schedule a few more jobs to demonstrate persistence
  const persistentJobs = [
    { name: "Frank", language: "en" },
    { name: "Grace", language: "es" },
  ];

  console.log(
    `💾 Scheduling ${persistentJobs.length} jobs with persistence...`
  );

  const persistentResults = await Promise.all(
    persistentJobs.map((job) =>
      scheduleAndWait({
        jobFile: "examples/storage-adapters/sqlite-backend.ts",
        jobPayload: job,
      })
    )
  );

  console.log("📝 Persistent Job Results:");
  persistentResults.forEach((result: any, index: number) => {
    console.log(
      `   ${index + 1}. ${result.results.data.message} (${
        result.executionTime
      }ms)`
    );
  });

  const finalStats = await getQueueStats();
  console.log("\n📈 Final Queue Statistics:");
  console.log(
    `   Total: ${finalStats.total}, Completed: ${finalStats.completed}`
  );

  await shutdown();
  console.log("✅ File-based SQLite backend shutdown complete");

  console.log("\n🎉 SQLite Backend Demonstration Complete!");
  console.log("\n💡 Key Benefits:");
  console.log(
    "   • Runtime-optimized drivers (Bun native SQLite + better-sqlite3 fallback)"
  );
  console.log("   • High performance with both in-memory and file persistence");
  console.log("   • Full SQL features with indexes and transactions");
  console.log("   • Cross-platform compatibility (Bun, Node.js, Deno)");
  console.log("   • Zero configuration required");
}

// Export the job class for the worker to use (already exported above)
export default GreetingJob;

// Run the demonstration
if ((import.meta as any).main || process.argv[1]?.includes("sqlite-backend")) {
  demonstrateSQLiteBackend().catch(console.error);
}
