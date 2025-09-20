/**
 * Factory Pattern Example
 *
 * This example demonstrates the factory pattern for better testability
 * and support for multiple TaskManager instances.
 */

import {
  TaskManagerFactory,
  TaskManagerFactoryPresets,
  createTaskManager,
  scheduleAndWaitWith,
  destroyTaskManager,
  getAllTaskManagerStats,
} from "@alcyone-labs/workalot";

// Example job for demonstration
class ProcessDataJob {
  async run(payload: { data: number[]; operation: string }) {
    console.log(`Processing ${payload.data.length} items with operation: ${payload.operation}`);

    let result: number;
    switch (payload.operation) {
      case "sum":
        result = payload.data.reduce((a, b) => a + b, 0);
        break;
      case "average":
        result = payload.data.reduce((a, b) => a + b, 0) / payload.data.length;
        break;
      case "max":
        result = Math.max(...payload.data);
        break;
      default:
        throw new Error(`Unknown operation: ${payload.operation}`);
    }

    return { result, processedAt: new Date().toISOString() };
  }
}

async function main() {
  console.log("=== Factory Pattern Example ===\n");

  // Method 1: Using the default factory with createTaskManager
  console.log("1. Using default factory:");
  const mainManager = await createTaskManager("main", {
    backend: "memory",
    maxThreads: 2,
  });

  const result1 = await scheduleAndWaitWith(mainManager, {
    jobFile: "examples/MathJob.ts",
    jobPayload: { data: [1, 2, 3, 4, 5], operation: "sum" },
  });
  console.log("Result from main manager:", result1);

  // Method 2: Creating a custom factory
  console.log("\n2. Using custom factory:");
  const factory = new TaskManagerFactory({
    backend: "sqlite",
    databaseUrl: "memory://",
    silent: true,
  });

  // Create multiple instances with the same factory
  const analyticsManager = await factory.create("analytics");
  const notificationManager = await factory.create("notifications");

  // Use different managers for different purposes
  const analyticsResult = await scheduleAndWaitWith(analyticsManager, {
    jobFile: "examples/MathJob.ts",
    jobPayload: { data: [10, 20, 30], operation: "average" },
  });
  console.log("Analytics result:", analyticsResult);

  const notificationResult = await scheduleAndWaitWith(notificationManager, {
    jobFile: "examples/PingJob.ts",
    jobPayload: { message: "Hello from notifications!" },
  });
  console.log("Notification result:", notificationResult);

  // Method 3: Using factory presets
  console.log("\n3. Using factory presets:");

  // Development preset - optimized for fast iteration
  const devFactory = TaskManagerFactoryPresets.development();
  const devManager = await devFactory.create("dev");

  const devResult = await scheduleAndWaitWith(devManager, {
    jobFile: "examples/MathJob.ts",
    jobPayload: { data: [100, 200, 300], operation: "max" },
  });
  console.log("Development result:", devResult);

  // High performance preset - optimized for throughput
  const perfFactory = TaskManagerFactoryPresets.highPerformance();
  const perfManager = await perfFactory.create("performance");

  // Schedule many jobs for performance testing
  console.log("\n4. High performance batch processing:");
  const jobs = Array.from({ length: 100 }, (_, i) => ({
    jobFile: "examples/MathJob.ts",
    jobPayload: { data: [i, i + 1, i + 2], operation: "sum" },
  }));

  const startTime = Date.now();
  const promises = jobs.map(job => scheduleAndWaitWith(perfManager, job));
  await Promise.all(promises);
  const duration = Date.now() - startTime;

  console.log(`Processed ${jobs.length} jobs in ${duration}ms`);
  console.log(`Throughput: ${(jobs.length / (duration / 1000)).toFixed(2)} jobs/sec`);

  // Get statistics for all instances
  console.log("\n5. Instance statistics:");
  const stats = await getAllTaskManagerStats();

  for (const [name, instanceStats] of Object.entries(stats)) {
    console.log(`\n${name}:`);
    console.log(`  Created: ${instanceStats.createdAt}`);
    console.log(`  Backend: ${instanceStats.config.backend}`);
    console.log(`  Queue Stats:`, instanceStats.queueStats);
  }

  // Method 4: Scoped factories for different environments
  console.log("\n6. Scoped factories:");

  // Create a scope for testing with specific defaults
  const testScope = factory.createScope({
    backend: "memory",
    maxThreads: 1,
    silent: true,
  });

  const testManager1 = await testScope.create("test1");
  const testManager2 = await testScope.create("test2");

  // Both managers inherit the scoped configuration
  const testResult1 = await scheduleAndWaitWith(testManager1, {
    jobFile: "examples/MathJob.ts",
    jobPayload: { data: [1, 1, 1], operation: "sum" },
  });

  const testResult2 = await scheduleAndWaitWith(testManager2, {
    jobFile: "examples/MathJob.ts",
    jobPayload: { data: [2, 2, 2], operation: "sum" },
  });

  console.log("Test scope results:", { testResult1, testResult2 });

  // Clean up all instances
  console.log("\n7. Cleanup:");

  // Destroy specific instances
  await destroyTaskManager("main");
  console.log("Destroyed 'main' manager");

  // Destroy all instances from a factory
  await factory.destroyAll();
  console.log("Destroyed all instances from custom factory");

  await devFactory.destroyAll();
  await perfFactory.destroyAll();
  await testScope.destroyAll();
  console.log("Cleanup complete!");

  // Demonstrate instance isolation
  console.log("\n8. Instance isolation:");

  const isolatedFactory = new TaskManagerFactory();

  try {
    // Create two isolated instances
    const instance1 = await isolatedFactory.create("isolated1", {
      backend: "memory",
    });

    const instance2 = await isolatedFactory.create("isolated2", {
      backend: "sqlite",
      databaseUrl: "memory://",
    });

    // Each instance maintains its own queue and workers
    const job1 = scheduleAndWaitWith(instance1, {
      jobFile: "examples/MathJob.ts",
      jobPayload: { data: [1, 2, 3], operation: "sum" },
    });

    const job2 = scheduleAndWaitWith(instance2, {
      jobFile: "examples/MathJob.ts",
      jobPayload: { data: [4, 5, 6], operation: "sum" },
    });

    const [result1, result2] = await Promise.all([job1, job2]);
    console.log("Isolated results:", { result1, result2 });

    // Check that instances are truly isolated
    const stats1 = await instance1.getQueueStats();
    const stats2 = await instance2.getQueueStats();

    console.log("Instance 1 stats:", stats1);
    console.log("Instance 2 stats:", stats2);

  } finally {
    await isolatedFactory.destroyAll();
  }

  console.log("\n=== Example Complete ===");
}

// Run the example
main().catch(console.error);
