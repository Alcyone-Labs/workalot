/**
 * Manual test for Redis queue
 * Run with: bun run tests/redis-manual-test.ts
 *
 * Prerequisites:
 * - Redis running locally or via Docker
 * - Run: docker run -d -p 6379:6379 redis:alpine
 */

import { RedisQueue } from "../src/queue/RedisQueue.js";
import { JobStatus } from "../src/types/index.js";

async function testRedisQueue() {
  console.log("Testing Redis Queue...\n");

  const queue = new RedisQueue({
    redisUrl: "redis://localhost:6379",
    keyPrefix: "test-workalot",
    debug: true,
    completedJobTTL: 60, // 1 minute for testing
    failedJobTTL: 120, // 2 minutes for testing
  });

  try {
    // Clear any existing test data
    console.log("0. Clearing test data...");
    await queue.initialize();
    await queue.clear();
    console.log("✓ Test data cleared\n");

    // Initialize
    console.log("1. Initializing queue...");
    await queue.initialize();
    console.log("✓ Queue initialized\n");

    // Add a job
    console.log("2. Adding a job...");
    const jobId = await queue.addJob({
      jobFile: "test.js",
      jobPayload: { task: "test", data: "hello world" },
    });
    console.log(`✓ Job added with ID: ${jobId}\n`);

    // Get the job
    console.log("3. Fetching job...");
    const job = await queue.getJob(jobId);
    console.log("✓ Job fetched:", job);
    console.log();

    // Get stats
    console.log("4. Getting queue stats...");
    let stats = await queue.getStats();
    console.log("✓ Stats:", stats);
    console.log();

    // Get next pending job (tests atomic claiming with Lua script)
    console.log("5. Getting next pending job (atomic Lua script)...");
    const nextJob = await queue.getNextPendingJob();
    console.log("✓ Next job:", nextJob);
    console.log();

    // Verify stats updated
    console.log("6. Verifying stats after claiming job...");
    stats = await queue.getStats();
    console.log("✓ Stats:", stats);
    console.log(`  - Pending: ${stats.pending} (should be 0)`);
    console.log(`  - Processing: ${stats.processing} (should be 1)`);
    console.log();

    // Update job status to completed
    console.log("7. Updating job status to completed...");
    await queue.updateJobStatus(jobId, JobStatus.COMPLETED, {
      results: { success: true, message: "Test completed" },
      executionTime: 100,
      queueTime: 50,
    });
    console.log("✓ Job status updated\n");

    // Verify stats after completion
    console.log("8. Verifying stats after completion...");
    stats = await queue.getStats();
    console.log("✓ Stats:", stats);
    console.log(`  - Processing: ${stats.processing} (should be 0)`);
    console.log(`  - Completed: ${stats.completed} (should be 1)`);
    console.log();

    // Test batch add
    console.log("9. Testing batch add (5 jobs)...");
    const batchIds = await queue.batchAddJobs([
      { payload: { jobFile: "batch1.js", jobPayload: { task: "batch1" } } },
      { payload: { jobFile: "batch2.js", jobPayload: { task: "batch2" } } },
      { payload: { jobFile: "batch3.js", jobPayload: { task: "batch3" } } },
      { payload: { jobFile: "batch4.js", jobPayload: { task: "batch4" } } },
      { payload: { jobFile: "batch5.js", jobPayload: { task: "batch5" } } },
    ]);
    console.log(`✓ Batch added: ${batchIds.length} jobs\n`);

    // Get pending jobs
    console.log("10. Getting pending jobs...");
    const pendingJobs = await queue.getJobsByStatus(JobStatus.PENDING);
    console.log(`✓ Found ${pendingJobs.length} pending jobs\n`);

    // Test concurrent job claiming (atomic Lua script prevents race conditions)
    console.log("11. Testing concurrent job claiming (Lua script atomicity)...");
    const [job1, job2, job3, job4, job5] = await Promise.all([
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
    ]);
    console.log("✓ Concurrent fetch results:");
    console.log(`  - Job 1: ${job1?.id || "none"}`);
    console.log(`  - Job 2: ${job2?.id || "none"}`);
    console.log(`  - Job 3: ${job3?.id || "none"}`);
    console.log(`  - Job 4: ${job4?.id || "none"}`);
    console.log(`  - Job 5: ${job5?.id || "none"}`);
    console.log();

    // Verify no duplicate jobs were fetched
    const fetchedIds = [job1?.id, job2?.id, job3?.id, job4?.id, job5?.id].filter(Boolean);
    const uniqueIds = new Set(fetchedIds);
    if (fetchedIds.length === uniqueIds.size) {
      console.log("✓ No duplicate jobs fetched (Lua script atomicity working!)\n");
    } else {
      console.error("✗ DUPLICATE JOBS DETECTED! Lua script may not be working!\n");
    }

    // Test stalled job recovery
    console.log("12. Testing stalled job recovery...");
    // Manually mark a job as stalled by setting old start time
    const redis = queue.getRedisClient();
    const stalledJobId = batchIds[0];
    const oldTime = Date.now() - 400000; // 400 seconds ago
    await redis.hset(`test-workalot:queue:processing`, stalledJobId, `999:${oldTime}`);
    await redis.hset(`test-workalot:jobs:${stalledJobId}`, {
      status: JobStatus.PROCESSING,
      workerId: 999,
      startedAt: oldTime,
    });

    const stalledJobs = await queue.getStalledJobs(300000); // 5 minutes
    console.log(`✓ Found ${stalledJobs.length} stalled job(s)`);

    const recoveredCount = await queue.recoverStalledJobs(300000);
    console.log(`✓ Recovered ${recoveredCount} stalled job(s)\n`);

    // Final stats
    console.log("13. Final queue stats...");
    stats = await queue.getStats();
    console.log("✓ Final stats:", stats);
    console.log();

    // Test cleanup
    console.log("14. Testing cleanup...");
    const cleanedCount = await queue.cleanup();
    console.log(`✓ Cleaned up ${cleanedCount} old jobs\n`);

    console.log("✅ All tests passed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  } finally {
    // Cleanup
    console.log("\nCleaning up...");
    await queue.clear();
    await queue.shutdown();
    console.log("✓ Queue shutdown complete");
  }
}

// Run the test
testRedisQueue().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
