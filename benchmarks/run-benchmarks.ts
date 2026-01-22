#!/usr/bin/env node

import { BenchmarkRunner } from "./benchmark-runner.js";
import { ResultsExporter } from "./results-exporter.js";
import {
  BENCHMARK_CONFIGS,
  BenchmarkConfig,
  DIFFICULTY_PRESETS,
  DifficultyLevel,
  scaleTaskTypes,
} from "./benchmark-config.js";
import { initializeLogger } from "./benchmark-logger.js";
import { cpus, totalmem, platform, arch } from "node:os";

interface CLIOptions {
  configs?: string[];
  all?: boolean;
  output?: string;
  difficulty?: string;
  timeout?: number;
  help?: boolean;
}

/**
 * Main benchmark execution script
 */
class BenchmarkCLI {
  private runner = new BenchmarkRunner();
  private exporter: ResultsExporter;

  constructor(outputDir?: string) {
    this.exporter = new ResultsExporter(outputDir);
  }

  /**
   * Run benchmarks based on CLI arguments
   */
  async run(args: string[]): Promise<void> {
    // Set environment variable to prevent process.exit() during benchmarks
    process.env.WORKALOT_BENCHMARK = "true";

    // Add process event handlers to debug early exits
    process.on("exit", (code) => {
      console.log(`\n🚨 Process exiting with code ${code}`);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("\n🚨 Unhandled Promise Rejection:", reason);
      console.error("Promise:", promise);
    });

    process.on("uncaughtException", (error) => {
      console.error("\n🚨 Uncaught Exception:", error);
    });

    const options = this.parseArgs(args);

    if (options.help) {
      this.showHelp();
      return;
    }

    // Validate options
    if (options.all && options.configs && options.configs.length > 0) {
      console.error("❌ Error: Cannot use --all and --configs together. Choose one or the other.");
      process.exit(1);
    }

    // Initialize logging system
    const logger = initializeLogger(options.output ? `${options.output}/logs` : undefined);

    // Display system information
    this.showSystemInfo();

    // Parse difficulty setting
    const difficulty = this.parseDifficulty(options.difficulty);
    if (difficulty !== 1.0) {
      console.log(`Difficulty: ${options.difficulty} (${difficulty}x CPU cycles)\n`);
    }

    // Determine which configs to run
    const configsToRun = this.selectConfigs(options.configs, difficulty, options.all);

    console.log(`Running ${configsToRun.length} benchmark configurations:\n`);
    configsToRun.forEach((config, index) => {
      const difficultyStr =
        config.difficulty && config.difficulty !== 1.0 ? ` [${config.difficulty}x difficulty]` : "";
      console.log(
        `${index + 1}. ${config.name} (${config.cores} cores, ${config.totalJobs.toLocaleString()} jobs)${difficultyStr}`,
      );
    });
    console.log("");

    logger.info("CLI", "Starting benchmark suite", {
      configs: configsToRun.map((c) => c.name),
      difficulty: difficulty,
      outputDir: this.exporter["outputDir"],
    });

    // Run benchmarks
    const results = [];
    for (let i = 0; i < configsToRun.length; i++) {
      const config = configsToRun[i];
      console.log(`\n[${i + 1}/${configsToRun.length}] Running: ${config.name}`);

      try {
        console.log(`🔧 About to run benchmark: ${config.name}`);
        logger.info("BENCHMARK", `About to start benchmark execution: ${config.name}`, {
          benchmarkIndex: i + 1,
          totalBenchmarks: configsToRun.length,
          configName: config.name,
          processId: process.pid,
          memoryUsage: process.memoryUsage(),
        });

        const result = await this.runner.runBenchmark(config, options.timeout);

        console.log(`✅ Benchmark completed: ${config.name}`);
        logger.info("BENCHMARK", `Benchmark execution completed: ${config.name}`, {
          benchmarkIndex: i + 1,
          totalBenchmarks: configsToRun.length,
          configName: config.name,
          processId: process.pid,
          memoryUsage: process.memoryUsage(),
          resultSummary: {
            totalTime: result.totalTime,
            jobsPerSecond: result.jobsPerSecond,
          },
        });

        results.push(result);

        // Show quick stats
        console.log(`   ⏱️  Total time: ${(result.totalTime / 1000).toFixed(2)}s`);
        console.log(`   🚀 Throughput: ${result.jobsPerSecond.toFixed(2)} jobs/sec`);
        console.log(`   📝 Queueing: ${result.queueingPhase.duration}ms`);
        console.log(`   ⚡ Execution: ${result.executionPhase.duration}ms`);

        // Show worker distribution
        const jobDistribution = result.executionPhase.workerStats
          .map((w) => w.jobsProcessed)
          .join(":");
        const avgUtilization =
          result.executionPhase.workerStats.reduce((sum, w) => sum + w.utilizationPercentage, 0) /
          result.executionPhase.workerStats.length;
        console.log(
          `   👥 Job distribution: ${jobDistribution} (${avgUtilization.toFixed(1)}% avg utilization)`,
        );

        logger.info("RESULT", `Benchmark ${config.name} completed`, {
          totalTime: result.totalTime,
          jobsPerSecond: result.jobsPerSecond,
          queueingDuration: result.queueingPhase.duration,
          executionDuration: result.executionPhase.duration,
        });

        // Add a small delay to ensure all cleanup is finished
        logger.info("BENCHMARK", `Waiting 1 second for cleanup to complete`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`❌ Benchmark failed: ${config.name}`);
        console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);

        logger.error("BENCHMARK", `Benchmark ${config.name} failed`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      // Brief pause between benchmarks
      if (i < configsToRun.length - 1) {
        console.log("\n⏳ Cooling down for 2 seconds...");
        logger.info(
          "BENCHMARK",
          `Completed benchmark ${i + 1}/${configsToRun.length}, cooling down before next benchmark`,
          {
            completedBenchmark: config.name,
            nextBenchmark: configsToRun[i + 1].name,
            processId: process.pid,
            memoryUsage: process.memoryUsage(),
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log(`\n🔄 Starting next benchmark...`);
        logger.info("BENCHMARK", `Starting benchmark ${i + 2}/${configsToRun.length}`, {
          nextBenchmark: configsToRun[i + 1].name,
          processId: process.pid,
          memoryUsage: process.memoryUsage(),
        });
      }
    }

    console.log(`\n✅ Completed all ${configsToRun.length} benchmarks`);
    logger.info("BENCHMARK", `All benchmarks completed`, {
      totalBenchmarks: configsToRun.length,
      successfulBenchmarks: results.length,
    });

    // Export results
    if (results.length > 0) {
      console.log("\n📊 Exporting results...");
      await this.exporter.exportResults(results);
      await this.exporter.exportVisualizationData(results);

      console.log("\n✅ Benchmark suite completed!");
      console.log(`📈 Results exported to: ${this.exporter["outputDir"]}`);
      console.log(`📋 Detailed logs saved to: ${logger.getLogFile()}`);

      // Show summary
      this.showSummary(results);

      logger.info("CLI", "Benchmark suite completed successfully", {
        totalBenchmarks: results.length,
        resultsDir: this.exporter["outputDir"],
        logFile: logger.getLogFile(),
      });
    } else {
      console.log("\n❌ No benchmarks completed successfully.");
      logger.error("CLI", "No benchmarks completed successfully");
    }
  }

  /**
   * Parse command line arguments
   */
  private parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case "--help":
        case "-h":
          options.help = true;
          break;
        case "--configs":
        case "-c":
          if (i + 1 < args.length) {
            options.configs = args[++i].split(",");
          }
          break;
        case "--all":
        case "-a":
          options.all = true;
          break;
        case "--output":
        case "-o":
          if (i + 1 < args.length) {
            options.output = args[++i];
          }
          break;
        case "--difficulty":
        case "-d":
          if (i + 1 < args.length) {
            options.difficulty = args[++i];
          }
          break;
        case "--timeout":
        case "-t":
          if (i + 1 < args.length) {
            options.timeout = parseInt(args[++i], 10) * 1000; // Convert seconds to ms
          }
          break;
      }
    }

    return options;
  }

