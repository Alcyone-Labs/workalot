/**
 * Redis Queue Example
 *
 * This example demonstrates using Workalot with Redis as the backend.
 * Redis provides excellent performance and atomic operations for job queues.
 *
 * Prerequisites:
 * - Redis server running (local or remote)
 * - For local: docker run -d -p 6379:6379 redis:alpine
 * - For Upstash (Cloudflare-compatible): https://upstash.com/
 */

import { TaskManager } from "#/index.js";

async function main() {
  console.log("Redis Queue Example\n");

  // Initialize TaskManager with Redis backend
  const taskManager = new TaskManager({
    backend: "redis",
    databaseUrl: process.env.REDIS_URL || "redis://localhost:6379",
    maxThreads: 4,
    silent: false,
  });

  await taskManager.initialize();
  console.log("✓ TaskManager initialized with Redis backend\n");

  // Schedule some jobs
  console.log("Scheduling jobs...");
  const results = await Promise.all([
    taskManager.scheduleAndWait({
      jobFile: "examples/_jobs/PingJob.ts",
      jobPayload: { message: "Job 1" },
    }),
    taskManager.scheduleAndWait({
      jobFile: "examples/_jobs/PingJob.ts",
      jobPayload: { message: "Job 2" },
    }),
    taskManager.scheduleAndWait({
      jobFile: "examples/_jobs/PingJob.ts",
      jobPayload: { message: "Job 3" },
    }),
  ]);

  console.log(`✓ Completed ${results.length} jobs\n`);

  // Display results
  for (let i = 0; i < results.length; i++) {
    console.log(`  - Job ${i + 1}: ${JSON.stringify(results[i].results)}`);
  }

  // Get stats
  const stats = await taskManager.getQueueStats();
  console.log("\nQueue Statistics:");
  console.log(`  Total: ${stats.total}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Processing: ${stats.processing}`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed: ${stats.failed}`);

  // Cleanup
  console.log("\nShutting down...");
  await taskManager.shutdown();
  console.log("✓ Shutdown complete");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
