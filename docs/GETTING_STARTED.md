# Getting Started Guide

This guide will help you get up and running with the Task Management Library quickly.

## Installation

```bash
npm install task-management
# or
pnpm add task-management
# or
yarn add task-management
```

## Quick Start (5 minutes)

### 1. Initialize the Task Manager

```typescript
import { initializeTaskManager, scheduleNow, shutdown } from 'task-management';

// Initialize with default settings
await initializeTaskManager();
```

### 2. Create Your First Job

Create a file `jobs/HelloWorldJob.ts`:

```typescript
import { BaseJob } from 'task-management';

export class HelloWorldJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    const { name = 'World' } = payload;
    
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return this.createSuccessResult({
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString()
    });
  }
}
```

### 3. Schedule and Execute the Job

```typescript
const result = await scheduleNow({
  jobFile: 'jobs/HelloWorldJob.ts',
  jobPayload: { name: 'Developer' }
});

console.log(result.results.message); // "Hello, Developer!"

// Clean shutdown
await shutdown();
```

## Step-by-Step Tutorial

### Step 1: Project Setup

Create a new project:

```bash
mkdir my-task-app
cd my-task-app
npm init -y
npm install task-management
mkdir jobs
```

Update your `package.json` to use ES modules:

```json
{
  "type": "module",
  "scripts": {
    "start": "node app.js",
    "dev": "node --watch app.js"
  }
}
```

### Step 2: Create a Simple Job

Create `jobs/MathJob.ts`:

```typescript
import { BaseJob } from 'task-management';

export class MathJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // Validate input
    this.validatePayload(payload, ['operation', 'numbers']);
    
    const { operation, numbers } = payload;
    
    if (!Array.isArray(numbers) || numbers.length === 0) {
      throw new Error('Numbers must be a non-empty array');
    }
    
    let result: number;
    
    switch (operation) {
      case 'add':
        result = numbers.reduce((sum, num) => sum + num, 0);
        break;
      case 'multiply':
        result = numbers.reduce((product, num) => product * num, 1);
        break;
      case 'average':
        result = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
    
    return this.createSuccessResult({
      operation,
      numbers,
      result,
      count: numbers.length
    });
  }
}
```

### Step 3: Create the Main Application

Create `app.js`:

```typescript
import { 
  initializeTaskManager, 
  scheduleNow, 
  whenFree, 
  shutdown 
} from 'task-management';

async function main() {
  try {
    // Initialize with custom configuration
    await initializeTaskManager({
      maxThreads: 4,
      persistenceFile: 'task-queue.json'
    });
    
    console.log('Task manager initialized!');
    
    // Schedule multiple jobs
    const jobs = [
      {
        jobFile: 'jobs/MathJob.ts',
        jobPayload: { operation: 'add', numbers: [1, 2, 3, 4, 5] }
      },
      {
        jobFile: 'jobs/MathJob.ts',
        jobPayload: { operation: 'multiply', numbers: [2, 3, 4] }
      },
      {
        jobFile: 'jobs/MathJob.ts',
        jobPayload: { operation: 'average', numbers: [10, 20, 30, 40] }
      }
    ];
    
    // Execute jobs concurrently
    console.log('Executing jobs...');
    const results = await Promise.all(
      jobs.map(job => scheduleNow(job))
    );
    
    // Display results
    results.forEach((result, index) => {
      console.log(`Job ${index + 1}:`, result.results);
    });
    
    // Set up completion callback
    whenFree(() => {
      console.log('All jobs completed!');
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Always shutdown gracefully
    await shutdown();
  }
}

main().catch(console.error);
```

### Step 4: Run Your Application

```bash
node app.js
```

Expected output:
```
Task manager initialized!
Executing jobs...
Job 1: { operation: 'add', numbers: [1,2,3,4,5], result: 15, count: 5 }
Job 2: { operation: 'multiply', numbers: [2,3,4], result: 24, count: 3 }
Job 3: { operation: 'average', numbers: [10,20,30,40], result: 25, count: 4 }
All jobs completed!
```

## Common Patterns

### Pattern 1: Fire and Forget Jobs

```typescript
import { scheduleJob } from 'task-management';

// Schedule without waiting for completion
const jobId = await scheduleJob({
  jobFile: 'jobs/BackgroundTask.ts',
  jobPayload: { data: 'background processing' }
});

console.log(`Job ${jobId} scheduled`);
```

