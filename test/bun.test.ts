import Database from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { getTestSuite } from "./test-suite";
import { bun } from "../src/queue";

getTestSuite(describe, beforeEach, it, expect, () => {
  return bun(new Database(":memory:", { strict: true }));
});
