import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import Database from "better-sqlite3";
import { defineQueue, defineWorker, JobStatus } from "../src/plainjobs";
import type { Job, Logger, Queue, Worker } from "../src/plainjobs";
import { processAll } from "../src/worker";

const logger: Logger = {
  error: console.error,
  warn: console.warn,
  info: () => {},
  debug: () => {},
};

function queueJobs(queue: Queue, count: number) {
  const jobs = [];
  for (let i = 0; i < count; i++) {
    jobs.push({ jobId: i });
  }
  queue.addMany("bench", jobs);
}

async function runScenario(
  dbUrl: string,
  jobCount: number,
  concurrent: number,
  parallel: number
) {
  console.log(
    `running scenario - jobs: ${jobCount}, workers: ${concurrent}, parallel workers: ${parallel}`
  );

  const connection = new Database(dbUrl);
  const queue = defineQueue({ connection, logger });
  connection.exec(`DELETE FROM plainjobs_jobs`);
  connection.exec(`DELETE FROM plainjobs_scheduled_jobs`);

  queueJobs(queue, jobCount);

  const start = Date.now();

  const workerPromises: Promise<void>[] = [];

  for (let i = 0; i < concurrent; i++) {
    const worker = defineWorker(
      "bench",
      async (job: Job) => new Promise((resolve) => setTimeout(resolve, 0)),
      { queue, logger }
    );
    workerPromises.push(
      processAll(queue, worker, { logger, timeout: 60 * 1000 })
    );
  }

  for (let i = 0; i < parallel; i++) {
    workerPromises.push(spawnWorkerProcess(dbUrl));
  }

  await Promise.all(workerPromises);

  if (queue.countJobs({ status: JobStatus.Pending }) > 0) {
    throw new Error(
      `pending jobs remaining: ${queue.countJobs({
        status: JobStatus.Pending,
      })}`
    );
  }
  if (queue.countJobs({ status: JobStatus.Processing }) > 0) {
    throw new Error(
      `processing jobs remaining: ${queue.countJobs({
        status: JobStatus.Processing,
      })}`
    );
  }

  queue.close();

  const elapsed = Date.now() - start;
  const jobsPerSecond = jobCount / (elapsed / 1000);

  console.log(`database: ${dbUrl}`);
  console.log(`jobs: ${jobCount}`);
  console.log(`concurrent workers: ${concurrent}`);
  console.log(`parallel workers: ${parallel}`);
  console.log(`time elapsed: ${elapsed} ms`);
  console.log(`jobs/second: ${jobsPerSecond.toFixed(2)}`);
  console.log("------------------------");

  return jobsPerSecond;
}

function spawnWorkerProcess(dbUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "bench-worker");
    const child: ChildProcess = fork(workerPath, [dbUrl]);

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`worker process exited with code ${code}`));
      }
    });
  });
}

async function runScenarios() {
  await runScenario("bench.db", 100_000, 0, 4);
  // await runScenario(":memory:", 1000, 1, 0);
  // await runScenario(":memory:", 4000, 4, 0);
  // await runScenario(":memory:", 8000, 8, 0);
  // await runScenario("bench.db", 100, 0, 1);
  // await runScenario("bench.db", 1000, 0, 1);
  // await runScenario("bench.db", 2000, 0, 2);
  // await runScenario("bench.db", 4000, 0, 4);
  // await runScenario("bench.db", 8000, 0, 8);
  // await runScenario("bench.db", 16000, 0, 16);
  // await runScenario("bench.db", 32000, 0, 32);
  // await runScenario("bench.db", 64000, 0, 64);
}

runScenarios().catch(console.error);
