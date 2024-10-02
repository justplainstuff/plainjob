import BetterSqlite from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestSuite } from "./test-suite";
import type { Expect } from "bun:test";
import { better } from "../src/queue";

getTestSuite(describe, beforeEach, it, expect as unknown as Expect, () => {
  return better(new BetterSqlite(":memory:"));
});
