import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WatchSpendLog } from "./watch-spend";
const spend = {
  kind: "check" as const,
  about: "main" as const,
  model: "test",
  tokens: { input: 1, cacheWrite: 0, cacheRead: 0, output: 2 },
  usd: 0.1,
  noted: true,
};
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-watch-spend-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));
it.each([false, true])(
  "keeps new checks whole after a missing newline (torn: %s), through reload",
  async (torn) => {
    const path = join(dir, "spend");
    await writeFile(
      path,
      JSON.stringify({ ...spend, at: Date.now(), chatId: "a" }) +
        (torn ? '\n{"kind":' : ""),
    );
    const log = new WatchSpendLog(path);
    log.add("a", spend);
    log.add("a", spend);
    expect((await log.summary(7, () => "Thread")).checks).toBe(3);
    expect(
      (await new WatchSpendLog(path).summary(7, () => "Thread")).checks,
    ).toBe(3);
  },
);
it("retains thirty days on startup without racing queued appends", async () => {
  const path = join(dir, "spend");
  await writeFile(
    path,
    JSON.stringify({ ...spend, at: 1, chatId: "old" }) + "\n",
  );
  const log = new WatchSpendLog(path);
  log.add("new", spend);
  log.add("new", spend);
  expect((await log.summary(7, () => "Thread")).checks).toBe(2);
  expect(
    (await readFile(path, "utf8")).split("\n").filter(Boolean),
  ).toHaveLength(2);
});
