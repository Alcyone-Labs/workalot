import { BaseJob } from '../../../dist/jobs/BaseJob.js';

/**
 * Data Processing Job
 * 
 * Handles various data processing operations like transformation,
 * validation, and aggregation of data files.
 */
export class DataProcessorJob extends BaseJob {
  constructor() {
    super('DataProcessorJob');
  }

  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Validate required fields
    this.validatePayload(payload, ['operation']);

    const { operation, inputFile, outputFile } = payload;

    try {
      console.log(`🔄 Processing data: ${operation} operation`);

      // Simulate processing time based on operation
      const processingTime = this.getProcessingTime(operation);
      await this.simulateProcessing(processingTime);

      // Perform the operation
      const result = await this.performOperation(operation, inputFile, outputFile);

      console.log(`✅ Data processing completed: ${operation}`);

      return this.createSuccessResult({
        operation,
        inputFile,
        outputFile,
        recordsProcessed: result.recordsProcessed,
        processingTimeMs: processingTime,
        outputSize: result.outputSize,
        metadata: result.metadata
      });

    } catch (error) {
      console.error(`❌ Data processing failed: ${operation}`, error);
      throw new Error(`Data processing failed for ${operation}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getProcessingTime(operation: string): number {
    const baseTimes = {
      'transform': 1000,
      'validate': 800,
      'aggregate': 1500,
      'filter': 600,
      'sort': 900,
      'merge': 1200
    };

    return baseTimes[operation as keyof typeof baseTimes] || 1000;
  }

  private async simulateProcessing(timeMs: number): Promise<void> {
    // Simulate processing with progress updates
    const steps = 5;
    const stepTime = timeMs / steps;

    for (let i = 0; i < steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepTime));
      // Could emit progress events here in a real implementation
    }
  }

  private async performOperation(
    operation: string, 
    inputFile?: string, 
    outputFile?: string
  ): Promise<{
    recordsProcessed: number;
    outputSize: number;
    metadata: Record<string, any>;
  }> {
    // Simulate different operations
    switch (operation) {
      case 'transform':
        return {
          recordsProcessed: Math.floor(Math.random() * 1000) + 500,
          outputSize: Math.floor(Math.random() * 50000) + 10000,
          metadata: {
            transformationType: 'json_to_csv',
            columnsAdded: ['processed_at', 'status'],
            validationRules: ['required_fields', 'data_types']
          }
        };

      case 'validate':
        const totalRecords = Math.floor(Math.random() * 800) + 200;
        const validRecords = Math.floor(totalRecords * 0.95);
        return {
          recordsProcessed: totalRecords,
          outputSize: Math.floor(Math.random() * 30000) + 5000,
          metadata: {
            validRecords,
            invalidRecords: totalRecords - validRecords,
            validationErrors: ['missing_email', 'invalid_date_format'],
            validationRules: ['email_format', 'date_range', 'required_fields']
          }
        };

      case 'aggregate':
        return {
          recordsProcessed: Math.floor(Math.random() * 2000) + 1000,
          outputSize: Math.floor(Math.random() * 20000) + 3000,
          metadata: {
            aggregationType: 'group_by_date',
            groupsCreated: Math.floor(Math.random() * 50) + 10,
            aggregationFunctions: ['sum', 'avg', 'count'],
            timeRange: '2024-01-01 to 2024-01-31'
          }
        };

      case 'filter':
        const inputRecords = Math.floor(Math.random() * 1500) + 500;
        const filteredRecords = Math.floor(inputRecords * 0.7);
        return {
          recordsProcessed: inputRecords,
          outputSize: Math.floor(Math.random() * 25000) + 8000,
          metadata: {
            inputRecords,
            outputRecords: filteredRecords,
            filterCriteria: ['status=active', 'created_date>2024-01-01'],
            filterEfficiency: `${((filteredRecords / inputRecords) * 100).toFixed(1)}%`
          }
        };

      case 'sort':
        return {
          recordsProcessed: Math.floor(Math.random() * 1200) + 300,
          outputSize: Math.floor(Math.random() * 40000) + 12000,
          metadata: {
            sortFields: ['timestamp', 'priority', 'id'],
            sortOrder: 'ascending',
            sortAlgorithm: 'quicksort',
            memoryUsage: `${Math.floor(Math.random() * 100) + 50}MB`
          }
        };

      case 'merge':
        return {
          recordsProcessed: Math.floor(Math.random() * 2500) + 1500,
          outputSize: Math.floor(Math.random() * 60000) + 20000,
          metadata: {
            sourceFiles: [inputFile || 'file1.json', 'file2.json', 'file3.json'],
            mergeStrategy: 'union_with_deduplication',
            duplicatesRemoved: Math.floor(Math.random() * 100) + 20,
            mergeKey: 'id'
          }
        };

      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }

  getJobId(payload?: Record<string, any>): string | undefined {
    if (!payload) return undefined;

    // Create ID based on operation and input file
    const { operation, inputFile } = payload;
    const content = `${this.jobName}-${operation}-${inputFile || 'no-file'}-${Date.now()}`;
    return require('crypto').createHash('sha1').update(content).digest('hex');
  }
}
