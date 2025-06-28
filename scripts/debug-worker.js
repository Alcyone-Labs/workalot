import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '.');
const workerPath = path.join(projectRoot, 'dist/workers/worker.js');

function runStressTest() {
  console.log('Starting standalone worker stress test...');

  const worker = new Worker(workerPath, {
    workerData: {
      workerId: 99,
      projectRoot: projectRoot,
      defaultTimeout: 5000,
    },
  });

  worker.on('message', (message) => {
    // console.log('Main thread received message:', message);
    if (message.type === 'worker_ready') {
      console.log('Worker is ready. Sending a large batch of jobs...');
      sendJobs(worker);
    }
  });

  worker.on('error', (error) => {
    console.error('Worker reported an error:', error);
  });

  worker.on('exit', (code) => {
    console.error(`Worker exited with code: ${code}`);
  });
}

function sendJobs(worker) {
  const totalJobs = 200;
  for (let i = 0; i < totalJobs; i++) {
    let jobFile;
    if (i % 10 === 0) {
      jobFile = 'tests/fixtures/FailingJob.ts';
    } else if (i % 5 === 0) {
      jobFile = 'tests/fixtures/LongRunningJob.ts';
    } else {
      jobFile = 'tests/fixtures/SimpleTestJob.js';
    }

    const message = {
      type: 'execute_job',
      id: `message-${i}`,
      payload: {
        jobPayload: {
          jobFile: jobFile,
          jobPayload: { index: i },
        },
        context: {
          jobId: `job-${i}`,
          workerId: 99,
        },
      },
    };
    worker.postMessage(message);
  }
  console.log(`${totalJobs} jobs sent to worker.`);
}

runStressTest();
