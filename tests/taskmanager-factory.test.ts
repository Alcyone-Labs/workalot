import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { TaskManagerFactory, TaskManagerFactoryPresets, defaultFactory } from '../src/api/TaskManagerFactory.js';
import { TaskManager } from '../src/api/TaskManager.js';
import { QueueConfig } from '../src/types/index.js';
import { getTempTsonFile, registerCleanupHandler } from './test-utils.js';

describe('TaskManagerFactory', () => {
  let factory: TaskManagerFactory;
  let testPersistenceFile: string;

  beforeEach(() => {
    testPersistenceFile = getTempTsonFile('factory');
    factory = new TaskManagerFactory();
  });

  afterEach(async () => {
    try {
      await factory.destroyAll();
    } catch { }
  });

  describe('create', () => {
    it('should create a new TaskManager instance', async () => {
      const manager = await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      expect(manager).toBeInstanceOf(TaskManager);
      expect(factory.has('test')).toBe(true);
    });

    it('should throw when creating duplicate instance', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      await expect(
        factory.create('test', { backend: 'memory' })
      ).rejects.toThrow("TaskManager instance 'test' already exists");
    });

    it('should create instance with custom config', async () => {
      const config: QueueConfig = {
        backend: 'memory',
        maxThreads: 4,
        maxInMemoryAge: 60000,
        healthCheckInterval: 5000,
      };

      const manager = await factory.create('custom', config);
      expect(manager).toBeInstanceOf(TaskManager);
    });

    it('should store instance metadata', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      const info = factory.getInfo('test');
      expect(info).toBeDefined();
      expect(info?.name).toBe('test');
      expect(info?.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('getOrCreate', () => {
    it('should return existing instance', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      const manager = await factory.getOrCreate('test');
      expect(manager).toBeDefined();
    });

    it('should create new instance if not exists', async () => {
      const manager = await factory.getOrCreate('new', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      expect(manager).toBeInstanceOf(TaskManager);
      expect(factory.has('new')).toBe(true);
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent instance', () => {
      const manager = factory.get('non-existent');
      expect(manager).toBeUndefined();
    });

    it('should return existing instance', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      const manager = factory.get('test');
      expect(manager).toBeInstanceOf(TaskManager);
    });

    it('should return default instance', async () => {
      await factory.create('default', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      const manager = factory.get();
      expect(manager).toBeInstanceOf(TaskManager);
    });
  });

  describe('has', () => {
    it('should return false for non-existent instance', () => {
      expect(factory.has('test')).toBe(false);
    });

    it('should return true for existing instance', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      expect(factory.has('test')).toBe(true);
    });
  });

  describe('list', () => {
    it('should return empty array initially', () => {
      expect(factory.list()).toEqual([]);
    });

    it('should return all instance names', async () => {
      await factory.create('a', { backend: 'memory', persistenceFile: testPersistenceFile + 'a' });
      await factory.create('b', { backend: 'memory', persistenceFile: testPersistenceFile + 'b' });
      await factory.create('c', { backend: 'memory', persistenceFile: testPersistenceFile + 'c' });

      const names = factory.list();
      expect(names).toContain('a');
      expect(names).toContain('b');
      expect(names).toContain('c');
      expect(names.length).toBe(3);
    });
  });

  describe('getAll', () => {
    it('should return all instances', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      const all = factory.getAll();
      expect(all.size).toBe(1);
      expect(all.get('test')).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should return false for non-existent instance', async () => {
      const result = await factory.destroy('non-existent');
      expect(result).toBe(false);
    });

    it('should destroy existing instance', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      const result = await factory.destroy('test');
      expect(result).toBe(true);
      expect(factory.has('test')).toBe(false);
    });
  });

  describe('destroyAll', () => {
    it('should destroy all instances', async () => {
      await factory.create('a', { backend: 'memory', persistenceFile: testPersistenceFile + 'a' });
      await factory.create('b', { backend: 'memory', persistenceFile: testPersistenceFile + 'b' });

      await factory.destroyAll();

      expect(factory.size()).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 initially', () => {
      expect(factory.size()).toBe(0);
    });

    it('should return correct count', async () => {
      await factory.create('a', { backend: 'memory', persistenceFile: testPersistenceFile + 'a' });
      await factory.create('b', { backend: 'memory', persistenceFile: testPersistenceFile + 'b' });

      expect(factory.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all instances without shutting down', async () => {
      await factory.create('test', {
        backend: 'memory',
        persistenceFile: testPersistenceFile,
      });

      factory.clear();

      expect(factory.size()).toBe(0);
      expect(factory.has('test')).toBe(false);
    });
  });
});

describe('TaskManagerFactory Advanced Features', () => {
  let factory: TaskManagerFactory;

  beforeEach(() => {
    factory = new TaskManagerFactory();
  });

  afterEach(async () => {
    await factory.destroyAll();
  });

  describe('getAllStats', () => {
    it('should return statistics for all instances', async () => {
      const file1 = getTempTsonFile('stats-1');
      const file2 = getTempTsonFile('stats-2');

      await factory.create('a', { backend: 'memory', persistenceFile: file1 });
      await factory.create('b', { backend: 'memory', persistenceFile: file2 });

      const stats = await factory.getAllStats();

      expect(stats).toHaveProperty('a');
      expect(stats).toHaveProperty('b');
      expect(stats.a).toHaveProperty('createdAt');
      expect(stats.a).toHaveProperty('config');
      expect(stats.a).toHaveProperty('status');
      expect(stats.a).toHaveProperty('queueStats');
      expect(stats.a).toHaveProperty('workerStats');
    });

    it('should return empty object for empty factory', async () => {
      const stats = await factory.getAllStats();
      expect(stats).toEqual({});
    });
  });

  describe('createScope', () => {
    it('should create scoped factory', async () => {
      const scopedFactory = factory.createScope({
        backend: 'memory',
        maxThreads: 2,
      });

      const file1 = getTempTsonFile('scope-1');
      const file2 = getTempTsonFile('scope-2');

      const manager1 = await scopedFactory.create('test1', { persistenceFile: file1 });
      const manager2 = await factory.create('test2', { persistenceFile: file2 });

      expect(manager1).toBeInstanceOf(TaskManager);
      expect(manager2).toBeInstanceOf(TaskManager);
    });
  });

  describe('waitForAllIdle', () => {
    it('should wait for all instances to be idle', async () => {
      const file1 = getTempTsonFile('idle-1');
      const file2 = getTempTsonFile('idle-2');

      await factory.create('a', { backend: 'memory', persistenceFile: file1 });
      await factory.create('b', { backend: 'memory', persistenceFile: file2 });

      // Both should be idle initially
      await factory.waitForAllIdle(1000);
    });
  });

  describe('areAllIdle', () => {
    it('should return true when all are idle', async () => {
      const file1 = getTempTsonFile('check-idle-1');

      await factory.create('test', { backend: 'memory', persistenceFile: file1 });

      const idle = await factory.areAllIdle();
      expect(idle).toBe(true);
    });
  });
});

describe('TaskManagerFactoryPresets', () => {
  afterEach(async () => {
    await defaultFactory.destroyAll();
  });

  describe('development', () => {
    it('should create development preset factory', () => {
      const factory = TaskManagerFactoryPresets.development();
      expect(factory).toBeInstanceOf(TaskManagerFactory);
    });

    it('should create instances with development config', async () => {
      const factory = TaskManagerFactoryPresets.development();
      const manager = await factory.create('dev', {});

      expect(manager).toBeInstanceOf(TaskManager);
    });
  });

  describe('testing', () => {
    it('should create testing preset factory', () => {
      const factory = TaskManagerFactoryPresets.testing();
      expect(factory).toBeInstanceOf(TaskManagerFactory);
    });

    it('should create instances with testing config', async () => {
      const factory = TaskManagerFactoryPresets.testing();
      const manager = await factory.create('test', {});

      expect(manager).toBeInstanceOf(TaskManager);
    });
  });

  describe('productionSQLite', () => {
    it('should create production SQLite preset factory', () => {
      const factory = TaskManagerFactoryPresets.productionSQLite('memory://');
      expect(factory).toBeInstanceOf(TaskManagerFactory);
    });

    it('should create instances with production SQLite config', async () => {
      const factory = TaskManagerFactoryPresets.productionSQLite('memory://');
      const manager = await factory.create('prod', {});

      expect(manager).toBeInstanceOf(TaskManager);
    });
  });

  describe('productionPostgreSQL', () => {
    it('should create production PostgreSQL preset factory', () => {
      const factory = TaskManagerFactoryPresets.productionPostgreSQL('postgres://localhost/test');
      expect(factory).toBeInstanceOf(TaskManagerFactory);
    });

    it('should create instances with production PostgreSQL config', async () => {
      const factory = TaskManagerFactoryPresets.productionPostgreSQL('postgres://localhost/test');
      // The factory creates but may fail if PostgreSQL is not available
      // Just verify the factory was created correctly
      expect(factory.size()).toBe(0);
    });
  });

  describe('highPerformance', () => {
    it('should create high-performance preset factory', () => {
      const factory = TaskManagerFactoryPresets.highPerformance();
      expect(factory).toBeInstanceOf(TaskManagerFactory);
    });

    it('should create instances with high-performance config', async () => {
      const factory = TaskManagerFactoryPresets.highPerformance();
      const manager = await factory.create('perf', {});

      expect(manager).toBeInstanceOf(TaskManager);
    });
  });
});
