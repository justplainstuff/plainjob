import { bun } from "../src/queue";
import { Database as Bun } from "bun:sqlite";
import { runScenario } from "./run-scenario";

async function runScenarios() {
  await runScenario(bun(new Bun("bench.db", { strict: true })), 32000, 0, 1);
  await runScenario(bun(new Bun("bench.db", { strict: true })), 32000, 0, 2);
  await runScenario(bun(new Bun("bench.db", { strict: true })), 32000, 0, 4);
}

runScenarios().catch(console.error);
