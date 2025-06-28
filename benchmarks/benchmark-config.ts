export interface BenchmarkConfig {
  name: string;
  cores: number;
  totalJobs: number;
  taskTypes: TaskType[];
  backend: 'memory' | 'sqlite' | 'pglite' | 'postgresql';
  databaseUrl?: string;
  difficulty?: number; // Multiplier for CPU cycles (1 = normal, 0.1 = easy, 10 = hard)
}

export interface TaskType {
  name: string;
  cpuCycles: number;
  weight: number; // Relative frequency (0-1)
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  queueingPhase: PhaseResult;
  executionPhase: PhaseResult;
  totalTime: number;
  jobsPerSecond: number;
  timestamp: string;
}

export interface PhaseResult {
  duration: number;
  cpuUsage: CPUMeasurement[];
  memoryUsage: MemoryMeasurement[];
  peakCPU: number;
  peakMemory: number;
  averageCPU: number;
  averageMemory: number;
  workerStats: WorkerStats[];
}

export interface WorkerStats {
  workerId: number;
  jobsProcessed: number;
  totalExecutionTime: number;
  averageJobTime: number;
  idleTime: number;
  utilizationPercentage: number;
}

export interface CPUMeasurement {
  timestamp: number;
  usage: number; // Percentage
}

export interface MemoryMeasurement {
  timestamp: number;
  heapUsed: number; // Bytes
  heapTotal: number; // Bytes
  external: number; // Bytes
  rss: number; // Bytes
}

export const DEFAULT_TASK_TYPES: TaskType[] = [
  { name: 'light', cpuCycles: 1000, weight: 0.3 },
  { name: 'medium', cpuCycles: 10000, weight: 0.4 },
  { name: 'heavy', cpuCycles: 50000, weight: 0.2 },
  { name: 'intensive', cpuCycles: 100000, weight: 0.1 }
];

export const DIFFICULTY_PRESETS = {
  'easy': 0.5,
  'normal': 1.0,
  'hard': 2.0,
  'extreme': 5.0
} as const;

export type DifficultyLevel = keyof typeof DIFFICULTY_PRESETS;

export function scaleTaskTypes(taskTypes: TaskType[], difficulty: number): TaskType[] {
  return taskTypes.map(taskType => ({
    ...taskType,
    cpuCycles: Math.max(50000, Math.round(taskType.cpuCycles * difficulty))
  }));
}

export const BENCHMARK_CONFIGS: BenchmarkConfig[] = [
  {
    name: '2-cores-1k-jobs-memory',
    cores: 2,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'memory'
  },
  {
    name: '4-cores-1k-jobs-memory',
    cores: 4,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'memory'
  },
  {
    name: '6-cores-1k-jobs-memory',
    cores: 6,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'memory'
  },
  {
    name: '2-cores-10k-jobs-memory',
    cores: 2,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'memory'
  },
  {
    name: '4-cores-10k-jobs-memory',
    cores: 4,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'memory'
  },
  {
    name: '6-cores-10k-jobs-memory',
    cores: 6,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'memory'
  },
  {
    name: '2-cores-1k-jobs-pglite',
    cores: 2,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: 'memory://'
  },
  {
    name: '4-cores-1k-jobs-pglite',
    cores: 4,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: 'memory://'
  },
  {
    name: '6-cores-1k-jobs-pglite',
    cores: 6,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: 'memory://'
  },
    {
    name: '2-cores-1k-jobs-pglite-file',
    cores: 2,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: './benchmarks/pglite-2cores-1k.db'
  },
  {
    name: '4-cores-1k-jobs-pglite-file',
    cores: 4,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: './benchmarks/pglite-4cores-1k.db'
  },
  {
    name: '6-cores-1k-jobs-pglite-file',
    cores: 6,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: './benchmarks/pglite-6cores-1k.db'
  },
  {
    name: '2-cores-10k-jobs-pglite',
    cores: 2,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: 'memory://'
  },
  {
    name: '4-cores-10k-jobs-pglite',
    cores: 4,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: 'memory://'
  },
  {
    name: '6-cores-10k-jobs-pglite',
    cores: 6,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: 'memory://'
  },
    {
    name: '2-cores-10k-jobs-pglite-file',
    cores: 2,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: './benchmarks/pglite-2cores-10k.db'
  },
  {
    name: '4-cores-10k-jobs-pglite-file',
    cores: 4,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: './benchmarks/pglite-4cores-10k.db'
  },
  {
    name: '6-cores-10k-jobs-pglite-file',
    cores: 6,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'pglite',
    databaseUrl: './benchmarks/pglite-6cores-10k.db'
  },
  // SQLite In-Memory Benchmarks (1k jobs)
  {
    name: '2-cores-1k-jobs-sqlite-memory',
    cores: 2,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: 'memory://'
  },
  {
    name: '4-cores-1k-jobs-sqlite-memory',
    cores: 4,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: 'memory://'
  },
  {
    name: '6-cores-1k-jobs-sqlite-memory',
    cores: 6,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: 'memory://'
  },
  // SQLite File-Based Benchmarks (1k jobs)
  {
    name: '2-cores-1k-jobs-sqlite-file',
    cores: 2,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: './benchmarks/sqlite-benchmark.db'
  },
  {
    name: '4-cores-1k-jobs-sqlite-file',
    cores: 4,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: './benchmarks/sqlite-benchmark.db'
  },
  {
    name: '6-cores-1k-jobs-sqlite-file',
    cores: 6,
    totalJobs: 1000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: './benchmarks/sqlite-benchmark.db'
  },
  // SQLite In-Memory Benchmarks (10k jobs)
  {
    name: '2-cores-10k-jobs-sqlite-memory',
    cores: 2,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: 'memory://'
  },
  {
    name: '4-cores-10k-jobs-sqlite-memory',
    cores: 4,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: 'memory://'
  },
  {
    name: '6-cores-10k-jobs-sqlite-memory',
    cores: 6,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: 'memory://'
  },
  // SQLite File-Based Benchmarks (10k jobs)
  {
    name: '2-cores-10k-jobs-sqlite-file',
    cores: 2,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: './benchmarks/sqlite-benchmark.db'
  },
  {
    name: '4-cores-10k-jobs-sqlite-file',
    cores: 4,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: './benchmarks/sqlite-benchmark.db'
  },
  {
    name: '6-cores-10k-jobs-sqlite-file',
    cores: 6,
    totalJobs: 10000,
    taskTypes: DEFAULT_TASK_TYPES,
    backend: 'sqlite',
    databaseUrl: './benchmarks/sqlite-benchmark.db'
  },
];
