import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BenchmarkResult } from './benchmark-config.js';

export class ResultsExporter {
  private outputDir: string;

  constructor(outputDir: string = 'benchmarks/results') {
    this.outputDir = outputDir;
  }

  /**
   * Export benchmark results to JSON files
   */
  async exportResults(results: BenchmarkResult[]): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });

    // Export individual results
    for (const result of results) {
      const filename = `${result.config.name}-${new Date(result.timestamp).getTime()}.json`;
      const filepath = join(this.outputDir, filename);
      await writeFile(filepath, JSON.stringify(result, null, 2));
      console.log(`📄 Exported: ${filepath}`);
    }

    // Export summary
    const summary = this.createSummary(results);
    const summaryPath = join(this.outputDir, 'benchmark-summary.json');
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`📊 Summary exported: ${summaryPath}`);

    // Export CSV for easy analysis
    const csvData = this.createCSV(results);
    const csvPath = join(this.outputDir, 'benchmark-results.csv');
    await writeFile(csvPath, csvData);
    console.log(`📈 CSV exported: ${csvPath}`);
  }

  /**
   * Create summary statistics
   */
  private createSummary(results: BenchmarkResult[]) {
    return {
      totalBenchmarks: results.length,
      timestamp: new Date().toISOString(),
      results: results.map(result => ({
        name: result.config.name,
        cores: result.config.cores,
        totalJobs: result.config.totalJobs,
        totalTime: result.totalTime,
        jobsPerSecond: result.jobsPerSecond,
        queueing: {
          duration: result.queueingPhase.duration,
          peakCPU: result.queueingPhase.peakCPU,
          peakMemory: result.queueingPhase.peakMemory,
          averageCPU: result.queueingPhase.averageCPU,
          averageMemory: result.queueingPhase.averageMemory,
          workerStats: result.queueingPhase.workerStats
        },
        execution: {
          duration: result.executionPhase.duration,
          peakCPU: result.executionPhase.peakCPU,
          peakMemory: result.executionPhase.peakMemory,
          averageCPU: result.executionPhase.averageCPU,
          averageMemory: result.executionPhase.averageMemory,
          workerStats: result.executionPhase.workerStats
        }
      }))
    };
  }

  /**
   * Create CSV data for analysis
   */
  private createCSV(results: BenchmarkResult[]): string {
    const headers = [
      'name',
      'cores',
      'totalJobs',
      'totalTime',
      'jobsPerSecond',
      'queueingDuration',
      'queueingPeakCPU',
      'queueingPeakMemory',
      'queueingAvgCPU',
      'queueingAvgMemory',
      'executionDuration',
      'executionPeakCPU',
      'executionPeakMemory',
      'executionAvgCPU',
      'executionAvgMemory',
      'workerUtilization',
      'jobDistribution',
      'timestamp'
    ];

    const rows = results.map(result => {
      const avgUtilization = result.executionPhase.workerStats.reduce((sum, w) => sum + w.utilizationPercentage, 0) / result.executionPhase.workerStats.length;
      const jobDistribution = result.executionPhase.workerStats.map(w => w.jobsProcessed).join(':');

      return [
        result.config.name,
        result.config.cores,
        result.config.totalJobs,
        result.totalTime,
        result.jobsPerSecond.toFixed(2),
        result.queueingPhase.duration,
        result.queueingPhase.peakCPU.toFixed(2),
        result.queueingPhase.peakMemory,
        result.queueingPhase.averageCPU.toFixed(2),
        result.queueingPhase.averageMemory,
        result.executionPhase.duration,
        result.executionPhase.peakCPU.toFixed(2),
        result.executionPhase.peakMemory,
        result.executionPhase.averageCPU.toFixed(2),
        result.executionPhase.averageMemory,
        avgUtilization.toFixed(2),
        jobDistribution,
        result.timestamp
      ];
    });

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * Generate Observable Plot visualization data
   */
  async exportVisualizationData(results: BenchmarkResult[]): Promise<void> {
    const vizData = {
      summary: results.map(result => ({
        name: result.config.name,
        cores: result.config.cores,
        jobs: result.config.totalJobs,
        throughput: result.jobsPerSecond,
        totalTime: result.totalTime,
        queueingTime: result.queueingPhase.duration,
        executionTime: result.executionPhase.duration,
        workerUtilization: result.executionPhase.workerStats.reduce((sum, w) => sum + w.utilizationPercentage, 0) / result.executionPhase.workerStats.length
      })),
      workerStats: results.flatMap(result =>
        result.executionPhase.workerStats.map(worker => ({
          benchmark: result.config.name,
          cores: result.config.cores,
          workerId: worker.workerId,
          jobsProcessed: worker.jobsProcessed,
          utilizationPercentage: worker.utilizationPercentage,
          averageJobTime: worker.averageJobTime
        }))
      ),
      cpuTimeSeries: results.flatMap(result => [
        ...result.queueingPhase.cpuUsage.map(cpu => ({
          benchmark: result.config.name,
          phase: 'queueing',
          timestamp: cpu.timestamp,
          usage: cpu.usage
        })),
        ...result.executionPhase.cpuUsage.map(cpu => ({
          benchmark: result.config.name,
          phase: 'execution',
          timestamp: cpu.timestamp,
          usage: cpu.usage
        }))
      ]),
      memoryTimeSeries: results.flatMap(result => [
        ...result.queueingPhase.memoryUsage.map(mem => ({
          benchmark: result.config.name,
          phase: 'queueing',
          timestamp: mem.timestamp,
          rss: mem.rss,
          heapUsed: mem.heapUsed
        })),
        ...result.executionPhase.memoryUsage.map(mem => ({
          benchmark: result.config.name,
          phase: 'execution',
          timestamp: mem.timestamp,
          rss: mem.rss,
          heapUsed: mem.heapUsed
        }))
      ])
    };

    const vizPath = join(this.outputDir, 'visualization-data.json');
    await writeFile(vizPath, JSON.stringify(vizData, null, 2));
    console.log(`📊 Visualization data exported: ${vizPath}`);
  }
}
