import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { defineQueue, defineWorker, JobStatus } from "../src/plainjob";
import type { Job, Logger, Queue } from "../src/plainjob";
import { processAll } from "../src/worker";
import { type Connection } from "../src/queue";

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

export async function runScenario(
  connection: Connection,
  jobCount: number,
  concurrent: number,
  parallel: number
) {
  console.log(
    `running scenario - jobs: ${jobCount}, workers: ${concurrent}, parallel workers: ${parallel}`
  );

  const queue = defineQueue({ connection, logger });
  connection.exec(`DELETE FROM plainjob_jobs`);
  connection.exec(`DELETE FROM plainjob_scheduled_jobs`);

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
    workerPromises.push(spawnWorkerProcess(connection));
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

  console.log(`database: ${connection.filename}`);
  console.log(`jobs: ${jobCount}`);
  console.log(`concurrent workers: ${concurrent}`);
  console.log(`parallel workers: ${parallel}`);
  console.log(`time elapsed: ${elapsed} ms`);
  console.log(`jobs/second: ${jobsPerSecond.toFixed(2)}`);
  console.log("------------------------");

  return jobsPerSecond;
}

function spawnWorkerProcess(connection: Connection): Promise<void> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(
      import.meta.dirname,
      connection.driver === "bun:sqlite" ? "worker-bun" : "worker-better"
    );
    const child: ChildProcess = fork(workerPath, [
      connection.filename,
      connection.driver,
    ]);

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`worker process exited with code ${code}`));
      }
    });
  });
}
