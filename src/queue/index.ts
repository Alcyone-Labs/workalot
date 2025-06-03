// Queue backend interface
export { IQueueBackend, type QueueStats } from './IQueueBackend.js';

// In-memory queue implementation
export { QueueManager, type QueueManagerEvents } from './QueueManager.js';
