import { readdir, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { JobLoader } from "./JobLoader.js";

/**
 * Information about a discovered job
 */
export interface JobInfo {
  name: string;
  path: string;
  relativePath: string;
  isValid: boolean;
  error?: string;
}

/**
 * Registry for discovering and managing available jobs
 */
export class JobRegistry {
  private readonly jobLoader: JobLoader;
  private readonly projectRoot: string;
  private jobCache = new Map<string, JobInfo>();

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.jobLoader = new JobLoader(projectRoot);
  }

  /**
   * Discovers all job files in a directory recursively
   */
  async discoverJobs(directory: string = "examples"): Promise<JobInfo[]> {
    const jobsDir = resolve(this.projectRoot, directory);
    const jobs: JobInfo[] = [];

    try {
      await this.scanDirectory(jobsDir, jobs, directory);
    } catch (error) {
      console.warn(`Failed to scan directory ${jobsDir}:`, error);
    }

    // Validate discovered jobs
    for (const job of jobs) {
      if (!this.jobCache.has(job.path)) {
        await this.validateJob(job);
        this.jobCache.set(job.path, job);
      }
    }

    return jobs.filter((job) => job.isValid);
  }

  /**
   * Gets information about a specific job
   */
  async getJobInfo(jobPath: string): Promise<JobInfo | null> {
    const fullPath = resolve(this.projectRoot, jobPath);

    if (this.jobCache.has(fullPath)) {
      return this.jobCache.get(fullPath)!;
    }

    const jobInfo: JobInfo = {
      name: this.extractJobName(jobPath),
      path: fullPath,
      relativePath: jobPath,
      isValid: false,
    };

    await this.validateJob(jobInfo);
    this.jobCache.set(fullPath, jobInfo);

    return jobInfo;
  }

  /**
   * Lists all cached job information
   */
  listJobs(): JobInfo[] {
    return Array.from(this.jobCache.values()).filter((job) => job.isValid);
  }

  /**
   * Clears the job registry cache
   */
  clearCache(): void {
    this.jobCache.clear();
    this.jobLoader.clearCache();
  }

  /**
   * Refreshes job information by re-validating
   */
  async refreshJob(jobPath: string): Promise<JobInfo | null> {
    const fullPath = resolve(this.projectRoot, jobPath);
    this.jobCache.delete(fullPath);
    this.jobLoader.clearCache();
    return this.getJobInfo(jobPath);
  }

  /**
   * Scans a directory recursively for job files
   */
  private async scanDirectory(
    directory: string,
    jobs: JobInfo[],
    relativePath: string,
  ): Promise<void> {
    try {
      const entries = await readdir(directory);

      for (const entry of entries) {
        const fullPath = join(directory, entry);
        const entryRelativePath = join(relativePath, entry);
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectory(fullPath, jobs, entryRelativePath);
        } else if (stats.isFile() && this.isJobFile(entry)) {
          jobs.push({
            name: this.extractJobName(entry),
            path: fullPath,
            relativePath: entryRelativePath,
            isValid: false,
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to scan directory ${directory}:`, error);
    }
  }

  /**
   * Checks if a file is potentially a job file based on extension
   */
  private isJobFile(filename: string): boolean {
    const ext = extname(filename);
    return (
      [".js", ".ts", ".mjs"].includes(ext) &&
      !filename.endsWith(".test.js") &&
      !filename.endsWith(".test.ts") &&
      !filename.endsWith(".spec.js") &&
      !filename.endsWith(".spec.ts")
    );
  }

  /**
   * Extracts job name from file path
   */
  private extractJobName(filePath: string): string {
    const filename = filePath.split("/").pop() || filePath;
    return filename.replace(/\.(js|ts|mjs)$/, "");
  }

  /**
   * Validates a job and updates its info
   */
  private async validateJob(jobInfo: JobInfo): Promise<void> {
    try {
      await this.jobLoader.loadJob(jobInfo.relativePath);
      jobInfo.isValid = true;
      jobInfo.error = undefined;
    } catch (error) {
      jobInfo.isValid = false;
      jobInfo.error = error instanceof Error ? error.message : String(error);
    }
  }
}
