import { BaseJob } from '../dist/jobs/BaseJob.js';

/**
 * Simple ping job for health checks and testing
 */
export class PingJob extends BaseJob {
  constructor() {
    super('PingJob');
  }

  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 10));
    
    return this.createSuccessResult({
      message: 'pong',
      receivedPayload: payload,
      processedAt: new Date().toISOString()
    });
  }
}
