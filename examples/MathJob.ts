import { BaseJob } from '../src/jobs/BaseJob.js';

/**
 * Example job that performs mathematical operations
 */
export class MathJob extends BaseJob {
  constructor() {
    super('MathJob');
  }

  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    this.validatePayload(payload, ['operation', 'numbers']);

    const { operation, numbers } = payload;

    if (!Array.isArray(numbers) || numbers.length === 0) {
      throw new Error('Numbers must be a non-empty array');
    }

    let result: number;

    switch (operation) {
      case 'add':
        result = numbers.reduce((sum: number, num: number) => sum + num, 0);
        break;
      case 'multiply':
        result = numbers.reduce((product: number, num: number) => product * num, 1);
        break;
      case 'average':
        result = numbers.reduce((sum: number, num: number) => sum + num, 0) / numbers.length;
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    return this.createSuccessResult({
      operation,
      numbers,
      result,
      processedAt: new Date().toISOString()
    });
  }
}
