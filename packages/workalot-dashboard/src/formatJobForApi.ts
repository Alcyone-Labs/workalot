import type { QueueItem, JobPayload, JobResult, JobStatus } from "@alcyone-labs/workalot";

/**
 * Dashboard-friendly representation of a queue item.
 */
export interface DashboardJob {
  id: string;
  status: JobStatus;
  jobPayload: JobPayload;
  createdAt?: string;
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  lastUpdated?: string;
  result?: JobResult;
  error?: string;
  workerId?: number;
}

/**
 * Normalizes queue items for dashboard API responses.
 * @param job - Queue item to serialize for the dashboard API.
 */
export const formatJobForApi = (job: QueueItem): DashboardJob => ({
  id: job.id,
  status: job.status,
  jobPayload: job.jobPayload,
  createdAt: job.requestedAt?.toISOString(),
  requestedAt: job.requestedAt?.toISOString(),
  startedAt: job.startedAt?.toISOString(),
  completedAt: job.completedAt?.toISOString(),
  lastUpdated: job.lastUpdated?.toISOString(),
  result: job.result,
  error: job.error ? job.error.message : undefined,
  workerId: job.workerId,
});
