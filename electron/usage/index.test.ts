import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsageEntry } from "../../shared/usage";
import { keepUsageLog, usageLog } from "./index";

const unpricedHaikuTitle: UsageEntry = {
  at: 1,
  ms: 900,
  provider: "claude",
  job: "title",
  answer: false,
  models: {
    "claude-haiku-5-5": {
      tokens: { input: 1000, cacheWrite: 0, cacheRead: 0, output: 100 },
      requests: 1,
    },
    "claude-unknown-9-9": {
      tokens: { input: 1000, cacheWrite: 0, cacheRead: 0, output: 100 },
      requests: 1,
    },
  },
};

describe("usageLog", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "usage-log-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prices old unpriced lines from their tokens and leaves unknown models unpriced", async () => {
    const file = join(dir, "usage.jsonl");
    await writeFile(file, `${JSON.stringify(unpricedHaikuTitle)}\n`);
    keepUsageLog(file);
    const [entry] = await usageLog();
    expect(entry.models["claude-haiku-5-5"].usd).toBeCloseTo(0.00015);
    expect(entry.models["claude-unknown-9-9"].usd).toBeUndefined();
  });
});
