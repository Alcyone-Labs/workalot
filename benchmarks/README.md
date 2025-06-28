# Workalot Benchmark Suite

A comprehensive benchmarking system for the Workalot job queue library that measures performance across different configurations and workloads.

## Features

- **Neat CLI Interface**: Clean progress bars, system info display, silent worker mode
- **Difficulty Scaling**: Adjustable CPU workload intensity with presets and custom multipliers
- **File-based Logging**: Detailed timestamped logs with structured JSON data
- **Performance Optimized**: Real-time progress tracking
- **Real-time Monitoring**: CPU and memory usage during queueing and execution phases
- **Comprehensive Metrics**: Throughput, latency, resource utilization, worker distribution
- **Multiple Export Formats**: JSON, CSV, and visualization-ready data
- **Interactive Visualizations**: Observable Plot charts for performance analysis

## Quick Start

### System Information Display

The benchmark suite automatically displays your system information:

```
🔥 Workalot Benchmark Suite
============================
System: darwin arm64
CPU: Apple M2 Max
CPU Cores: 12
Memory: 64GB
Node.js: v22.6.0
```

### Run All Benchmarks

```bash
# Build the project first (if running via NodeJS)
pnpm run build

# Run all benchmark configurations
bun run benchmarks/run-benchmarks.ts
```

### Run with Difficulty Scaling

```bash
# Run with easy difficulty (0.1x CPU cycles)
bun run benchmarks/run-benchmarks.ts --difficulty easy

# Run with custom difficulty multiplier
bun run benchmarks/run-benchmarks.ts --difficulty 2.5

# Available presets: easy (0.1x), normal (1.0x), hard (5.0x), extreme (10.0x)
```

### Run Specific Benchmarks

```bash
# Run only specific configurations
bun run benchmarks/run-benchmarks.ts --configs 2-cores-10k-jobs,4-cores-10k-jobs

# Combine with difficulty and custom output
bun run benchmarks/run-benchmarks.ts --configs 2-cores-10k-jobs --difficulty easy --output ./my-results
```

### View Results

**Console Output**: Clean progress bars with real-time metrics:

```
Queueing Jobs |████████████████████████████████████████| 100% | 10000/10000 jobs | ETA: 0s
Executing Jobs |██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░| 25% | 2536/10000 jobs | Rate: 24 jobs/s | ETA: 312s
```

**Detailed Logs**: Timestamped files in `benchmarks/logs/`:

- System information and configuration
- Structured JSON logging with performance metrics
- Difficulty scaling details and progress tracking

**Visualization**:

1. Open `benchmarks/visualize-results.html` in your browser
2. Load the `visualization-data.json` file from your results directory
3. Explore interactive charts and performance metrics

## Benchmark Configurations

The default benchmark suite includes:

| Configuration       | Cores | Jobs      | Description           |
| ------------------- | ----- | --------- | --------------------- |
| `2-cores-10k-jobs`  | 2     | 10,000    | Baseline performance  |
| `4-cores-10k-jobs`  | 4     | 10,000    | Standard workload     |
| `4-cores-100k-jobs` | 4     | 100,000   | High volume test      |
| `6-cores-10k-jobs`  | 6     | 10,000    | Multi-core scaling    |
| `6-cores-100k-jobs` | 6     | 100,000   | High-performance test |
| `6-cores-1m-jobs`   | 6     | 1,000,000 | Stress test           |

## Task Types & Difficulty Scaling

Jobs are distributed across different CPU-intensive task types:

- **Light** (30%): 1,000 CPU cycles - Quick operations
- **Medium** (40%): 10,000 CPU cycles - Standard processing
- **Heavy** (20%): 50,000 CPU cycles - Complex calculations
- **Intensive** (10%): 100,000 CPU cycles - Heavy computation

### Difficulty Scaling

The difficulty system scales CPU cycles for all task types:

| Difficulty | Multiplier | Light Cycles | Medium Cycles | Heavy Cycles | Intensive Cycles |
| ---------- | ---------- | ------------ | ------------- | ------------ | ---------------- |
| `easy`     | 0.1x       | 100          | 1,000         | 5,000        | 10,000           |
| `normal`   | 1.0x       | 1,000        | 10,000        | 50,000       | 100,000          |
| `hard`     | 5.0x       | 5,000        | 50,000        | 250,000      | 500,000          |
| `extreme`  | 10.0x      | 10,000       | 100,000       | 500,000      | 1,000,000        |

Custom multipliers are also supported (e.g., `--difficulty 2.5`).

## Metrics Collected

### Performance Metrics

- **Throughput**: Jobs processed per second
- **Total Time**: End-to-end benchmark duration
- **Queueing Time**: Time to queue all jobs
- **Execution Time**: Time to process all jobs

### Resource Metrics

- **CPU Usage**: Real-time CPU utilization (%)
- **Memory Usage**: Heap, RSS, and external memory (bytes)
- **Peak Values**: Maximum resource usage during execution
- **Average Values**: Mean resource usage over time

## Output Files

### Results Directory (`benchmarks/results/` or custom)

- `{config-name}-{timestamp}.json` - Individual benchmark results
- `benchmark-summary.json` - Summary of all benchmarks
- `benchmark-results.csv` - CSV data for analysis
- `visualization-data.json` - Data formatted for charts

### Logs Directory (`benchmarks/logs/`)

