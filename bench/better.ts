import { better } from "../src/queue";
import Better from "better-sqlite3";
import { runScenario } from "./run-scenario";

async function runScenarios() {
  await runScenario(better(new Better("bench.db")), 32000, 0, 1);
  await runScenario(better(new Better("bench.db")), 32000, 0, 2);
  await runScenario(better(new Better("bench.db")), 32000, 0, 4);
}

runScenarios().catch(console.error);
