import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ShownImages } from "./shown-images";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-shown-"));
});

afterEach(() => rm(root, { recursive: true, force: true }));

it("drops the oldest kept images once they outgrow the cap, and their emptied folders", async () => {
  const shown = new ShownImages(join(root, "images"), 250);
  const kept: string[] = [];
  for (const [i, chat, message] of [
    [0, "a", "m1"],
    [1, "a", "m2"],
    [2, "b", "m3"],
  ] as const) {
    const source = join(root, `${i}.png`);
    await writeFile(source, Buffer.alloc(100));
    await shown.keep(chat, message, source);
    const copy = shown.path(chat, message, source);
    // Kept a minute apart, oldest first.
    const at = new Date(Date.now() - (3 - i) * 60_000);
    await utimes(copy, at, at);
    kept.push(copy);
  }
  await shown.prune();
  const left = async (path: string) =>
    (await readdir(dirname(path)).catch(() => [])).length > 0;
  expect(await left(kept[0]!)).toBe(false);
  expect(await readdir(join(root, "images", "a", "shown"))).toEqual(["m2"]);
  expect(await left(kept[1]!)).toBe(true);
  expect(await left(kept[2]!)).toBe(true);
});
