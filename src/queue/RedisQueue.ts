import Redis, { RedisOptions } from "ioredis";
import { ulid } from "ulidx";
import { IQueueBackend, QueueStats } from "./IQueueBackend.js";
import { QueueItem, JobStatus, JobPayload, JobResult, QueueConfig } from "../types/index.js";

export interface RedisQueueConfig extends QueueConfig {
  /**
   * Redis connection URL
   * Examples:
   * - 'redis://localhost:6379'
   * - 'redis://:password@localhost:6379/0'
   * - 'rediss://user:password@host:6380' (TLS)
   */
  redisUrl?: string;

  /**
   * ioredis connection options
   * Use this for advanced configuration (cluster, sentinels, etc.)
   */
  redisOptions?: RedisOptions;

  /**
   * Key prefix for all Redis keys
   * Default: 'workalot'
   */
  keyPrefix?: string;

  /**
   * TTL for completed jobs (in seconds)
   * Default: 86400 (24 hours)
   */
  completedJobTTL?: number;

  /**
   * TTL for failed jobs (in seconds)
   * Default: 604800 (7 days)
   */
  failedJobTTL?: number;

  /**
   * Enable Redis Pub/Sub for real-time notifications
   * Default: false
   */
  enablePubSub?: boolean;

  /**
   * Enable debug logging
   * Default: false
   */
  debug?: boolean;
}

/**
 * Redis-based queue implementation
 *
 * Data structure:
 * - {prefix}:jobs:{jobId} -> Hash (job data)
 * - {prefix}:queue:pending -> Sorted Set (score = priority * 1e13 + timestamp)
 * - {prefix}:queue:processing -> Hash (jobId -> workerId:startTime)
 * - {prefix}:queue:completed -> Set
 * - {prefix}:queue:failed -> Set
 * - {prefix}:stats -> Hash
 */
export class RedisQueue extends IQueueBackend {
  private redis: Redis;
  private subscriber?: Redis;
  private keyPrefix: string;
  private completedJobTTL: number;
  private failedJobTTL: number;
  private enablePubSub: boolean;
  private debug: boolean;
  private isInitialized = false;
  private isShuttingDown = false;

  // Lua scripts for atomic operations
  private claimJobScript?: string;
  private updateJobStatusScript?: string;

