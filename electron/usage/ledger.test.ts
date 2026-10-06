import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsageEntry } from "../../shared/usage";
import { UsageLedger } from "./ledger";

const entry = (at: number): UsageEntry => ({
  at,
  ms: 1000,
  provider: "claude",
  job: "thread",
  answer: true,
  models: {
    "claude-opus-5-5": {
      tokens: { input: 10, cacheWrite: 0, cacheRead: 0, output: 5 },
      usd: 0.01,
      requests: 1,
    },
  },
});

describe("UsageLedger", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-usage-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("reads back what it wrote, across a restart", async () => {
    const path = join(dir, "usage.jsonl");
    const ledger = new UsageLedger(path);
    ledger.add(entry(1));
    ledger.add(entry(2));
    expect((await ledger.all()).map((e) => e.at)).toEqual([1, 2]);
    expect((await new UsageLedger(path).all()).map((e) => e.at)).toEqual([
      1, 2,
    ]);
  });

  it("keeps the next entry whole after a crash cut the last line short", async () => {
    const path = join(dir, "usage.jsonl");
    await writeFile(path, `${JSON.stringify(entry(1))}\n{"at":2,"ms`);
    const ledger = new UsageLedger(path);
    expect((await ledger.all()).map((e) => e.at)).toEqual([1]);
    ledger.add(entry(3));
    await ledger.all();
    const reread = await new UsageLedger(path).all();
    expect(reread.map((e) => e.at)).toEqual([1, 3]);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
  });
});
