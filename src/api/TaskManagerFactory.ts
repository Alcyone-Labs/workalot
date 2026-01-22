import { TaskManager } from "./TaskManager.js";
import { QueueConfig } from "../types/index.js";

export interface TaskManagerInstance {
  manager: TaskManager;
  name: string;
  createdAt: Date;
  config: QueueConfig;
}

/**
 * Factory for creating and managing TaskManager instances
 *
 * This is an alternative to TaskManagerSingleton that provides:
 * - Multiple named instances
 * - Better testability (no global state)
 * - Explicit lifecycle management
 * - Instance pooling capabilities
 *
 * @example
 * ```typescript
 * // Create a factory
 * const factory = new TaskManagerFactory();
 *
 * // Create named instances
 * const mainQueue = await factory.create('main', { backend: 'sqlite' });
 * const priorityQueue = await factory.create('priority', { backend: 'memory' });
 *
 * // Get existing instance
 * const main = factory.get('main');
 *
 * // Cleanup
 * await factory.destroy('main');
 * await factory.destroyAll();
 * ```
 */
export class TaskManagerFactory {
  private instances = new Map<string, TaskManagerInstance>();
  private defaultConfig: QueueConfig;
  private defaultProjectRoot?: string;

  constructor(defaultConfig: QueueConfig = {}, defaultProjectRoot?: string) {
    this.defaultConfig = defaultConfig;
    this.defaultProjectRoot = defaultProjectRoot;
  }

  /**
   * Create a new TaskManager instance
   *
   * @param name - Unique name for this instance
   * @param config - Configuration to merge with defaults
   * @param projectRoot - Project root directory
   * @returns Initialized TaskManager instance
   * @throws Error if instance with same name already exists
   */
  async create(
    name: string = "default",
    config: QueueConfig = {},
    projectRoot?: string,
  ): Promise<TaskManager> {
    if (this.instances.has(name)) {
      throw new Error(
        `TaskManager instance '${name}' already exists. Use get() or destroy it first.`,
      );
    }

    // Merge configurations
    const mergedConfig = {
      ...this.defaultConfig,
      ...config,
    };

    // Create and initialize the manager
    const manager = new TaskManager(mergedConfig, projectRoot || this.defaultProjectRoot);

    await manager.initialize();

    // Store instance
    const instance: TaskManagerInstance = {
      manager,
      name,
      createdAt: new Date(),
      config: mergedConfig,
    };

    this.instances.set(name, instance);

    return manager;
  }

  /**
   * Create or get an existing TaskManager instance
   *
   * @param name - Unique name for this instance
   * @param config - Configuration to use if creating new instance
   * @param projectRoot - Project root directory
   * @returns TaskManager instance
   */
  async getOrCreate(
    name: string = "default",
    config: QueueConfig = {},
    projectRoot?: string,
  ): Promise<TaskManager> {
    const existing = this.get(name);
    if (existing) {
      return existing;
    }

    return await this.create(name, config, projectRoot);
  }

  /**
   * Get an existing TaskManager instance
   *
   * @param name - Name of the instance
   * @returns TaskManager instance or undefined if not found
   */
  get(name: string = "default"): TaskManager | undefined {
    return this.instances.get(name)?.manager;
  }

  /**
   * Get information about an instance
   *
   * @param name - Name of the instance
   * @returns Instance information or undefined if not found
   */
  getInfo(name: string): TaskManagerInstance | undefined {
    return this.instances.get(name);
  }

  /**
   * Check if an instance exists
   *
   * @param name - Name of the instance
   * @returns True if instance exists
   */
  has(name: string): boolean {
    return this.instances.has(name);
  }

