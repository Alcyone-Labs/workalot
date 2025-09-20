# Basic Distributed Worker Example

This example demonstrates how to set up a distributed job processing system using Workalot with WebSocket communication between an orchestrator and multiple workers.

## Components

1. **Orchestrator** (`orchestrator.ts`) - Manages the job queue and distributes jobs to workers
2. **Worker** (`worker.ts`) - Connects to the orchestrator and processes assigned jobs
3. **CustomWorker** (`CustomWorker.ts`) - Implements custom job processing logic

## Running the Example

1. Start the orchestrator:
   ```bash
   bun run orchestrator.ts
   ```

2. In separate terminals, start multiple workers:
   ```bash
   bun run worker.ts
   ```

   You can start as many workers as you want for distributed processing.

## How It Works

- The orchestrator creates a job queue using SQLite as the backend
- Workers connect to the orchestrator via WebSocket
- When jobs are added to the queue, the orchestrator distributes them to available workers
- Workers execute jobs based on their type and send results back to the orchestrator
- The orchestrator tracks job completion and worker status

## Job Types

This example implements three job types:
1. **MathJob** - Performs mathematical operations on arrays of numbers
2. **DataProcessor** - Simulates data processing tasks
3. **NotificationJob** - Simulates sending notifications

Each worker can process any of these job types, demonstrating how distributed workers can handle different kinds of tasks.