import { cpus } from 'node:os';
import { QueueConfig } from '../types/index.js';
import { IQueueBackend } from './IQueueBackend.js';
import { QueueManager } from './QueueManager.js';
import { PGLiteQueue, PGLiteQueueConfig } from './PGLiteQueue.js';
import { SQLiteQueue, SQLiteQueueConfig } from './SQLiteQueue.js';
import { PostgreSQLQueue } from './PostgreSQLQueue.js';

/**
 * Factory for creating queue backends based on configuration
 */
export class QueueFactory {
  /**
   * Create a queue backend based on the configuration
   */
  static createQueue(config: QueueConfig = {}): IQueueBackend {
    const backend = config.backend || 'memory';

    switch (backend) {
      case 'memory':
        return new QueueManager(config);

      case 'pglite':
        const pgliteConfig: PGLiteQueueConfig = {
          ...config,
          databaseUrl: config.databaseUrl || 'memory://',
        };
        return new PGLiteQueue(pgliteConfig);

      case 'sqlite':
        const sqliteConfig: SQLiteQueueConfig = {
          ...config,
          databaseUrl: config.databaseUrl || 'memory://',
        };
        return new SQLiteQueue(sqliteConfig);

      case 'postgresql':
        // For now, use the stub PostgreSQL implementation
        // In the future, this could be a full PostgreSQL implementation
        return new PostgreSQLQueue(config);

      default:
        throw new Error(`Unsupported queue backend: ${backend}`);
    }
  }

  /**
   * Create a PGLite queue with specific configuration
   */
  static createPGLiteQueue(config: PGLiteQueueConfig = {}): PGLiteQueue {
    return new PGLiteQueue(config);
  }

  /**
   * Create a SQLite queue with specific configuration
   */
  static createSQLiteQueue(config: SQLiteQueueConfig = {}): SQLiteQueue {
    return new SQLiteQueue(config);
  }

  /**
   * Create an in-memory queue
   */
  static createMemoryQueue(config: QueueConfig = {}): QueueManager {
    return new QueueManager(config);
  }

  /**
   * Get recommended configuration for different environments
   */
  static getRecommendedConfig(environment: 'development' | 'testing' | 'production'): QueueConfig {
    switch (environment) {
      case 'development':
        return {
          backend: 'sqlite',
          databaseUrl: './data/dev-queue.db',
          maxThreads: 2,
          maxInMemoryAge: 60 * 60 * 1000, // 1 hour
          healthCheckInterval: 10000, // 10 seconds
        };

      case 'testing':
        return {
          backend: 'sqlite',
          databaseUrl: 'memory://',
          maxThreads: 1,
          maxInMemoryAge: 5 * 60 * 1000, // 5 minutes
          healthCheckInterval: 1000, // 1 second
        };

      case 'production':
        return {
          backend: 'postgresql', // or 'sqlite' for smaller deployments
          databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost/queue',
          maxThreads: Math.max(2, cpus().length - 1),
          maxInMemoryAge: 24 * 60 * 60 * 1000, // 24 hours
          healthCheckInterval: 30000, // 30 seconds
        };

      default:
        throw new Error(`Unknown environment: ${environment}`);
    }
  }

  /**
   * Validate queue configuration
   */
  static validateConfig(config: QueueConfig): void {
    if (config.maxThreads !== undefined && config.maxThreads < 1) {
      throw new Error('maxThreads must be at least 1');
    }

    if (config.maxInMemoryAge !== undefined && config.maxInMemoryAge < 1000) {
      throw new Error('maxInMemoryAge must be at least 1000ms');
    }

    if (config.healthCheckInterval !== undefined && config.healthCheckInterval < 100) {
      throw new Error('healthCheckInterval must be at least 100ms');
    }

    if (config.backend === 'pglite' || config.backend === 'postgresql' || config.backend === 'sqlite') {
      if (!config.databaseUrl) {
        throw new Error(`databaseUrl is required for ${config.backend} backend`);
      }
    }
  }

  /**
   * Create a queue with automatic backend selection based on environment
   */
  static createAutoQueue(config: QueueConfig = {}): IQueueBackend {
    // Auto-select backend if not specified
    if (!config.backend) {
      if (process.env.NODE_ENV === 'test') {
        config.backend = 'sqlite';
        config.databaseUrl = config.databaseUrl || 'memory://';
      } else if (process.env.DATABASE_URL) {
        config.backend = 'postgresql';
        config.databaseUrl = config.databaseUrl || process.env.DATABASE_URL;
      } else {
        config.backend = 'sqlite';
        config.databaseUrl = config.databaseUrl || './data/queue.db';
      }
    }

    this.validateConfig(config);
    return this.createQueue(config);
  }
}

/**
 * Convenience function to create a queue backend
 */
export function createQueue(config: QueueConfig = {}): IQueueBackend {
  return QueueFactory.createQueue(config);
}

/**
 * Convenience function to create a PGLite queue
 */
export function createPGLiteQueue(config: PGLiteQueueConfig = {}): PGLiteQueue {
  return QueueFactory.createPGLiteQueue(config);
}

/**
 * Convenience function to create a SQLite queue
 */
export function createSQLiteQueue(config: SQLiteQueueConfig = {}): SQLiteQueue {
  return QueueFactory.createSQLiteQueue(config);
}

/**
 * Convenience function to create an auto-configured queue
 */
export function createAutoQueue(config: QueueConfig = {}): IQueueBackend {
  return QueueFactory.createAutoQueue(config);
}