  /**
   * List all instance names
   *
   * @returns Array of instance names
   */
  list(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Get all instances
   *
   * @returns Map of all instances
   */
  getAll(): Map<string, TaskManagerInstance> {
    return new Map(this.instances);
  }

  /**
   * Destroy a specific TaskManager instance
   *
   * @param name - Name of the instance to destroy
   * @returns True if instance was destroyed, false if not found
   */
  async destroy(name: string): Promise<boolean> {
    const instance = this.instances.get(name);
    if (!instance) {
      return false;
    }

    await instance.manager.shutdown();
    this.instances.delete(name);
    return true;
  }

  /**
   * Destroy all TaskManager instances
   */
  async destroyAll(): Promise<void> {
    const shutdownPromises = Array.from(this.instances.values()).map((instance) =>
      instance.manager.shutdown(),
    );

    await Promise.all(shutdownPromises);
    this.instances.clear();
  }

  /**
   * Get statistics for all instances
   *
   * @returns Statistics for each instance
   */
  async getAllStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const [name, instance] of this.instances) {
      stats[name] = {
        createdAt: instance.createdAt,
        config: instance.config,
        status: await instance.manager.getStatus(),
        queueStats: await instance.manager.getQueueStats(),
        workerStats: await instance.manager.getWorkerStats(),
      };
    }

    return stats;
  }

  /**
   * Create a scoped factory with specific defaults
   *
   * @param scopeConfig - Default configuration for the scope
   * @param scopeProjectRoot - Default project root for the scope
   * @returns New factory instance with scoped defaults
   */
  createScope(scopeConfig: QueueConfig = {}, scopeProjectRoot?: string): TaskManagerFactory {
    const mergedConfig = {
      ...this.defaultConfig,
      ...scopeConfig,
    };

    return new TaskManagerFactory(mergedConfig, scopeProjectRoot || this.defaultProjectRoot);
  }

  /**
   * Wait for all instances to become idle
   *
   * @param timeoutMs - Maximum time to wait
   * @throws Error if timeout is exceeded
   */
  async waitForAllIdle(timeoutMs?: number): Promise<void> {
    const promises = Array.from(this.instances.values()).map((instance) =>
      instance.manager.whenIdle(timeoutMs),
    );

    await Promise.all(promises);
  }

  /**
   * Check if all instances are idle
   *
   * @returns True if all instances are idle
   */
  async areAllIdle(): Promise<boolean> {
    const idleChecks = await Promise.all(
      Array.from(this.instances.values()).map((instance) => instance.manager.isIdle()),
    );

    return idleChecks.every((idle) => idle);
  }

  /**
   * Get the number of instances
   *
   * @returns Number of active instances
   */
  size(): number {
    return this.instances.size;
  }

  /**
   * Clear all instances without shutting them down
   * Warning: This may cause resource leaks. Use destroyAll() instead.
   */
  clear(): void {
    this.instances.clear();
  }
}

/**
 * Create a pre-configured factory for common use cases
 */
export class TaskManagerFactoryPresets {
  /**
   * Create a factory optimized for development
   */
  static development(): TaskManagerFactory {
    return new TaskManagerFactory({
      backend: "memory",
      maxThreads: 2,
      silent: false,
      jobRecoveryEnabled: false,
    });
  }

  /**
   * Create a factory optimized for testing
   */
  static testing(): TaskManagerFactory {
    return new TaskManagerFactory({
      backend: "memory",
      maxThreads: 1,
      silent: true,
      jobRecoveryEnabled: false,
    });
  }

  /**
   * Create a factory optimized for production with SQLite
   */
  static productionSQLite(dbPath: string = "./queue.db"): TaskManagerFactory {
    return new TaskManagerFactory({
      backend: "sqlite",
      databaseUrl: dbPath,
      maxThreads: undefined, // Use system default
      silent: false,
      jobRecoveryEnabled: true,
      healthCheckInterval: 30000,
    });
  }

  /**
   * Create a factory optimized for production with PostgreSQL
   */
  static productionPostgreSQL(connectionString: string): TaskManagerFactory {
    return new TaskManagerFactory({
      backend: "postgresql",
      databaseUrl: connectionString,
      maxThreads: undefined, // Use system default
      silent: false,
      jobRecoveryEnabled: true,
      healthCheckInterval: 30000,
    });
  }

  /**
   * Create a factory for high-performance scenarios
   */
  static highPerformance(): TaskManagerFactory {
    return new TaskManagerFactory({
      backend: "memory",
      maxThreads: undefined, // Use all available cores
      silent: true,
      jobRecoveryEnabled: false,
      healthCheckInterval: 60000,
    });
  }
}

// Export a default factory instance for convenience
export const defaultFactory = new TaskManagerFactory();
