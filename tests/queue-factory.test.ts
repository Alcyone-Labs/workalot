import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  QueueFactory,
  createQueue,
  createPGLiteQueue,
  createSQLiteQueue,
  createRedisQueue,
  createAutoQueue,
} from '../src/queue/QueueFactory.js';
import { QueueManager } from '../src/queue/QueueManager.js';
import { PGLiteQueue } from '../src/queue/PGLiteQueue.js';
import { SQLiteQueue } from '../src/queue/SQLiteQueue.js';
import { QueueConfig } from '../src/types/index.js';

describe('QueueFactory', () => {
  describe('createQueue', () => {
    it('should create memory queue with default config', () => {
      const queue = QueueFactory.createQueue();
      expect(queue).toBeInstanceOf(QueueManager);
    });

    it('should create memory queue with explicit backend', () => {
      const queue = QueueFactory.createQueue({ backend: 'memory' });
      expect(queue).toBeInstanceOf(QueueManager);
    });

    it('should create PGLite queue', () => {
      const queue = QueueFactory.createQueue({
        backend: 'pglite',
        databaseUrl: 'memory://',
      });
      expect(queue).toBeInstanceOf(PGLiteQueue);
    });

    it('should create SQLite queue', () => {
      const queue = QueueFactory.createQueue({
        backend: 'sqlite',
        databaseUrl: 'memory://',
      });
      expect(queue).toBeInstanceOf(SQLiteQueue);
    });

    it('should throw for unsupported backend', () => {
      expect(() => {
        QueueFactory.createQueue({ backend: 'unsupported' as any });
      }).toThrow('Unsupported queue backend: unsupported');
    });

    it('should throw for postgresql without connection string', () => {
      // Validate config should throw before creating queue
      expect(() => {
        QueueFactory.validateConfig({ backend: 'postgresql' });
      }).toThrow('databaseUrl is required');
    });

    it('should create PostgreSQL queue with connection string', () => {
      const queue = QueueFactory.createQueue({
        backend: 'postgresql',
        databaseUrl: 'postgres://localhost/test',
      });
      expect(queue).toBeDefined();
    });

    it('should create Redis queue with redis URL', () => {
      const queue = QueueFactory.createQueue({
        backend: 'redis',
        databaseUrl: 'redis://localhost:6379',
      });
      expect(queue).toBeDefined();
    });
  });

  describe('createPGLiteQueue', () => {
    it('should create PGLite queue with defaults', () => {
      const queue = QueueFactory.createPGLiteQueue();
      expect(queue).toBeInstanceOf(PGLiteQueue);
    });

    it('should create PGLite queue with custom config', () => {
      const queue = QueueFactory.createPGLiteQueue({
        databaseUrl: 'memory://',
        debug: true,
      });
      expect(queue).toBeInstanceOf(PGLiteQueue);
    });
  });

  describe('createSQLiteQueue', () => {
    it('should create SQLite queue with defaults', () => {
      const queue = QueueFactory.createSQLiteQueue();
      expect(queue).toBeInstanceOf(SQLiteQueue);
    });

    it('should create SQLite queue with custom config', () => {
      const queue = QueueFactory.createSQLiteQueue({
        databaseUrl: 'memory://',
        enableWAL: true,
        debug: true,
      });
      expect(queue).toBeInstanceOf(SQLiteQueue);
    });
  });

  describe('createRedisQueue', () => {
    it('should create Redis queue with defaults', () => {
      const queue = QueueFactory.createRedisQueue();
      expect(queue).toBeDefined();
    });

    it('should create Redis queue with custom config', () => {
      const queue = QueueFactory.createRedisQueue({
        redisUrl: 'redis://localhost:6379',
        keyPrefix: 'test-',
        completedJobTTL: 60,
      });
      expect(queue).toBeDefined();
    });
  });

  describe('createMemoryQueue', () => {
    it('should create memory queue', () => {
      const queue = QueueFactory.createMemoryQueue();
      expect(queue).toBeInstanceOf(QueueManager);
    });

    it('should create memory queue with custom config', () => {
      const queue = QueueFactory.createMemoryQueue({
        maxThreads: 4,
        maxInMemoryAge: 60000,
      });
      expect(queue).toBeInstanceOf(QueueManager);
    });
  });

  describe('getRecommendedConfig', () => {
    it('should return development config', () => {
      const config = QueueFactory.getRecommendedConfig('development');

      expect(config.backend).toBe('sqlite');
      expect(config.maxThreads).toBe(2);
      expect(config.maxInMemoryAge).toBe(3600000);
      expect(config.healthCheckInterval).toBe(10000);
    });

    it('should return testing config', () => {
      const config = QueueFactory.getRecommendedConfig('testing');

      expect(config.backend).toBe('sqlite');
      expect(config.databaseUrl).toBe('memory://');
      expect(config.maxThreads).toBe(1);
      expect(config.healthCheckInterval).toBe(1000);
    });

    it('should return production config', () => {
      const config = QueueFactory.getRecommendedConfig('production');

      expect(config.backend).toBe('postgresql');
      expect(config.maxThreads).toBeGreaterThanOrEqual(2);
      expect(config.maxInMemoryAge).toBe(86400000);
      expect(config.healthCheckInterval).toBe(30000);
    });

    it('should throw for unknown environment', () => {
      expect(() => {
        QueueFactory.getRecommendedConfig('unknown' as any);
      }).toThrow('Unknown environment: unknown');
    });
  });

  describe('validateConfig', () => {
    it('should throw for maxThreads less than 1', () => {
      expect(() => {
        QueueFactory.validateConfig({ maxThreads: 0 });
      }).toThrow('maxThreads must be at least 1');
    });

    it('should throw for maxInMemoryAge less than 1000', () => {
      expect(() => {
        QueueFactory.validateConfig({ maxInMemoryAge: 500 });
      }).toThrow('maxInMemoryAge must be at least 1000ms');
    });

    it('should throw for healthCheckInterval less than 100', () => {
      expect(() => {
        QueueFactory.validateConfig({ healthCheckInterval: 50 });
      }).toThrow('healthCheckInterval must be at least 100ms');
    });

    it('should throw for missing databaseUrl with pglite', () => {
      expect(() => {
        QueueFactory.validateConfig({ backend: 'pglite' });
      }).toThrow('databaseUrl is required for pglite');
    });

    it('should throw for missing databaseUrl with postgresql', () => {
      expect(() => {
        QueueFactory.validateConfig({ backend: 'postgresql' });
      }).toThrow('databaseUrl is required for postgresql');
    });

    it('should throw for missing databaseUrl with sqlite', () => {
      expect(() => {
        QueueFactory.validateConfig({ backend: 'sqlite' });
      }).toThrow('databaseUrl is required for sqlite');
    });

    it('should not throw for valid config', () => {
      expect(() => {
        QueueFactory.validateConfig({
          backend: 'memory',
          maxThreads: 4,
          maxInMemoryAge: 60000,
          healthCheckInterval: 1000,
        });
      }).not.toThrow();
    });

    it('should not throw for pglite with databaseUrl', () => {
      expect(() => {
        QueueFactory.validateConfig({
          backend: 'pglite',
          databaseUrl: 'memory://',
        });
      }).not.toThrow();
    });
  });

  describe('createAutoQueue', () => {
    it('should use SQLite for test environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const queue = QueueFactory.createAutoQueue();
      expect(queue).toBeInstanceOf(SQLiteQueue);

      process.env.NODE_ENV = originalEnv;
    });

    it('should use PostgreSQL when DATABASE_URL is set', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalDbUrl = process.env.DATABASE_URL;

      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://localhost/test';

      const queue = QueueFactory.createAutoQueue();
      expect(queue).toBeDefined();

      process.env.NODE_ENV = originalEnv;
      if (originalDbUrl !== undefined) {
        process.env.DATABASE_URL = originalDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    });

    it('should use SQLite with file path for other environments', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalDbUrl = process.env.DATABASE_URL;

      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;

      const queue = QueueFactory.createAutoQueue();
      expect(queue).toBeInstanceOf(SQLiteQueue);

      process.env.NODE_ENV = originalEnv;
      if (originalDbUrl !== undefined) {
        process.env.DATABASE_URL = originalDbUrl;
      }
    });

    it('should respect explicit backend config', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const queue = QueueFactory.createAutoQueue({ backend: 'memory' });
      expect(queue).toBeInstanceOf(QueueManager);

      process.env.NODE_ENV = originalEnv;
    });

    it('should validate config before creating queue', () => {
      expect(() => {
        QueueFactory.createAutoQueue({ maxThreads: 0 });
      }).toThrow('maxThreads must be at least 1');
    });
  });
});

