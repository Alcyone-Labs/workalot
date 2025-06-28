import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { JobLoader } from "../src/jobs/JobLoader.js";
import { JobExecutor } from "../src/jobs/JobExecutor.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");

describe("Job System", () => {
  describe("JobLoader", () => {
    let jobLoader: JobLoader;

    beforeAll(() => {
      jobLoader = new JobLoader(projectRoot);
    });

    it("should load a valid job file", async () => {
      const job = await jobLoader.loadJob(
        "dist/tests/fixtures/SimpleTestJob.js",
      );
      expect(job).toBeDefined();
      expect(typeof job.run).toBe("function");
      expect(typeof job.getJobId).toBe("function");
    });

    it("should cache loaded jobs", async () => {
      const job1 = await jobLoader.loadJob(
        "dist/tests/fixtures/SimpleTestJob.js",
      );
      const job2 = await jobLoader.loadJob(
        "dist/tests/fixtures/SimpleTestJob.js",
      );
      expect(job1).toBe(job2);
    });

    it("should throw JobLoadError for non-existent file", async () => {
      await expect(jobLoader.loadJob("nonexistent.js")).rejects.toThrow(
        /Job file not found or not readable/,
      );
    });

    it("should get job ID from loaded job", async () => {
      const payload = { test: "data" };
      const jobId = await jobLoader.getJobId({
        jobFile: "dist/tests/fixtures/SimpleTestJob.js",
        jobPayload: payload,
      });
      // Should return a ULID (26 characters, alphanumeric)
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");
      expect(jobId!.length).toBe(26);
      expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(jobId!)).toBe(true);
    });

    it("should execute job successfully", async () => {
      const payload = { operation: "pong" };
      const context = {
        jobId: "test-pong",
        startTime: Date.now(),
        queueTime: 0,
        timeout: 5000,
      };
      const result = await jobLoader.executeJob(
        {
          jobFile: "dist/examples/PingJob.js",
          jobPayload: payload,
        },
        context,
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data.message).toBe("pong");
    });
  });

  describe("JobExecutor", () => {
    let jobExecutor: JobExecutor;

    beforeAll(() => {
      jobExecutor = new JobExecutor(projectRoot);
    });

    it("should execute job with timing information", async () => {
      const jobPayload = {
        jobFile: "dist/tests/fixtures/LongRunningJob.js",
        jobPayload: { duration: 100 },
      };
      const context = {
        jobId: "timing-test",
        startTime: Date.now(),
        queueTime: 0,
        timeout: 5000,
      };
      const result = await jobExecutor.executeJob(jobPayload, context);

      expect(result.results.success).toBe(true);
      expect(result.executionTime).toBeGreaterThanOrEqual(100);
      expect(result.queueTime).toBe(0); // Not managed by executor
    });

    it("should execute math job with complex payload", async () => {
      const jobPayload = {
        jobFile: "dist/tests/fixtures/SimpleTestJob.js",
        jobPayload: { operation: "add", values: [1, 2, 3, 4, 5] },
      };
      const context = {
        jobId: "math-test",
        startTime: Date.now(),
        queueTime: 0,
        timeout: 5000,
      };
      const result = await jobExecutor.executeJob(jobPayload, context);

      expect(result.results.success).toBe(true);
      expect(result.results.data.result).toBe(15);
    });

    it("should handle job timeout", async () => {
      const jobPayload = {
        jobFile: "dist/tests/fixtures/LongRunningJob.js",
        jobPayload: { duration: 200 },
        jobTimeout: 100,
      };
      const context = {
        jobId: "timeout-test",
        startTime: Date.now(),
        queueTime: 0,
        timeout: 100,
      };
      await expect(jobExecutor.executeJob(jobPayload, context)).rejects.toThrow(
        /Job execution timed out/,
      );
    });
  });
});
