import { EventEmitter } from 'node:events';
import { cpus } from 'node:os';
/**
 * Abstract interface for queue backends
 * Allows swapping between in-memory, PostgreSQL, or other storage backends
 */
export class IQueueBackend extends EventEmitter {
    config;
    constructor(config) {
        super();
        this.config = {
            maxInMemoryAge: config.maxInMemoryAge || 24 * 60 * 60 * 1000,
            maxThreads: config.maxThreads || Math.max(1, cpus().length - 2),
            persistenceFile: config.persistenceFile || 'queue-state.json',
            healthCheckInterval: config.healthCheckInterval || 5000,
            backend: config.backend || 'memory',
            databaseUrl: config.databaseUrl || '',
            silent: config.silent || false
        };
    }
    /**
     * Get configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
