import { BaseJob } from '../../src/jobs/index.js';

export default class TimedJob extends BaseJob {
  async run(payload: { 
    jobId: string;
    duration: number;
    startTime?: number;
  }) {
    const { jobId, duration, startTime } = payload;
    
    if (startTime) {
      const elapsed = Date.now() - startTime;
      console.log(`Job ${jobId} started after ${elapsed}ms`);
    }
    
    await new Promise(resolve => setTimeout(resolve, duration));
    
    return this.createSuccessResult({
      jobId,
      duration,
      completedAt: Date.now()
    });
  }
}
