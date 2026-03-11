import { cpus } from "node:os";
import { CPUMeasurement, MemoryMeasurement } from "./benchmark-config.js";

export class PerformanceMonitor {
  private cpuMeasurements: CPUMeasurement[] = [];
  private memoryMeasurements: MemoryMeasurement[] = [];
  private monitoring = false;
  private intervalId?: NodeJS.Timeout;
  private startTime = 0;

  /**
   * Start monitoring CPU and memory usage
   */
  start(intervalMs: number = 100): void {
    if (this.monitoring) {
      return;
    }

    this.monitoring = true;
    this.startTime = Date.now();
    this.cpuMeasurements = [];
    this.memoryMeasurements = [];

    // Initial CPU measurement
    this.measureCPU();

    this.intervalId = setInterval(() => {
      this.measureCPU();
      this.measureMemory();
    }, intervalMs);
  }

  /**
   * Stop monitoring and return collected data
   */
  stop(): { cpu: CPUMeasurement[]; memory: MemoryMeasurement[] } {
    if (!this.monitoring) {
      return { cpu: [], memory: [] };
    }

    this.monitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Final measurements
    this.measureCPU();
    this.measureMemory();

    return {
      cpu: [...this.cpuMeasurements],
      memory: [...this.memoryMeasurements],
    };
  }

  /**
   * Get current CPU usage percentage
   */
  private measureCPU(): void {
    const cpuInfo = cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpuInfo.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpuInfo.length;
    const total = totalTick / cpuInfo.length;
    const usage = 100 - (100 * idle) / total;

    this.cpuMeasurements.push({
      timestamp: Date.now() - this.startTime,
      usage: Math.max(0, Math.min(100, usage)),
    });
  }

  /**
   * Get current memory usage
   */
  private measureMemory(): void {
    const memUsage = process.memoryUsage();

    this.memoryMeasurements.push({
      timestamp: Date.now() - this.startTime,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    });
  }

  /**
   * Calculate statistics from measurements
   */
  static calculateStats(measurements: CPUMeasurement[] | MemoryMeasurement[]): {
    peak: number;
    average: number;
    min: number;
  } {
    if (measurements.length === 0) {
      return { peak: 0, average: 0, min: 0 };
    }

    let values: number[];

    if ("usage" in measurements[0]) {
      values = (measurements as CPUMeasurement[]).map((m) => m.usage);
    } else {
      values = (measurements as MemoryMeasurement[]).map((m) => m.rss);
    }

    const peak = Math.max(...values);
    const min = Math.min(...values);
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;

    return { peak, average, min };
  }
}
