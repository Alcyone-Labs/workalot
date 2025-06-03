# Sample Consumer Application

This is a comprehensive example application that demonstrates real-world usage of the task management library. It simulates a data processing pipeline with various types of jobs including data processing, analysis, report generation, notifications, and cleanup operations.

## Features Demonstrated

- **Multi-threaded job execution** with 6 worker threads
- **Different job types** with varying complexity and execution times
- **Batch processing** with organized job scheduling
- **Real-time monitoring** with status updates every 5 seconds
- **Error handling** and recovery strategies
- **Graceful shutdown** with proper cleanup
- **Performance metrics** and statistics tracking

## Job Types

### 1. Data Processing Jobs (`DataProcessorJob`)
- **Transform**: Convert data between formats
- **Validate**: Check data integrity and format
- **Aggregate**: Group and summarize data
- **Filter**: Remove unwanted data based on criteria
- **Sort**: Order data by specified fields
- **Merge**: Combine multiple data sources

### 2. Data Analysis Jobs (`DataAnalysisJob`)
- **Trend Analysis**: Identify patterns and trends over time
- **Pattern Recognition**: Detect recurring patterns in data
- **Correlation Analysis**: Find relationships between variables
- **Anomaly Detection**: Identify unusual data points
- **Forecasting**: Predict future values based on historical data
- **Clustering**: Group similar data points together

### 3. Report Generation Jobs (`ReportGeneratorJob`)
- **Daily Summary**: Quick overview reports
- **Weekly Analytics**: Detailed weekly performance reports
- **Monthly Dashboard**: Comprehensive monthly reports
- **Quarterly Review**: Strategic quarterly assessments
- **Annual Report**: Complete yearly analysis

Supports multiple formats: PDF, Excel, HTML, JSON, CSV

### 4. Notification Jobs (`NotificationJob`)
- **Email**: Send email notifications with templates
- **SMS**: Send text message alerts
- **Slack**: Post messages to Slack channels
- **Webhook**: Send HTTP POST notifications
- **Push Notifications**: Mobile app notifications
- **Discord/Teams**: Chat platform notifications

### 5. Cleanup Jobs (`CleanupJob`)
- **Archive Old Files**: Move old files to archive storage
- **Clear Cache**: Remove cached data from Redis/memory
- **Cleanup Temp Files**: Remove temporary files
- **Database Maintenance**: Optimize tables and indexes
- **Log Rotation**: Rotate and compress log files
- **Remove Duplicates**: Find and remove duplicate files
- **Compress Files**: Compress files to save space

## Running the Application

### Prerequisites

1. Build the main task management library:
```bash
cd ../../
pnpm run build
```

2. Install dependencies (if running standalone):
```bash
cd examples/sample-consumer
npm install
```

### Run the Application

```bash
# From the sample-consumer directory
npm start

# Or from the project root
pnpm run build && node dist/examples/sample-consumer/app.js
```

### Development Mode

```bash
# From the sample-consumer directory
npm run dev
```

## Application Flow

1. **Initialization**: Sets up task manager with 6 worker threads
2. **Monitoring Setup**: Starts real-time status monitoring
3. **Completion Handler**: Registers callback for when all jobs complete
4. **Batch Processing**: Processes jobs in organized batches:
   - Data Processing (5 jobs)
   - Report Generation (3 jobs)
   - Notifications (4 jobs)
   - Cleanup (2 jobs)
5. **Statistics**: Shows final performance metrics
6. **Graceful Shutdown**: Cleans up resources and saves state

## Sample Output

```
🚀 Starting Sample Consumer Application...
✅ Task Manager initialized

📝 Processing sample workload...

🔄 Scheduling 14 jobs...

📦 Processing batch: Data Processing (5 jobs)
   🔄 Processing data: transform operation
   ✅ Data Processing job 1 completed in 1234ms
   🔄 Processing data: validate operation
   ✅ Data Processing job 2 completed in 987ms
   ...

📊 System Status:
   Queue: 8 pending, 2 processing, 4 completed
   Workers: 4/6 available
   Processed: 6 jobs
   Runtime: 15s

📦 Processing batch: Report Generation (3 jobs)
   📄 Generating report: daily_summary in pdf format
   ✅ Report Generation job 1 completed in 2456ms
   ...

🎉 All jobs completed! Queue is now free.

📈 Final Statistics:
   Total Jobs Processed: 14
   Successful: 14
   Failed: 0
   Total Runtime: 45s
   Average: 0.31 jobs/second
   Workers Used: 6

🛑 Shutting down application...
✅ Application shut down successfully
```

## Configuration

The application uses these task manager settings:

```typescript
{
  maxThreads: 6,                    // 6 worker threads
  maxInMemoryAge: 10 * 60 * 1000,   // 10 minutes retention
  persistenceFile: 'data/queue-state.json',
  healthCheckInterval: 3000          // 3 second health checks
}
```

## Monitoring

The application provides real-time monitoring with:

- **Queue Statistics**: Pending, processing, completed job counts
- **Worker Statistics**: Available vs busy workers
- **Performance Metrics**: Jobs processed, runtime, throughput
- **Error Tracking**: Failed jobs and error details

## Error Handling

The application demonstrates various error handling patterns:

- **Job-level errors**: Individual job failures don't stop the batch
- **Batch-level errors**: Batch continues even if some jobs fail
- **System-level errors**: Graceful degradation and recovery
- **Shutdown errors**: Proper cleanup even during errors

## Customization

You can customize the application by:

1. **Modifying job parameters** in the `create*Jobs()` methods
2. **Adding new job types** by creating new job classes
3. **Changing batch sizes** and processing patterns
4. **Adjusting monitoring intervals** and output format
5. **Implementing different error handling** strategies

## Files Generated

The application creates these files:

- `data/queue-state.json` - Persistent queue state
- Various simulated output files referenced in job payloads

## Learning Points

This example demonstrates:

- **Proper initialization** and configuration
- **Batch processing** strategies for different job types
- **Real-time monitoring** and status reporting
- **Error handling** at multiple levels
- **Performance optimization** with worker threads
- **Graceful shutdown** procedures
- **Resource management** and cleanup

## Next Steps

After running this example, you can:

1. **Create your own jobs** by extending `BaseJob`
2. **Implement real data processing** logic
3. **Add database integration** for persistent storage
4. **Integrate with external APIs** for notifications
5. **Add authentication** and security features
6. **Scale to multiple servers** with shared queue backends