  /**
   * Select which configurations to run
   */
  private selectConfigs(
    configNames?: string[],
    difficulty?: number,
    runAll?: boolean,
  ): BenchmarkConfig[] {
    let configs: BenchmarkConfig[];

    if (runAll) {
      // Run all available configurations
      configs = BENCHMARK_CONFIGS;
      console.log("🚀 Running ALL available benchmark configurations!");
    } else if (configNames && configNames.length > 0) {
      // Run specific configurations
      configs = this.filterConfigsByName(configNames);
    } else {
      // Default behavior - run all configs if none specified
      configs = BENCHMARK_CONFIGS;
    }

    // Apply difficulty scaling if specified
    if (difficulty && difficulty !== 1.0) {
      configs = configs.map((config) => ({
        ...config,
        difficulty,
        name: `${config.name}-${this.getDifficultyName(difficulty)}`,
      }));
    }

    return configs;
  }

  private filterConfigsByName(configNames: string[]): BenchmarkConfig[] {
    const selected = [];
    for (const name of configNames) {
      const config = BENCHMARK_CONFIGS.find((c) => c.name === name);
      if (config) {
        selected.push(config);
      } else {
        console.warn(`⚠️  Unknown config: ${name}`);
      }
    }
    return selected.length > 0 ? selected : BENCHMARK_CONFIGS;
  }