  constructor(config: RedisQueueConfig) {
    super(config);

    this.keyPrefix = config.keyPrefix || "workalot";
    this.completedJobTTL = config.completedJobTTL || 86400; // 24 hours
    this.failedJobTTL = config.failedJobTTL || 604800; // 7 days
    this.enablePubSub = config.enablePubSub || false;
    this.debug = config.debug || false;

    // Initialize Redis client
    if (config.redisUrl && config.redisOptions) {
      this.redis = new Redis(config.redisUrl, config.redisOptions);
    } else if (config.redisUrl) {
      this.redis = new Redis(config.redisUrl);
    } else if (config.redisOptions) {
      this.redis = new Redis(config.redisOptions);
    } else {
      // Default to localhost
      this.redis = new Redis({
        host: "localhost",
        port: 6379,
      });
    }

    // Error handling
    this.redis.on("error", (err) => {
      console.error("Redis connection error:", err);
    });

    this.redis.on("connect", () => {
      if (this.debug) console.log("Redis connected");
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Test connection
      await this.redis.ping();

      // Load Lua scripts
      await this.loadLuaScripts();

      // Initialize stats if not exists
      const exists = await this.redis.exists(this.key("stats"));
      if (!exists) {
        await this.redis.hset(this.key("stats"), {
          total: 0,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        });
      }

      // Setup pub/sub if enabled
      if (this.enablePubSub) {
        await this.setupPubSub();
      }

      this.isInitialized = true;
      if (this.debug) console.log("RedisQueue initialized");
    } catch (error) {
      throw new Error(
        `Failed to initialize RedisQueue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async loadLuaScripts(): Promise<void> {
    // Lua script for atomic job claiming
    this.claimJobScript = `
      local pendingKey = KEYS[1]
      local processingKey = KEYS[2]
      local jobKeyPrefix = KEYS[3]
      local workerId = ARGV[1]
      local startTime = ARGV[2]

      -- Atomically pop lowest score (highest priority, oldest) job
      local result = redis.call('ZPOPMIN', pendingKey, 1)
      if #result == 0 then
        return nil
      end

      local jobId = result[1]
      local jobKey = jobKeyPrefix .. jobId

      -- Update job status
      redis.call('HSET', jobKey, 'status', 'processing', 'workerId', workerId, 'startedAt', startTime)

      -- Add to processing hash
      redis.call('HSET', processingKey, jobId, workerId .. ':' .. startTime)

      return jobId
    `;

    // Lua script for atomic status update
    this.updateJobStatusScript = `
      local jobKey = KEYS[1]
      local processingKey = KEYS[2]
      local targetSetKey = KEYS[3]
      local jobId = ARGV[1]
      local status = ARGV[2]
      local timestamp = ARGV[3]

      -- Update job hash
      redis.call('HSET', jobKey, 'status', status, 'completedAt', timestamp)

      -- Remove from processing
      redis.call('HDEL', processingKey, jobId)

      -- Add to target set (completed or failed)
      if targetSetKey ~= '' then
        redis.call('SADD', targetSetKey, jobId)
      end

      return 1
    `;
  }

  private async setupPubSub(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(this.key("notifications"));

    this.subscriber.on("message", (channel, message) => {
      if (this.debug) console.log("Received notification:", channel, message);
      this.emit("notification", JSON.parse(message));
    });
  }

  private key(suffix: string): string {
    return `${this.keyPrefix}:${suffix}`;
  }

  private jobKey(jobId: string): string {
    return this.key(`jobs:${jobId}`);
  }

  async addJob(jobPayload: JobPayload, customId?: string): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error("Queue is shutting down, cannot add new jobs");
    }

    const id = customId || ulid();
    const now = Date.now();
    const priority = 0; // Default priority, can be extended later

    // Calculate score: higher priority (lower number) and older jobs come first
    // Score = priority * 1e13 + timestamp
    // This ensures priority takes precedence, then FIFO within same priority
    const score = priority * 1e13 + now;

    const pipeline = this.redis.pipeline();

    // Store job data
    pipeline.hset(this.jobKey(id), {
      id,
      payload: JSON.stringify(jobPayload),
      status: JobStatus.PENDING,
      requestedAt: now,
    });

    // Add to pending queue
    pipeline.zadd(this.key("queue:pending"), score, id);

    // Update stats
    pipeline.hincrby(this.key("stats"), "total", 1);
    pipeline.hincrby(this.key("stats"), "pending", 1);

    await pipeline.exec();

    // Publish notification if enabled
    if (this.enablePubSub) {
      await this.redis.publish(
        this.key("notifications"),
        JSON.stringify({ type: "job-added", jobId: id }),
      );
    }

    return id;
  }

  async getJob(id: string): Promise<QueueItem | undefined> {
    const data = await this.redis.hgetall(this.jobKey(id));

    if (!data || !data.id) {
      return undefined;
    }

    return this.mapRedisDataToQueueItem(data);
  }

  private mapRedisDataToQueueItem(data: Record<string, string>): QueueItem {
    return {
      id: data.id,
      jobPayload: JSON.parse(data.payload),
      status: data.status as JobStatus,
      requestedAt: new Date(parseInt(data.requestedAt)),
      startedAt: data.startedAt ? new Date(parseInt(data.startedAt)) : undefined,
      completedAt: data.completedAt ? new Date(parseInt(data.completedAt)) : undefined,
      lastUpdated: new Date(parseInt(data.lastUpdated || data.requestedAt)),
      result: data.result ? JSON.parse(data.result) : undefined,
      error: data.error ? new Error(data.error) : undefined,
      workerId: data.workerId ? parseInt(data.workerId) : undefined,
    };
  }

  async getNextPendingJob(): Promise<QueueItem | undefined> {
    if (!this.claimJobScript) {
      throw new Error("Lua scripts not loaded");
    }

    const now = Date.now();
    const workerId = 0; // Will be set by worker

    // Execute Lua script for atomic job claiming
    const jobId = (await this.redis.eval(
      this.claimJobScript,
      3,
      this.key("queue:pending"),
      this.key("queue:processing"),
      this.key("jobs:"),
      workerId,
      now,
    )) as string | null;

    if (!jobId) {
      return undefined;
    }

    // Update stats
    const pipeline = this.redis.pipeline();
    pipeline.hincrby(this.key("stats"), "pending", -1);
    pipeline.hincrby(this.key("stats"), "processing", 1);
    await pipeline.exec();

    // Fetch and return the job
    return this.getJob(jobId);
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    result?: JobResult,
    error?: Error,
    workerId?: number,
  ): Promise<boolean> {
    const now = Date.now();
    const jobKey = this.jobKey(id);

    const updates: Record<string, string | number> = {
      status,
      lastUpdated: now,
    };

    if (workerId !== undefined) {
      updates.workerId = workerId;
    }

    if (status === JobStatus.PROCESSING) {
      updates.startedAt = now;
    }

    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      updates.completedAt = now;

      if (result) {
        updates.result = JSON.stringify(result);
      }

      if (error) {
        updates.error = error.message;
      }
    }

    const pipeline = this.redis.pipeline();

    // Update job hash
    pipeline.hset(jobKey, updates);

    // Update status tracking
    if (status === JobStatus.COMPLETED) {
      pipeline.hdel(this.key("queue:processing"), id);
      pipeline.sadd(this.key("queue:completed"), id);
      pipeline.hincrby(this.key("stats"), "processing", -1);
      pipeline.hincrby(this.key("stats"), "completed", 1);

      // Set TTL on completed job
      if (this.completedJobTTL > 0) {
        pipeline.expire(jobKey, this.completedJobTTL);
      }
    } else if (status === JobStatus.FAILED) {
      pipeline.hdel(this.key("queue:processing"), id);
      pipeline.sadd(this.key("queue:failed"), id);
      pipeline.hincrby(this.key("stats"), "processing", -1);
      pipeline.hincrby(this.key("stats"), "failed", 1);

      // Set TTL on failed job
      if (this.failedJobTTL > 0) {
        pipeline.expire(jobKey, this.failedJobTTL);
      }
    }

    await pipeline.exec();

    // Publish notification if enabled
    if (this.enablePubSub) {
      await this.redis.publish(
        this.key("notifications"),
        JSON.stringify({ type: "job-updated", jobId: id, status }),
      );
    }

    return true;
  }

  async getJobsByStatus(status: JobStatus): Promise<QueueItem[]> {
    let jobIds: string[] = [];

    if (status === JobStatus.PENDING) {
      // Get all from sorted set
      jobIds = await this.redis.zrange(this.key("queue:pending"), 0, -1);
    } else if (status === JobStatus.PROCESSING) {
      // Get all from processing hash
      jobIds = await this.redis.hkeys(this.key("queue:processing"));
    } else if (status === JobStatus.COMPLETED) {
      jobIds = await this.redis.smembers(this.key("queue:completed"));
    } else if (status === JobStatus.FAILED) {
      jobIds = await this.redis.smembers(this.key("queue:failed"));
    }

    // Fetch all jobs in parallel
    const jobs = await Promise.all(jobIds.map((id) => this.getJob(id)));

    return jobs.filter((job): job is QueueItem => job !== undefined);
  }

  async getStats(): Promise<QueueStats> {
    const stats = await this.redis.hgetall(this.key("stats"));

    // Get oldest pending job
    let oldestPending: Date | undefined;
    const oldestPendingJob = await this.redis.zrange(this.key("queue:pending"), 0, 0, "WITHSCORES");

    if (oldestPendingJob.length > 0) {
      const score = parseInt(oldestPendingJob[1]);
      const timestamp = score % 1e13; // Extract timestamp from score
      oldestPending = new Date(timestamp);
    }

    return {
      total: parseInt(stats.total || "0"),
      pending: parseInt(stats.pending || "0"),
      processing: parseInt(stats.processing || "0"),
      completed: parseInt(stats.completed || "0"),
      failed: parseInt(stats.failed || "0"),
      oldestPending,
    };
  }

  async hasPendingJobs(): Promise<boolean> {
    const count = await this.redis.zcard(this.key("queue:pending"));
    return count > 0;
  }

  async hasProcessingJobs(): Promise<boolean> {
    const count = await this.redis.hlen(this.key("queue:processing"));
    return count > 0;
  }

  async isEmpty(): Promise<boolean> {
    const stats = await this.getStats();
    return stats.total === 0;
  }

  async recoverStalledJobs(stalledTimeoutMs: number = 300000): Promise<number> {
    const stalledJobs = await this.getStalledJobs(stalledTimeoutMs);

    if (stalledJobs.length === 0) {
      return 0;
    }

    const pipeline = this.redis.pipeline();

    for (const job of stalledJobs) {
      const score = 0 * 1e13 + Date.now(); // Reset to current time with default priority

      // Move back to pending queue
      pipeline.zadd(this.key("queue:pending"), score, job.id);
      pipeline.hdel(this.key("queue:processing"), job.id);

      // Update job status
      pipeline.hset(this.jobKey(job.id), {
        status: JobStatus.PENDING,
        lastUpdated: Date.now(),
      });
      pipeline.hdel(this.jobKey(job.id), "startedAt", "workerId");
    }

    // Update stats
    pipeline.hincrby(this.key("stats"), "processing", -stalledJobs.length);
    pipeline.hincrby(this.key("stats"), "pending", stalledJobs.length);

    await pipeline.exec();

    if (this.debug) {
      console.log(`Recovered ${stalledJobs.length} stalled jobs`);
    }

    return stalledJobs.length;
  }

  async getStalledJobs(stalledTimeoutMs: number = 300000): Promise<QueueItem[]> {
    const processingJobs = await this.redis.hgetall(this.key("queue:processing"));
    const now = Date.now();
    const stalledJobIds: string[] = [];

    // Check each processing job
    for (const [jobId, value] of Object.entries(processingJobs)) {
      const [, startTimeStr] = value.split(":");
      const startTime = parseInt(startTimeStr);

      if (now - startTime > stalledTimeoutMs) {
        stalledJobIds.push(jobId);
      }
    }

    // Fetch stalled jobs
    const jobs = await Promise.all(stalledJobIds.map((id) => this.getJob(id)));

    return jobs.filter((job): job is QueueItem => job !== undefined);
  }

  async cleanup(): Promise<number> {
    // Redis handles cleanup via TTL, but we can manually clean up old jobs
    const completedJobs = await this.redis.smembers(this.key("queue:completed"));
    const failedJobs = await this.redis.smembers(this.key("queue:failed"));

    const now = Date.now();
    const completedCutoff = now - this.completedJobTTL * 1000;
    const failedCutoff = now - this.failedJobTTL * 1000;

    let cleanedCount = 0;
    const pipeline = this.redis.pipeline();

    // Clean up old completed jobs
    for (const jobId of completedJobs) {
      const job = await this.getJob(jobId);
      if (job && job.completedAt && job.completedAt.getTime() < completedCutoff) {
        pipeline.del(this.jobKey(jobId));
        pipeline.srem(this.key("queue:completed"), jobId);
        pipeline.hincrby(this.key("stats"), "completed", -1);
        pipeline.hincrby(this.key("stats"), "total", -1);
        cleanedCount++;
      }
    }

    // Clean up old failed jobs
    for (const jobId of failedJobs) {
      const job = await this.getJob(jobId);
      if (job && job.completedAt && job.completedAt.getTime() < failedCutoff) {
        pipeline.del(this.jobKey(jobId));
        pipeline.srem(this.key("queue:failed"), jobId);
        pipeline.hincrby(this.key("stats"), "failed", -1);
        pipeline.hincrby(this.key("stats"), "total", -1);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await pipeline.exec();
      if (this.debug) {
        console.log(`Cleaned up ${cleanedCount} old jobs`);
      }
    }

    return cleanedCount;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Close pub/sub connection
    if (this.subscriber) {
      await this.subscriber.quit();
    }

    // Close main connection
    await this.redis.quit();

    this.isInitialized = false;

    if (this.debug) {
      console.log("RedisQueue shutdown complete");
    }
  }

  /**
   * Batch add jobs for better performance
   */
  async batchAddJobs(jobs: Array<{ payload: JobPayload; customId?: string }>): Promise<string[]> {
    const ids: string[] = [];
    const now = Date.now();
    const priority = 0;

    const pipeline = this.redis.pipeline();

    for (const job of jobs) {
      const id = job.customId || ulid();
      ids.push(id);

      const score = priority * 1e13 + now;

      // Store job data
      pipeline.hset(this.jobKey(id), {
        id,
        payload: JSON.stringify(job.payload),
        status: JobStatus.PENDING,
        requestedAt: now,
      });

      // Add to pending queue
      pipeline.zadd(this.key("queue:pending"), score, id);
    }

    // Update stats
    pipeline.hincrby(this.key("stats"), "total", jobs.length);
    pipeline.hincrby(this.key("stats"), "pending", jobs.length);

    await pipeline.exec();

    return ids;
  }

  /**
   * Get Redis client for advanced operations
   * Use with caution - prefer using queue methods when possible
   */
  getRedisClient(): Redis {
    return this.redis;
  }

  /**
   * Clear all queue data (for testing)
   */
  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
