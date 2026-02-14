/**
 * TimescaleDB Example
 *
 * This example demonstrates how to use Workalot with TimescaleDB
 * for optimized time-series job processing with automatic compression
 * and retention policies.
 */

import { TaskManager } from "../../src/index.js";

async function main() {
  console.log("=== TimescaleDB Example ===\n");

  // TimescaleDB configuration
  const timescaleConfig = {
    backend: "postgresql" as const,
    // Connection string for TimescaleDB
    databaseUrl: "postgres://postgres:password@localhost:5432/workalot",

    // Enable TimescaleDB features in PostgreSQLQueue
    enableTimescaleDB: true,
    chunkTimeInterval: "1 hour",
    compressionInterval: "7 days",
    retentionInterval: "90 days",

    // Other settings
    maxThreads: 4,
    silent: false,
    // Disable WebSocket worker manager for direct execution
    wsPort: undefined,
  };

  console.log("🚀 Starting TimescaleDB task manager...");
  const manager = new TaskManager(timescaleConfig);
  await manager.initialize();

  console.log("📊 TimescaleDB Features Enabled:");
  console.log("  ✅ Hypertables: Automatic partitioning by time");
  console.log("  ✅ Compression: 70-90% storage reduction for old data");
  console.log("  ✅ Retention: Automatic cleanup of old data");
  console.log("  ✅ Time-based indexing: Optimized queries");

  // Schedule some jobs with timestamps
  console.log("\n📝 Scheduling time-series jobs...");

  const jobs: string[] = [];
  for (let i = 0; i < 10; i++) {
const jobPayload = {
        jobFile: "examples/TimeSeriesJob.ts",
        jobPayload: {
          id: i,
          timestamp: new Date(Date.now() - i * 3600000), // Each job 1 hour apart
          data: `Time-series data point ${i}`,
        },
      };

    const jobId = await manager.schedule(jobPayload);
    jobs.push(jobId);
    console.log(`  Scheduled job ${jobId} for ${jobPayload.jobPayload.timestamp.toISOString()}`);
  }

  // Show queue statistics
  console.log("\n📊 Queue Statistics:");
  const stats = await manager.getQueueStats();
  console.log(`  - Total jobs: ${stats.total}`);
  console.log(`  - Pending: ${stats.pending}`);
  console.log(`  - Processing: ${stats.processing}`);
  console.log(`  - Completed: ${stats.completed}`);
  console.log(`  - Failed: ${stats.failed}`);

  console.log("\n🗄️  TimescaleDB Benefits:");
  console.log("  • Automatic data partitioning by time windows");
  console.log("  • Compression reduces storage by 70-90% for historical data");
  console.log("  • Fast queries on recent data, efficient archival of old data");
  console.log("  • Configurable retention policies prevent unbounded growth");

  console.log("\n🔧 Configuration Tips:");
  console.log("  • chunkTimeInterval: Smaller chunks = better query performance but more overhead");
  console.log("  • compressionInterval: Compress data that's no longer actively queried");
  console.log("  • retentionInterval: Balance between data availability and storage costs");

  // Clean up
  await manager.shutdown();

  console.log("\n✨ TimescaleDB example complete!");
}

// Run the example
main().catch(console.error);