// Queue backend interface
export { IQueueBackend, type QueueStats } from './IQueueBackend.js';

// In-memory queue implementation
export { QueueManager, type QueueManagerEvents } from './QueueManager.js';

// PostgreSQL queue implementation (stub)
export { PostgreSQLQueue } from './PostgreSQLQueue.js';

// PGLite queue implementation
export { PGLiteQueue, type PGLiteQueueConfig } from './PGLiteQueue.js';

// SQLite queue implementation
export { SQLiteQueue, type SQLiteQueueConfig } from './SQLiteQueue.js';

// Queue factory
export {
  QueueFactory,
  createQueue,
  createPGLiteQueue,
  createSQLiteQueue,
  createAutoQueue
} from './QueueFactory.js';
