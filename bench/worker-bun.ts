import { defineQueue, defineWorker } from "../src/plainjob";
import type { Job, Logger } from "../src/plainjob";
import { processAll } from "../src/worker";
import { bun } from "../src/queue";
import { Database as Bun } from "bun:sqlite";

const logger: Logger = {
  error: console.error,
  warn: console.warn,
  info: () => {},
  debug: () => {},
};

const filename = process.argv[2];

if (!filename) {
  console.error("invalid database url specified");
  process.exit(1);
}

const connection = bun(new Bun(filename, { strict: true }));

const queue = defineQueue({ connection, logger });
const worker = defineWorker("bench", async (job: Job) => Promise.resolve(), {
  queue,
  logger,
});

async function run() {
  await processAll(queue, worker, { logger, timeout: 60 * 1000 });
  queue.close();
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
