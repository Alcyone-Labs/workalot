import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import {
  SimpleOrchestrator,
  SimpleOrchestratorConfig,
} from "../src/orchestration/SimpleOrchestrator.js";
import { WebSocketServer } from "../src/communication/WebSocketServer.js";
import { IQueueBackend } from "../src/queue/IQueueBackend.js";
import { QueueManager } from "../src/queue/QueueManager.js";
import { JobPayload, JobStatus, QueueItem } from "../src/types/index.js";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { getTempTsonFile } from "./test-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const projectRoot = resolve(__dirname, "..");

describe("SimpleOrchestrator", () => {
  let orchestrator: SimpleOrchestrator;
  let queueManager: QueueManager;
  let testId: string;
  let persistenceFile: string;

  beforeEach(async () => {
    testId = randomBytes(8).toString("hex");
    persistenceFile = getTempTsonFile("orchestrator");

    queueManager = new QueueManager({
      persistenceFile,
      maxInMemoryAge: 1000,
      healthCheckInterval: 100,
    });
    await queueManager.initialize();

    orchestrator = new SimpleOrchestrator({
      queueBackend: queueManager,
      wsPort: 0, // Random port
      wsHostname: "localhost",
      distributionStrategy: "round-robin",
    });
  });

  afterEach(async () => {
    try {
      await orchestrator.stop();
    } catch {}
    try {
      await queueManager.shutdown();
    } catch {}
  });

  describe("Lifecycle", () => {
    it("should start and stop without errors", async () => {
      await orchestrator.start();
      expect(orchestrator.isActive()).toBe(true);

      await orchestrator.stop();
      expect(orchestrator.isActive()).toBe(false);
    });

    it("should not throw when stopping multiple times", async () => {
      await orchestrator.start();
      await orchestrator.stop();
      await orchestrator.stop(); // Second stop should not throw
    });

    it("should emit started and stopped events", async () => {
      const startedPromise = new Promise<void>((resolve) => {
        orchestrator.once("started", resolve);
      });
      const stoppedPromise = new Promise<void>((resolve) => {
        orchestrator.once("stopped", resolve);
      });

      await orchestrator.start();
      await startedPromise;

      await orchestrator.stop();
      await stoppedPromise;
    });
  });

  describe("Job Management", () => {
    it("should add jobs to the queue", async () => {
      await orchestrator.start();

      const jobPayload: JobPayload = {
        jobFile: "./tests/fixtures/SimpleTestJob.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await orchestrator.addJob(jobPayload);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");

      const job = await orchestrator.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.jobPayload).toEqual(jobPayload);
    });

    it("should emit job-added event when adding jobs", async () => {
      await orchestrator.start();

      const jobPayload: JobPayload = {
        jobFile: "./tests/fixtures/SimpleTestJob.ts",
        jobPayload: { test: "data" },
      };

      let jobId: string | undefined;
      orchestrator.on("job-added", (id) => {
        jobId = id;
      });

      const id = await orchestrator.addJob(jobPayload);
      expect(jobId).toBe(id);
    });

    it("should get jobs by status", async () => {
      await orchestrator.start();

      const jobPayload: JobPayload = {
        jobFile: "./tests/fixtures/SimpleTestJob.ts",
        jobPayload: { test: "data" },
      };

      const jobId = await orchestrator.addJob(jobPayload);

      const pendingJobs = await orchestrator.getJobsByStatus(JobStatus.PENDING);
      expect(pendingJobs.length).toBeGreaterThanOrEqual(1);
      expect(pendingJobs.some((j) => j.id === jobId)).toBe(true);
    });

    it("should return queue statistics", async () => {
      await orchestrator.start();

      const jobPayload: JobPayload = {
        jobFile: "./tests/fixtures/SimpleTestJob.ts",
        jobPayload: { test: "data" },
      };

      await orchestrator.addJob(jobPayload);
      await orchestrator.addJob(jobPayload);

      const stats = await orchestrator.getQueueStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Worker Management", () => {
    it("should return zero workers initially", async () => {
      await orchestrator.start();
      expect(orchestrator.getWorkerCount()).toBe(0);
    });

    it("should return worker statistics", async () => {
      await orchestrator.start();

      const stats = orchestrator.getWorkerStats();
      expect(stats).toHaveProperty("totalWorkers");
      expect(stats).toHaveProperty("availableWorkers");
      expect(stats).toHaveProperty("busyWorkers");
      expect(stats).toHaveProperty("workers");
      expect(stats.totalWorkers).toBe(0);
    });
  });

  describe("Distribution Strategy", () => {
    it("should support round-robin strategy", async () => {
      const orchestrator = new SimpleOrchestrator({
        queueBackend: queueManager,
        wsPort: 0,
        distributionStrategy: "round-robin",
      });

      await orchestrator.start();
      expect(orchestrator.isActive()).toBe(true);
    });

    it("should support least-loaded strategy", async () => {
      const orchestrator = new SimpleOrchestrator({
        queueBackend: queueManager,
        wsPort: 0,
        distributionStrategy: "least-loaded",
      });

      await orchestrator.start();
      expect(orchestrator.isActive()).toBe(true);
    });

    it("should support random strategy", async () => {
      const orchestrator = new SimpleOrchestrator({
        queueBackend: queueManager,
        wsPort: 0,
        distributionStrategy: "random",
      });

      await orchestrator.start();
      expect(orchestrator.isActive()).toBe(true);
    });
  });

  describe("Message Routing", () => {
    it("should register channel routes", async () => {
      await orchestrator.start();

      const route = {
        pattern: "test-channel",
        handler: vi.fn(),
      };

      orchestrator.registerChannelRoute(route);
      // Should not throw
    });

    it("should register structured routes", async () => {
      await orchestrator.start();

      const predicate = (message: any) => message.type === "custom";
      const handler = vi.fn();

      orchestrator.registerStructuredRoute(predicate, handler);
      // Should not throw
    });

    it("should send channel messages to workers", async () => {
      await orchestrator.start();

      const result = orchestrator.sendChannelToWorker(1, {
        channel: "test",
        data: { message: "hello" },
      });
      expect(result).toBe(false); // No workers connected
    });
  });
});

describe("SimpleOrchestrator Integration", () => {
  let queueManager: QueueManager;
  let persistenceFile: string;

  beforeEach(async () => {
    persistenceFile = getTempTsonFile("integration");
    queueManager = new QueueManager({
      persistenceFile,
      maxInMemoryAge: 1000,
      healthCheckInterval: 100,
    });
    await queueManager.initialize();
  });

  afterEach(async () => {
    try {
      await queueManager.shutdown();
    } catch {}
  });

  it("should handle concurrent job additions", async () => {
    const orchestrator = new SimpleOrchestrator({
      queueBackend: queueManager,
      wsPort: 0,
    });

    await orchestrator.start();

    const jobs: JobPayload[] = Array.from({ length: 10 }, (_, i) => ({
      jobFile: "./tests/fixtures/SimpleTestJob.ts",
      jobPayload: { index: i },
    }));

    const jobIds = await Promise.all(jobs.map((job) => orchestrator.addJob(job)));

    expect(jobIds.length).toBe(10);
    expect(new Set(jobIds).size).toBe(10); // All unique

    const stats = await orchestrator.getQueueStats();
    expect(stats.total).toBe(10);

    await orchestrator.stop();
  });

  it("should maintain job order in queue", async () => {
    const orchestrator = new SimpleOrchestrator({
      queueBackend: queueManager,
      wsPort: 0,
    });

    await orchestrator.start();

    const jobPayloads: JobPayload[] = Array.from({ length: 5 }, (_, i) => ({
      jobFile: "./tests/fixtures/SimpleTestJob.ts",
      jobPayload: { order: i },
    }));

    for (const payload of jobPayloads) {
      await orchestrator.addJob(payload);
    }

    const pendingJobs = await orchestrator.getJobsByStatus(JobStatus.PENDING);
    expect(pendingJobs.length).toBe(5);

    // Jobs should be in FIFO order
    for (let i = 0; i < pendingJobs.length - 1; i++) {
      const current = pendingJobs[i].requestedAt.getTime();
      const next = pendingJobs[i + 1].requestedAt.getTime();
      expect(current).toBeLessThanOrEqual(next);
    }

    await orchestrator.stop();
  });

  it("should handle job retrieval by ID", async () => {
    const orchestrator = new SimpleOrchestrator({
      queueBackend: queueManager,
      wsPort: 0,
    });

    await orchestrator.start();

    const jobPayload: JobPayload = {
      jobFile: "./tests/fixtures/SimpleTestJob.ts",
      jobPayload: { unique: "test-123" },
    };

    const jobId = await orchestrator.addJob(jobPayload);

    const job = await orchestrator.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.id).toBe(jobId);
    expect(job?.jobPayload).toEqual(jobPayload);

    const nonExistentJob = await orchestrator.getJob("non-existent-id");
    expect(nonExistentJob).toBeUndefined();

    await orchestrator.stop();
  });
});