- `benchmark-{timestamp}.log` - Detailed execution logs with:
  - System information and configuration
  - Structured JSON logging with timestamps
  - Performance metrics and progress tracking
  - Difficulty scaling details
  - Worker activity and system stats

Example log entry:

```json
[2025-06-21T10:20:11.064Z] +12ms INFO BENCHMARK Starting benchmark: 2-cores-10k-jobs-easy
{
  "cores": 2,
  "totalJobs": 10000,
  "backend": "pglite",
  "difficulty": 0.1
}
```

## Customization

### Adding New Configurations

Edit `benchmarks/benchmark-config.ts`:

```typescript
export const CUSTOM_CONFIGS: BenchmarkConfig[] = [
  {
    name: "my-custom-test",
    cores: 8,
    totalJobs: 50000,
    taskTypes: [{ name: "custom", cpuCycles: 25000, weight: 1.0 }],
    backend: "pglite",
    databaseUrl: "memory://",
  },
];
```

### Creating Custom Task Types

Modify the `BenchmarkJob.ts` or create new job classes:

```typescript
export class CustomBenchmarkJob extends BaseJob {
  async run(payload: any): Promise<any> {
    // Your custom CPU-intensive work
    await this.customWork(payload.complexity);
    return this.createSuccessResult({ completed: true });
  }
}
```

### Custom Monitoring

Extend the `PerformanceMonitor` class for additional metrics:

```typescript
class ExtendedMonitor extends PerformanceMonitor {
  measureCustomMetric() {
    // Add your custom performance measurements
  }
}
```

## CLI Options

```bash
Usage: bun run benchmarks/run-benchmarks.ts [options]

Options:
  -h, --help                Show help message
  -c, --configs <names>     Comma-separated list of config names
  -o, --output <dir>        Output directory for results
  -d, --difficulty <level>  Difficulty level or multiplier for CPU cycles

Difficulty levels:
    easy     - 0.1x CPU cycles
    normal   - 1.0x CPU cycles
    hard     - 5.0x CPU cycles
    extreme  - 10.0x CPU cycles
  Or specify a custom multiplier (e.g., 2.5)

Examples:
  bun run benchmarks/run-benchmarks.ts
  bun run benchmarks/run-benchmarks.ts --configs 2-cores-10k-jobs,4-cores-10k-jobs
  bun run benchmarks/run-benchmarks.ts --difficulty easy
  bun run benchmarks/run-benchmarks.ts --difficulty 2.5 --output ./my-results
```

## Visualization Features

### Console Interface

- **System Information**: CPU cores, memory, OS details at startup
- **Real-time Progress Bars**: Clean progress display with rates and ETAs
- **Silent Worker Mode**: No console spam from worker threads
- **Summary Statistics**: Quick performance overview after completion

### HTML Visualization

The interactive HTML visualization provides:

- **Summary Statistics**: Key performance indicators
- **Throughput Charts**: Jobs/second by configuration
- **Time Breakdown**: Queueing vs execution phases
- **Resource Usage**: CPU and memory over time
- **Scalability Analysis**: Performance vs core count
- **Difficulty Comparison**: Performance across different difficulty levels

## Good Practices

1. **System Preparation**: Close unnecessary applications before benchmarking
2. **Difficulty Selection**: Start with `easy` for quick tests, use `normal` for realistic workloads
3. **Multiple Runs**: Run benchmarks multiple times for consistency
4. **Log Analysis**: Review detailed logs in `benchmarks/logs/` for troubleshooting
5. **Resource Monitoring**: Monitor system resources during execution
6. **Result Analysis**: Compare results across different configurations and difficulty levels
7. **Environment Consistency**: Use the same system configuration for comparisons

## Troubleshooting

### Common Issues

- **Memory Errors**: Reduce job count or increase system memory
- **Timeout Errors**: Increase job timeout in configuration
- **Worker Errors**: Check worker thread limits and system resources

### Performance Tips

- Use `pglite` backend with `memory://` for fast performance
- Start with `easy` difficulty for quick validation, then scale up
- Use file logging (automatic) instead of console output for better performance
- Adjust monitoring intervals based on benchmark duration
- Consider system thermal throttling for long-running tests
- Monitor log files in real-time: `tail -f benchmarks/logs/benchmark-*.log`

## Logging System

The benchmark suite includes a comprehensive logging system:

### Features

- **Timestamped Files**: Each run creates a unique log file
- **Structured JSON**: Machine-readable log entries with metadata
- **Performance Tracking**: Real-time system stats and progress
- **Silent Workers**: Clean console output with detailed file logging
- **Debugging Support**: Comprehensive error tracking and worker activity

### Log Categories

- `CLI`: Command-line interface events
- `BENCHMARK`: Benchmark lifecycle events
- `SETUP`: Task manager initialization
- `PHASE`: Queueing and execution phases
- `JOBS`: Job generation and distribution
- `WORKER`: Worker thread activity
- `SYSTEM`: Performance metrics and stats
- `PROGRESS`: Execution progress updates

## Integration

The benchmark system integrates with:

- **CI/CD**: Automated performance regression testing with detailed logs
- **Monitoring**: Export metrics to monitoring systems from JSON logs
- **Analysis**: Import CSV data and log files into analysis tools
- **Reporting**: Generate performance reports from JSON data and logs
- **Debugging**: Comprehensive logging for troubleshooting performance issues
