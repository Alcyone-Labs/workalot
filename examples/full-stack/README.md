# Full-Stack Workalot Example

This example demonstrates how to integrate Workalot into a full-stack web application.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Web Browser   │ ◄─────► │  Elysia Server  │ ◄─────► │    Workalot     │
│   (Frontend)    │  HTTP   │   (Backend)     │         │  Job Processor  │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │   Job Workers   │
                            │  - ImageJob     │
                            │  - DataJob      │
                            │  - ReportJob    │
                            └─────────────────┘
```

## Features

- **Job Submission**: Submit jobs via REST API
- **Real-time Status**: Check job status and progress
- **Result Retrieval**: Get job results when complete
- **Multiple Job Types**: Image processing, data analysis, report generation
- **Queue Management**: View queue statistics and worker status

## Running the Example

### 1. Start the Backend Server

```bash
# Using Bun (recommended)
bun run examples/full-stack/backend/server.ts

# Using Node.js with tsx
npx tsx examples/full-stack/backend/server.ts
```

The server will start on `http://localhost:3000`

### 2. Open the Frontend

Open `examples/full-stack/frontend/index.html` in your browser, or visit:

```
http://localhost:3000
```

The server serves the frontend automatically.

## API Endpoints

### Submit a Job

```http
POST /api/jobs
Content-Type: application/json

{
  "type": "image-processing",
  "payload": {
    "imageUrl": "https://example.com/image.jpg",
    "operations": ["resize", "compress"]
  }
}
```

### Get Job Status

```http
GET /api/jobs/:jobId
```

### Get All Jobs

```http
GET /api/jobs
```

### Get Queue Statistics

```http
GET /api/stats
```

## Job Types

### 1. Image Processing Job

Simulates image processing operations (resize, compress, filter)

```json
{
  "type": "image-processing",
  "payload": {
    "imageUrl": "https://example.com/image.jpg",
    "operations": ["resize", "compress", "grayscale"]
  }
}
```

### 2. Data Analysis Job

Simulates data analysis and aggregation

```json
{
  "type": "data-analysis",
  "payload": {
    "dataset": "sales-2024",
    "operations": ["aggregate", "trend-analysis"]
  }
}
```

### 3. Report Generation Job

Simulates PDF report generation

```json
{
  "type": "report-generation",
  "payload": {
    "reportType": "monthly-summary",
    "format": "pdf"
  }
}
```

## Project Structure

```
examples/full-stack/
├── README.md                 # This file
├── backend/
│   ├── server.ts            # Elysia.js server with Workalot
│   └── routes.ts            # API route handlers
├── frontend/
│   ├── index.html           # Web interface
│   ├── app.js               # Frontend JavaScript
│   └── styles.css           # Styling
└── jobs/
    ├── ImageProcessingJob.ts
    ├── DataAnalysisJob.ts
    └── ReportGenerationJob.ts
```

## Implementation Details

### Backend Integration

The backend uses Elysia.js with Workalot:

```typescript
import { Elysia } from "elysia";
import { TaskManager } from "#/index.js";

const taskManager = new TaskManager({
  backend: "memory",
  maxThreads: 4,
});

await taskManager.initialize();

const app = new Elysia()
  .post("/api/jobs", async ({ body }) => {
    const jobId = await taskManager.schedule({
      jobFile: `examples/full-stack/jobs/${body.type}Job.ts`,
      jobPayload: body.payload,
    });
    return { jobId };
  })
  .listen(3000);
```

### Frontend Integration

The frontend uses vanilla JavaScript with fetch API:

```javascript
async function submitJob(type, payload) {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  return response.json();
}
```

## Use Cases

This example demonstrates common real-world scenarios:

1. **Background Processing**: Offload heavy tasks from the main request/response cycle
2. **Async Operations**: Handle long-running operations without blocking
3. **Job Queuing**: Manage multiple concurrent tasks efficiently
4. **Status Tracking**: Monitor job progress and retrieve results
5. **Scalability**: Process jobs across multiple workers

## Next Steps

- Add WebSocket support for real-time job updates
- Implement job prioritization
- Add job scheduling (cron-like)
- Integrate with Redis for distributed processing
- Add authentication and authorization
