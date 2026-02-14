/**
 * Manual test for PostgreSQL queue with postgres package
 * Run with: bun run tests/postgres-manual-test.ts
 * 
 * Prerequisites:
 * - Docker running
 * - Run: docker-compose up -d
 */

import { PostgreSQLQueue } from "../src/queue/PostgreSQLQueue.js";
import { JobStatus } from "../src/types/index.js";

async function testPostgreSQLQueue() {
  console.log("Testing PostgreSQL Queue with postgres package...\n");

  const queue = new PostgreSQLQueue({
    connectionString: "postgres://postgres:password@localhost:5432/workalot",
    tableName: "test_jobs",
    enableNotifications: false,
    enableTimescaleDB: false,
  });

  try {
    // Initialize
    console.log("1. Initializing queue...");
    await queue.initialize();
    console.log("✓ Queue initialized\n");

    // Add a job
    console.log("2. Adding a job...");
    const jobId = await queue.addJob({ task: "test", data: "hello world" });
    console.log(`✓ Job added with ID: ${jobId}\n`);

    // Get the job
    console.log("3. Fetching job...");
    const job = await queue.getJob(jobId);
    console.log("✓ Job fetched:", job);
    console.log();

    // Get next pending job (tests FOR UPDATE SKIP LOCKED)
    console.log("4. Getting next pending job (FOR UPDATE SKIP LOCKED)...");
    const nextJob = await queue.getNextPendingJob();
    console.log("✓ Next job:", nextJob);
    console.log();

    // Update job status
    console.log("5. Updating job status to completed...");
    await queue.updateJobStatus(
      jobId,
      JobStatus.COMPLETED,
      { success: true, message: "Test completed" }
    );
    console.log("✓ Job status updated\n");

    // Get stats
    console.log("6. Getting queue stats...");
    const stats = await queue.getStats();
    console.log("✓ Stats:", stats);
    console.log();

    // Test batch add
    console.log("7. Testing batch add (3 jobs)...");
    const batchIds = await queue.batchAddJobs([
      { payload: { task: "batch1" } },
      { payload: { task: "batch2" } },
      { payload: { task: "batch3" } },
    ]);
    console.log(`✓ Batch added: ${batchIds.length} jobs\n`);

    // Get pending jobs
    console.log("8. Getting pending jobs...");
    const pendingJobs = await queue.getJobsByStatus(JobStatus.PENDING);
    console.log(`✓ Found ${pendingJobs.length} pending jobs\n`);

    // Test FOR UPDATE SKIP LOCKED with concurrent access
    console.log("9. Testing concurrent job fetching (FOR UPDATE SKIP LOCKED)...");
    const [job1, job2, job3] = await Promise.all([
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
      queue.getNextPendingJob(),
    ]);
    console.log("✓ Concurrent fetch results:");
    console.log(`  - Job 1: ${job1?.id || "none"}`);
    console.log(`  - Job 2: ${job2?.id || "none"}`);
    console.log(`  - Job 3: ${job3?.id || "none"}`);
    console.log();

    // Verify no duplicate jobs were fetched
    const fetchedIds = [job1?.id, job2?.id, job3?.id].filter(Boolean);
    const uniqueIds = new Set(fetchedIds);
    if (fetchedIds.length === uniqueIds.size) {
      console.log("✓ No duplicate jobs fetched (FOR UPDATE SKIP LOCKED working!)\n");
    } else {
      console.error("✗ DUPLICATE JOBS DETECTED! FOR UPDATE SKIP LOCKED may not be working!\n");
    }

    console.log("✅ All tests passed!");

  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  } finally {
    // Cleanup
    console.log("\nCleaning up...");
    await queue.shutdown();
    console.log("✓ Queue shutdown complete");
  }
}

// Run the test
testPostgreSQLQueue().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