  private getDifficultyName(difficulty: number): string {
    for (const [name, value] of Object.entries(DIFFICULTY_PRESETS)) {
      if (value === difficulty) return name;
    }
    return `${difficulty}x`;
  }

  /**
   * Show system information
   */
  private showSystemInfo(): void {
    const cpuCount = cpus().length;
    const totalMemGB = Math.round(totalmem() / 1024 / 1024 / 1024);
    const cpuModel = cpus()[0]?.model || "Unknown";

    console.log("🔥 Workalot Benchmark Suite");
    console.log("============================");
    console.log(`System: ${platform()} ${arch()}`);
    console.log(`CPU: ${cpuModel}`);
    console.log(`CPU Cores: ${cpuCount}`);
    console.log(`Memory: ${totalMemGB}GB`);
    console.log(`Node.js: ${process.version}`);
    console.log("");
  }

  /**
   * Parse difficulty setting
   */
  private parseDifficulty(difficultyStr?: string): number {
    if (!difficultyStr) return 1.0;

    // Check if it's a preset name
    if (difficultyStr in DIFFICULTY_PRESETS) {
      return DIFFICULTY_PRESETS[difficultyStr as DifficultyLevel];
    }

    // Try to parse as number
    const numValue = parseFloat(difficultyStr);
    if (isNaN(numValue) || numValue <= 0) {
      console.warn(`⚠️  Invalid difficulty value: ${difficultyStr}. Using normal difficulty.`);
      return 1.0;
    }

    return numValue;
  }

  /**
   * Show help information
   */
  private showHelp(): void {
    const difficultyOptions = Object.entries(DIFFICULTY_PRESETS)
      .map(([name, value]) => `    ${name.padEnd(8)} - ${value}x CPU cycles`)
      .join("\n");

    console.log(`
Workalot Benchmark Suite

Usage: bun run benchmarks/run-benchmarks.ts [options]

Options:
  -h, --help                Show this help message
  -c, --configs <names>     Comma-separated list of config names to run
  -a, --all                 Run ALL available benchmark configurations
  -o, --output <dir>        Output directory for results (default: benchmarks/results)
  -d, --difficulty <level>  Difficulty level or multiplier for CPU cycles
  -t, --timeout <seconds>   Timeout for each benchmark in seconds (default: 300)

Difficulty levels:
${difficultyOptions}
  Or specify a custom multiplier (e.g., 2.5)

Available configurations:
${BENCHMARK_CONFIGS.map((c) => `  - ${c.name} (${c.cores} cores, ${c.totalJobs.toLocaleString()} jobs)`).join("\n")}

Examples:
  bun run benchmarks/run-benchmarks.ts
  bun run benchmarks/run-benchmarks.ts --configs 2-cores-1k-jobs-sqlite-memory,4-cores-1k-jobs-sqlite-memory
  bun run benchmarks/run-benchmarks.ts --all --difficulty easy
  bun run benchmarks/run-benchmarks.ts --all --difficulty 2.5 --output ./my-results
  bun run benchmarks/run-benchmarks.ts --difficulty easy
`);
  }

  /**
   * Show benchmark summary
   */
  private showSummary(results: any[]): void {
    console.log("\n📊 Benchmark Summary:");
    console.log("=====================");

    results.forEach((result) => {
      const jobDistribution = result.executionPhase.workerStats
        .map((w: any) => w.jobsProcessed)
        .join(":");
      const avgUtilization =
        result.executionPhase.workerStats.reduce(
          (sum: number, w: any) => sum + w.utilizationPercentage,
          0,
        ) / result.executionPhase.workerStats.length;

      console.log(`\n${result.config.name}:`);
      console.log(`  Throughput: ${result.jobsPerSecond.toFixed(2)} jobs/sec`);
      console.log(`  Total time: ${(result.totalTime / 1000).toFixed(2)}s`);
      console.log(`  Peak CPU: ${result.executionPhase.peakCPU.toFixed(1)}%`);
      console.log(
        `  Peak Memory: ${(result.executionPhase.peakMemory / 1024 / 1024).toFixed(1)} MB`,
      );
      console.log(`  Worker distribution: ${jobDistribution}`);
      console.log(`  Average utilization: ${avgUtilization.toFixed(1)}%`);
    });
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new BenchmarkCLI();
  cli.run(process.argv.slice(2)).catch((error) => {
    console.error("❌ Benchmark suite failed:", error);
    process.exit(1);
  });
}