### Pattern 2: Batch Processing

```typescript
async function processBatch(items: any[]) {
  const batchSize = 5;
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    const promises = batch.map(item => 
      scheduleNow({
        jobFile: 'jobs/ProcessItem.ts',
        jobPayload: { item }
      })
    );
    
    const results = await Promise.all(promises);
    console.log(`Batch ${Math.floor(i / batchSize) + 1} completed`);
  }
}
```

### Pattern 3: Error Handling

```typescript
async function robustJobExecution() {
  try {
    const result = await scheduleNow({
      jobFile: 'jobs/RiskyJob.ts',
      jobPayload: { data: 'test' },
      jobTimeout: 10000
    });
    
    console.log('Success:', result);
    
  } catch (error) {
    if (error.message.includes('timed out')) {
      console.log('Job timed out, retrying with longer timeout...');
      // Retry logic here
    } else {
      console.error('Job failed:', error.message);
      // Error handling logic here
    }
  }
}
```

### Pattern 4: Monitoring and Status

```typescript
import { getStatus, getQueueStats, getWorkerStats } from 'task-management';

async function monitorSystem() {
  const status = await getStatus();
  const queueStats = await getQueueStats();
  const workerStats = await getWorkerStats();
  
  console.log('System Status:', {
    initialized: status.isInitialized,
    queueSize: queueStats.total,
    pendingJobs: queueStats.pending,
    availableWorkers: workerStats.available
  });
}

// Monitor every 5 seconds
setInterval(monitorSystem, 5000);
```

## Best Practices

### 1. Job Design

```typescript
export class WellDesignedJob extends BaseJob {
  async run(payload: Record<string, any>): Promise<Record<string, any>> {
    // ✅ Validate input early
    this.validatePayload(payload, ['requiredField']);
    
    // ✅ Use try-catch for error handling
    try {
      // ✅ Break down complex operations
      const processedData = await this.processData(payload.data);
      const validatedData = await this.validateData(processedData);
      const result = await this.generateOutput(validatedData);
      
      // ✅ Return structured response
      return this.createSuccessResult({
        result,
        metadata: {
          processedAt: new Date().toISOString(),
          itemCount: result.length
        }
      });
      
    } catch (error) {
      // ✅ Log errors for debugging
      console.error('Job failed:', error);
      throw error; // Re-throw to mark job as failed
    }
  }
  
  // ✅ Break down into smaller methods
  private async processData(data: any): Promise<any> {
    // Processing logic here
    return data;
  }
  
  private async validateData(data: any): Promise<any> {
    // Validation logic here
    return data;
  }
  
  private async generateOutput(data: any): Promise<any> {
    // Output generation logic here
    return data;
  }
}
```

### 2. Configuration

```typescript
// ✅ Environment-specific configuration
const config = {
  maxThreads: process.env.NODE_ENV === 'production' ? 8 : 2,
  maxInMemoryAge: 30 * 60 * 1000, // 30 minutes
  persistenceFile: `queue-${process.env.NODE_ENV || 'development'}.json`,
  healthCheckInterval: 5000
};

await initializeTaskManager(config);
```

### 3. Error Recovery

```typescript
async function executeWithRetry(jobPayload: any, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await scheduleNow(jobPayload);
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
}
```

## Next Steps

1. **Explore the Examples**: Check out `examples/sample-consumer/` for a comprehensive application
2. **Read the API Documentation**: See `docs/API.md` for detailed API reference
3. **Create Custom Jobs**: Build jobs specific to your use case
4. **Add Monitoring**: Implement health checks and metrics collection
5. **Scale Up**: Configure for production with appropriate worker counts and persistence

## Troubleshooting

### Common Issues

**Issue**: "TaskManager must be initialized before use"
**Solution**: Call `initializeTaskManager()` before using other functions

**Issue**: Jobs timing out
**Solution**: Increase `jobTimeout` in job payload or optimize job logic

**Issue**: "No available workers"
**Solution**: Increase `maxThreads` in configuration or wait for current jobs to complete

**Issue**: Module resolution errors
**Solution**: Ensure job files use correct import paths and are accessible

### Getting Help

- Check the `examples/` directory for working code
- Review the API documentation in `docs/API.md`
- Look at the test files for usage patterns
- Ensure all dependencies are properly installed