describe('Convenience Functions', () => {
  describe('createQueue', () => {
    it('should create a queue', () => {
      const queue = createQueue();
      expect(queue).toBeInstanceOf(QueueManager);
    });
  });

  describe('createPGLiteQueue', () => {
    it('should create a PGLite queue', () => {
      const queue = createPGLiteQueue();
      expect(queue).toBeInstanceOf(PGLiteQueue);
    });
  });

  describe('createSQLiteQueue', () => {
    it('should create a SQLite queue', () => {
      const queue = createSQLiteQueue();
      expect(queue).toBeInstanceOf(SQLiteQueue);
    });
  });

  describe('createRedisQueue', () => {
    it('should create a Redis queue', () => {
      const queue = createRedisQueue();
      expect(queue).toBeDefined();
    });
  });

  describe('createAutoQueue', () => {
    it('should create an auto-configured queue', () => {
      const queue = createAutoQueue();
      expect(queue).toBeDefined();
    });
  });
});

describe('QueueFactory Edge Cases', () => {
  it('should merge default config with provided config', () => {
    const queue = QueueFactory.createQueue({
      maxThreads: 8,
      backend: 'memory',
    });

    expect(queue).toBeDefined();
  });

  it('should handle config with all options', () => {
    const config: QueueConfig = {
      backend: 'memory',
      maxThreads: 4,
      maxInMemoryAge: 120000,
      healthCheckInterval: 5000,
      silent: true,
    };

    const queue = QueueFactory.createQueue(config);
    expect(queue).toBeDefined();
  });

  it('should handle partial PGLite config', () => {
    const queue = QueueFactory.createQueue({
      backend: 'pglite',
      databaseUrl: 'memory://',
    });

    expect(queue).toBeInstanceOf(PGLiteQueue);
  });

  it('should handle partial SQLite config', () => {
    const queue = QueueFactory.createQueue({
      backend: 'sqlite',
      databaseUrl: 'memory://',
    });

    expect(queue).toBeInstanceOf(SQLiteQueue);
  });
});
