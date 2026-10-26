import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { finishTurn, startTurn } from "../git/turn-changes";
import { gitIn, tempRepo } from "../../tests/fixtures/git-repo";
import { LocalHistoryStore } from "./store";
import { recordTurnHistory } from "./turn";

let root: string;
let dir: string;
let store: LocalHistoryStore;

beforeEach(async () => {
  root = await tempRepo("relay-history-turn-");
  dir = await mkdtemp(join(tmpdir(), "relay-history-store-"));
  store = new LocalHistoryStore(dir, { sweepDelayMs: null });
  await writeFile(join(root, "a.ts"), "one\n");
  await writeFile(join(root, "gone.ts"), "bye\n");
  gitIn(root, "add", ".");
  gitIn(root, "commit", "-qm", "Initial");
});

afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
});

it("keeps what an agent turn changed, before and after, under the thread's title", async () => {
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "one\ntwo\n");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "new.ts"), "fresh\n");
  await rm(join(root, "gone.ts"));
  const files = await finishTurn(root, id, before!);

  await recordTurnHistory(store, root, id, files, "Fix the parser");

  const read = async (path: string) => {
    const list = await store.list(join(root, path));
    return Promise.all(
      list.map(async (e) => [
        e.reason,
        e.label,
        await store.read(join(root, path), e.id),
      ]),
    );
  };
  expect(await read("a.ts")).toEqual([
    ["agent", "Fix the parser", "one\ntwo\n"],
    ["agent", "Before Fix the parser", "one\n"],
  ]);
  // A new file has no before, a deleted one no after.
  expect(await read("src/new.ts")).toEqual([
    ["agent", "Fix the parser", "fresh\n"],
  ]);
  expect(await read("gone.ts")).toEqual([]);
});

it("doesn't keep the before twice when the file's last version is the same text", async () => {
  await store.record(join(root, "a.ts"), "one\n", "save");
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "two\n");
  const files = await finishTurn(root, id, before!);
  await recordTurnHistory(store, root, id, files, "");
  expect(
    (await store.list(join(root, "a.ts"))).map((e) => [e.reason, e.label]),
  ).toEqual([
    ["agent", "Agent edit"],
    ["save", undefined],
  ]);
});
