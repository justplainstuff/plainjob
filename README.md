# plainjobs

A SQLite-backed job queue processing 40k jobs/s.

## Getting Started

Install plainjobs:

```bash
npm install plainjobs
```

Here's a minimal example to get you started:

```typescript
import Database from "better-sqlite3";
import { defineQueue, defineWorker } from "plainjobs";

const db = new Database("queue.db");
const queue = defineQueue({ connection: db });

// Define a worker
const worker = defineWorker(
  "print",
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.data}`);
  },
  { queue }
);

// Add a job
queue.add("print", "Hello, plainjobs!");

// Start the worker
worker.start();
```

## Features

- **SQLite-backed**: Reliable persistence using better-sqlite3
- **High performance**: Process up to 40,000 jobs per second
- **Cron-scheduled jobs**: Easily schedule recurring tasks
- **Automatic job cleanup**: Remove old completed and failed jobs
- **Job timeout handling**: Requeue jobs if a worker dies
- **Custom logging**: Integrate with your preferred logging solution
- **Lightweight**: No external dependencies beyond better-sqlite3 and a cron-parser

## Usage

### Creating a Queue

```typescript
import Database from "better-sqlite3";
import { defineQueue } from "plainjobs";

const db = new Database("queue.db");
const queue = defineQueue({
  connection: db,
  timeout: 30 * 60 * 1000, // 30 minutes
  removeDoneJobsOlderThan: 7 * 24 * 60 * 60 * 1000, // 7 days
  removeFailedJobsOlderThan: 30 * 24 * 60 * 60 * 1000, // 30 days
});
```

### Adding Jobs

```typescript
// Enqueue a one-time job
queue.add("send-email", { to: "user@example.com", subject: "Hello" });

// Schedule a recurring job
queue.schedule("daily-report", { cron: "0 0 * * *" });
```

### Defining Workers

```typescript
import { defineWorker } from "plainjobs";

const worker = defineWorker(
  "send-email",
  async (job) => {
    const { to, subject } = JSON.parse(job.data);
    await sendEmail(to, subject);
  },
  {
    queue,
    onCompleted: (job) => console.log(`Job ${job.id} completed`),
    onFailed: (job, error) => console.error(`Job ${job.id} failed: ${error}`),
  }
);

worker.start();
```

### Managing Jobs

```typescript
// Count pending jobs
const pendingCount = queue.countJobs({ status: "pending" });

// Get job types
const types = queue.getJobTypes();

// Get scheduled jobs
const scheduledJobs = queue.getScheduledJobs();
```

## Advanced Usage

### Graceful Shutdown

To ensure all jobs are processed before shutting down:

```typescript
import { processAll } from "plainjobs";

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await worker.stop(); // <-- finishes processing jobs
  queue.close();
  process.exit(0);
});
```

### Multi-process Workers

For high-throughput scenarios, you can spawn multiple worker processes. Here's an example based on `bench-worker.ts`:

```typescript
import { fork } from "node:child_process";
import os from "node:os";

const numCPUs = os.cpus().length;
const dbUrl = "queue.db";

for (let i = 0; i < numCPUs; i++) {
  const worker = fork("./bench-worker.ts", [dbUrl]);
  worker.on("exit", (code) => {
    console.log(`Worker ${i} exited with code ${code}`);
  });
}
```

In `bench-worker.ts`:

```typescript
import Database from "better-sqlite3";
import { defineQueue, defineWorker, processAll } from "plainjobs";

const dbUrl = process.argv[2];
const connection = new Database(dbUrl);
const queue = defineQueue({ connection });

const worker = defineWorker(
  "bench",
  async (job) => {
    // Process job
  },
  { queue }
);

void worker.start().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

This setup allows you to leverage multiple CPU cores for processing jobs in parallel.

For more detailed information on the API and advanced usage, please refer to the source code and tests.
