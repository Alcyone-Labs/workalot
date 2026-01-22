import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cpus, totalmem } from "node:os";

export interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  category: string;
  message: string;
  data?: any;
}

export class BenchmarkLogger {
  private logDir: string;
  private logFile: string;
  private startTime: number;

  constructor(outputDir: string = "benchmarks/logs") {
    this.logDir = outputDir;
    this.startTime = Date.now();

    // Create logs directory if it doesn't exist
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    // Create timestamped log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFile = join(this.logDir, `benchmark-${timestamp}.log`);

    // Initialize log file with header
    this.writeLogHeader();
  }

  private writeLogHeader(): void {
    const header = [
      "=".repeat(80),
      `Workalot Benchmark Suite - Log Started`,
      `Timestamp: ${new Date().toISOString()}`,
      `System: ${process.platform} ${process.arch}`,
      `Node Version: ${process.version}`,
      `CPU Cores: ${cpus().length}`,
      `Memory: ${Math.round(totalmem() / 1024 / 1024 / 1024)}GB`,
      "=".repeat(80),
      "",
    ].join("\n");

    writeFileSync(this.logFile, header);
  }

  private formatLogEntry(entry: LogEntry): string {
    const elapsed = Date.now() - this.startTime;
    const elapsedStr = `+${elapsed}ms`.padStart(8);
    const levelStr = entry.level.padEnd(5);
    const categoryStr = entry.category.padEnd(15);

    let line = `[${entry.timestamp}] ${elapsedStr} ${levelStr} ${categoryStr} ${entry.message}`;

    if (entry.data) {
      line += `\n${JSON.stringify(entry.data, null, 2)}`;
    }

    return line + "\n";
  }

  private log(level: LogEntry["level"], category: string, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };

    const formattedEntry = this.formatLogEntry(entry);
    appendFileSync(this.logFile, formattedEntry);
  }

  info(category: string, message: string, data?: any): void {
    this.log("INFO", category, message, data);
  }

  warn(category: string, message: string, data?: any): void {
    this.log("WARN", category, message, data);
  }

  error(category: string, message: string, data?: any): void {
    this.log("ERROR", category, message, data);
  }

  debug(category: string, message: string, data?: any): void {
    this.log("DEBUG", category, message, data);
  }

  // Specialized logging methods for benchmark phases
  benchmarkStart(config: any): void {
    this.info("BENCHMARK", `Starting benchmark: ${config.name}`, {
      cores: config.cores,
      totalJobs: config.totalJobs,
      backend: config.backend,
      taskTypes: config.taskTypes,
    });
  }

  benchmarkComplete(config: any, result: any): void {
    this.info("BENCHMARK", `Completed benchmark: ${config.name}`, {
      totalTime: result.totalTime,
      jobsPerSecond: result.jobsPerSecond,
      queueingDuration: result.queueingPhase.duration,
      executionDuration: result.executionPhase.duration,
    });
  }

  phaseStart(phase: string, details?: any): void {
    this.info("PHASE", `Starting ${phase} phase`, details);
  }

  phaseComplete(phase: string, duration: number, details?: any): void {
    this.info("PHASE", `Completed ${phase} phase in ${duration}ms`, details);
  }

  workerActivity(workerId: number, action: string, jobInfo?: any): void {
    this.debug("WORKER", `Worker ${workerId}: ${action}`, jobInfo);
  }

  systemStats(stats: any): void {
    this.debug("SYSTEM", "System performance stats", stats);
  }

  getLogFile(): string {
    return this.logFile;
  }

  getLogDir(): string {
    return this.logDir;
  }
}

// Global logger instance
let globalLogger: BenchmarkLogger | null = null;

export function initializeLogger(outputDir?: string): BenchmarkLogger {
  globalLogger = new BenchmarkLogger(outputDir);
  return globalLogger;
}

export function getLogger(): BenchmarkLogger {
  if (!globalLogger) {
    throw new Error("Logger not initialized. Call initializeLogger() first.");
  }
  return globalLogger;
}
