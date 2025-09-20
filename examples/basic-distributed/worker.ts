/**
 * WebSocket Distributed System - Worker
 *
 * This example demonstrates how to set up a worker that connects to
 * an orchestrator via WebSocket and processes jobs.
 *
 * To run this example:
 * 1. First start the orchestrator: bun run examples/basic-distributed/orchestrator.ts
 * 2. Then start workers: bun run examples/basic-distributed/worker.ts
 * 3. Start multiple workers in different terminals for distributed processing
 */

import { CustomWorker } from "./CustomWorker.js";

async function main() {
  // Generate a unique worker ID (could be from environment variable in production)
  const workerId = parseInt(process.env.WORKER_ID || String(Math.floor(Math.random() * 1000)));

  console.log(`=== WebSocket Worker ${workerId} ===\n`);

  // Create the worker
  const worker = new CustomWorker({
    workerId,
    wsUrl: process.env.WS_URL || "ws://localhost:8080/worker",
    projectRoot: process.cwd(),
    defaultTimeout: 30000,
    silent: false,
  });

  // Set up event listeners
  worker.on("ready", () => {
    console.log(`✅ Worker ${workerId} is ready and connected to orchestrator`);
    console.log(`📍 Connected to: ${process.env.WS_URL || "ws://localhost:8080/worker"}`);
    console.log(`⏳ Waiting for jobs...\n`);
  });

  worker.on("job-completed", (result: any) => {
    console.log(`✅ Job completed successfully:`, {
      executionTime: `${result.executionTime}ms`,
    });
  });

  worker.on("job-failed", (result: any) => {
    console.log(`❌ Job failed:`, {
      error: result.results.error,
      executionTime: `${result.executionTime}ms`,
    });
  });

  // Start the worker
  try {
    await worker.start();

    // Log worker status periodically
    setInterval(() => {
      const status = worker.getStatus();
      console.log(`\n📊 Worker ${workerId} Status:`, {
        ready: status.ready,
        workerId: status.workerId,
        uptime: `${Math.floor(process.uptime())}s`,
      });
    }, 30000);

  } catch (error) {
    console.error("Failed to start worker:", error);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log(`\n\n🛑 Shutting down worker ${workerId}...`);
    await worker.stop();
    console.log(`✅ Worker ${workerId} stopped`);
    process.exit(0);
  });

  // Handle unexpected errors
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    worker.stop().then(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled rejection at:", promise, "reason:", reason);
    worker.stop().then(() => process.exit(1));
  });

  // Keep the process running
  console.log(`💡 Worker ${workerId} is running. Press Ctrl+C to stop.\n`);
}

// Run the worker
main().catch(console.error);