/**
 * WebSocket Distributed System - Orchestrator
 *
 * This example demonstrates how to set up an orchestrator that manages
 * distributed workers via WebSocket connections.
 *
 * To run this example:
 * 1. Start the orchestrator: bun run examples/basic-distributed/orchestrator.ts
 * 2. Start workers in separate terminals: bun run examples/basic-distributed/worker.ts
 */

import { SimpleOrchestrator } from "../../dist/src/orchestration/SimpleOrchestrator.js";

async function main() {
  console.log("=== WebSocket Orchestrator Example ===\n");

  // Create orchestrator with SQLite backend for persistence
  const orchestrator = new SimpleOrchestrator({
    wsPort: 8080,
    wsHostname: "localhost",
    distributionStrategy: "round-robin",
    queueConfig: {
      backend: "sqlite",
      databaseUrl: "./orchestrator-queue.db",
    },
  });

  // Start the orchestrator
  await orchestrator.start();
  console.log("✅ Orchestrator started on ws://localhost:8080");
  console.log("Waiting for workers to connect...\n");

  // Set up event listeners
  orchestrator.on("worker-connected", (workerId: number) => {
    console.log(`🔗 Worker ${workerId} connected`);
    console.log(`   Total workers: ${orchestrator.getWorkerCount()}`);
  });

  orchestrator.on("worker-disconnected", (workerId: number) => {
    console.log(`🔌 Worker ${workerId} disconnected`);
    console.log(`   Remaining workers: ${orchestrator.getWorkerCount()}`);
  });

  orchestrator.on("job-added", (jobId: string) => {
    console.log(`📥 Job ${jobId} added to queue`);
  });

  orchestrator.on("job-assigned", (workerId: number, jobId: string) => {
    console.log(`📤 Job ${jobId} assigned to worker ${workerId}`);
  });

  orchestrator.on("job-completed", (result: any) => {
    console.log(`✅ Job completed:`, result);
  });

  orchestrator.on("job-failed", (result: any) => {
    console.log(`❌ Job failed:`, result);
  });

  // Add some example jobs after a delay to allow workers to connect
  setTimeout(async () => {
    console.log("\n=== Adding Jobs to Queue ===\n");

    // Add various types of jobs
    const jobs = [
      // Math calculation jobs
      ...Array.from({ length: 5 }, (_, i) => ({
        jobFile: "./worker.js",
        jobPayload: {
          type: "MathJob",
          payload: {
            data: Array.from({ length: 10 }, () => Math.floor(Math.random() * 100)),
            operation: ["sum", "average", "max"][i % 3],
          },
        },
      })),

      // Data processing jobs
      ...Array.from({ length: 3 }, (_, i) => ({
        jobFile: "./worker.js",
        jobPayload: {
          type: "DataProcessor",
          payload: {
            dataset: `dataset-${i}`,
            transform: "normalize",
          },
        },
      })),

      // Notification jobs
      ...Array.from({ length: 2 }, () => ({
        jobFile: "./worker.js",
        jobPayload: {
          type: "Notification",
          payload: {
            message: "Hello from orchestrator!",
            channel: "email",
          },
        },
      })),
    ];

    // Schedule all jobs
    for (const job of jobs) {
      const jobId = await orchestrator.addJob(job);
      console.log(`Scheduled job: ${jobId}`);

      // Small delay between job submissions
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Monitor queue statistics
    setInterval(async () => {
      const stats = await orchestrator.getQueueStats();
      const workerStats = orchestrator.getWorkerStats();

      console.log("\n📊 Queue Statistics:");
      console.log(`   Pending: ${stats.pending}`);
      console.log(`   Processing: ${stats.processing}`);
      console.log(`   Completed: ${stats.completed}`);
      console.log(`   Failed: ${stats.failed}`);

      console.log("\n👷 Worker Statistics:");
      console.log(`   Total Workers: ${workerStats.totalWorkers}`);
      console.log(`   Available: ${workerStats.availableWorkers}`);
      console.log(`   Busy: ${workerStats.busyWorkers}`);

      if (workerStats.workers.length > 0) {
        console.log("\n   Worker Details:");
        for (const worker of workerStats.workers) {
          console.log(`   - Worker ${worker.id}: ${worker.busy ? "busy" : "idle"} (${worker.jobsProcessed} jobs processed)`);
        }
      }
    }, 5000);

  }, 3000);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\n🛑 Shutting down orchestrator...");
    await orchestrator.stop();
    console.log("✅ Orchestrator stopped");
    process.exit(0);
  });

  // Keep the process running
  console.log("\n💡 Press Ctrl+C to stop the orchestrator\n");
}

// Run the orchestrator
main().catch(console.error);
