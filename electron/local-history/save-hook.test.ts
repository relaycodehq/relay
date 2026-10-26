import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { currentText, saveWithHistory } from "./save-hook";
import { LocalHistoryStore } from "./store";

let dir: string;
let store: LocalHistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-history-hook-"));
  store = new LocalHistoryStore(join(dir, "history"), { sweepDelayMs: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  store.close();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const file = "/p/a.ts";
/** Waits for the writes the hook leaves running behind the save. */
const settled = () => store.list(file);

it("keeps the text a first save replaces, then each save", async () => {
  const save = vi.fn(async () => ({ version: "v1" }));
  await saveWithHistory(store, file, "new", async () => "on disk", save);
  await saveWithHistory(store, file, "newer", async () => "new", save);
  const list = await settled();
  expect(list.map((e) => [e.reason, e.label])).toEqual([
    ["save", undefined],
    ["save", undefined],
    ["external", "Before first save"],
  ]);
  expect(await store.read(file, list[2]!.id)).toBe("on disk");
});

it("reads the text on disk only while the file has no history", async () => {
  const current = vi.fn(async () => "on disk");
  const save = async () => "ok";
  await saveWithHistory(store, file, "a", current, save);
  await saveWithHistory(store, file, "b", current, save);
  expect(current).toHaveBeenCalledTimes(1);
});

it("returns the save's result when keeping a version fails", async () => {
  const broken = {
    has: async () => false,
    record: async () => {
      throw new Error("disk full");
    },
  };
  const result = await saveWithHistory(
    broken,
    file,
    "new",
    async () => "old",
    async () => ({ version: "v1" }),
  );
  expect(result).toEqual({ version: "v1" });
  await vi.waitFor(() => expect(console.warn).toHaveBeenCalledTimes(2));
});

it("saves when the history can't even tell whether it has the file", async () => {
  const broken = {
    has: async (): Promise<boolean> => {
      throw new Error("no folder");
    },
    record: async () => null,
  };
  expect(
    await saveWithHistory(
      broken,
      file,
      "new",
      async () => "old",
      async () => 7,
    ),
  ).toBe(7);
  expect(console.warn).toHaveBeenCalled();
});

it("keeps nothing of a save that failed, and passes its error on", async () => {
  await store.record(file, "kept", "save");
  await expect(
    saveWithHistory(
      store,
      file,
      "lost",
      async () => "kept",
      async () => {
        throw new Error(
          "This file changed on disk since you opened or saved it.",
        );
      },
    ),
  ).rejects.toThrow("changed on disk");
  expect((await settled()).map((e) => e.size)).toEqual([4]);
});

it("does not wait for a slow history to finish before the save returns", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const slow = {
    has: async () => true,
    record: vi.fn(() => held.then(() => null)),
  };
  await saveWithHistory(
    slow,
    file,
    "new",
    async () => null,
    async () => "saved",
  );
  expect(slow.record).toHaveBeenCalled();
  release();
});

it("reads the current text only when it is editable text", async () => {
  const text = join(dir, "a.ts");
  await writeFile(text, "hello");
  expect(await currentText(text)).toBe("hello");
  expect(await currentText(join(dir, "gone.ts"))).toBeNull();
  await writeFile(join(dir, "b.bin"), Buffer.from([1, 0, 2]));
  expect(await currentText(join(dir, "b.bin"))).toBeNull();
  await writeFile(join(dir, "big.txt"), "x".repeat(2 * 1024 * 1024 + 1));
  expect(await currentText(join(dir, "big.txt"))).toBeNull();
});
