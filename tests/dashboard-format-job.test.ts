import { describe, it, expect } from "vitest";
import { formatJobForApi } from "../src/dashboard/formatJobForApi.ts";
import {
  JobStatus,
  type JobPayload,
  type JobResult,
  type QueueItem,
} from "../src/types/index.ts";

describe("Dashboard job formatting", () => {
  it("formats queue items for API responses", () => {
    const jobPayload: JobPayload = {
      jobFile: "jobs/TestJob.ts",
      jobPayload: { message: "hello" },
    };

    const result: JobResult = {
      results: { success: true },
      executionTime: 12,
      queueTime: 3,
    };

    const queueItem: QueueItem = {
      id: "job-123",
      jobPayload,
      status: JobStatus.FAILED,
      requestedAt: new Date("2026-01-01T00:00:00.000Z"),
      startedAt: new Date("2026-01-01T00:00:01.000Z"),
      completedAt: new Date("2026-01-01T00:00:02.000Z"),
      lastUpdated: new Date("2026-01-01T00:00:03.000Z"),
      result,
      error: new Error("boom"),
      workerId: 4,
    };

    const formatted = formatJobForApi(queueItem);

    expect(formatted).toEqual({
      id: "job-123",
      status: JobStatus.FAILED,
      jobPayload,
      createdAt: "2026-01-01T00:00:00.000Z",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      lastUpdated: "2026-01-01T00:00:03.000Z",
      result,
      error: "boom",
      workerId: 4,
    });
  });

  it("omits optional fields when missing", () => {
    const queueItem: QueueItem = {
      id: "job-456",
      jobPayload: {
        jobFile: "jobs/AnotherJob.ts",
        jobPayload: { value: 42 },
      },
      status: JobStatus.PENDING,
      requestedAt: new Date("2026-01-02T00:00:00.000Z"),
      lastUpdated: new Date("2026-01-02T00:00:00.000Z"),
    };

    const formatted = formatJobForApi(queueItem);

    expect(formatted).toEqual({
      id: "job-456",
      status: JobStatus.PENDING,
      jobPayload: {
        jobFile: "jobs/AnotherJob.ts",
        jobPayload: { value: 42 },
      },
      createdAt: "2026-01-02T00:00:00.000Z",
      requestedAt: "2026-01-02T00:00:00.000Z",
      lastUpdated: "2026-01-02T00:00:00.000Z",
    });
  });
});
