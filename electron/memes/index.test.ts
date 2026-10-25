import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { builtInMemes } from "../../shared/memes";

vi.mock("../media", () => ({
  mediaUrl: async (full: string) => `relay-media://file/t/${basename(full)}`,
}));

import { Memes } from ".";

let dir: string, memes: Memes;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-memes-"));
  memes = new Memes(dir);
});

afterEach(() => rm(dir, { recursive: true, force: true }));

it("offers the built-ins until set up, then shows the pictures an agent saved", async () => {
  const before = await memes.state();
  expect(before).toMatchObject({ setUp: false, problems: [] });
  expect(before.memes).toHaveLength(builtInMemes.length);
  expect(before.memes.every((m) => !m.url)).toBe(true);

  await memes.prepare();
  const folder = join(dir, "memes");
  await writeFile(join(folder, "dew-it.jpg"), "picture");
  await writeFile(join(folder, "dew-it.png"), "a second one is ignored");
  await writeFile(join(folder, "notes.txt"), "not a meme");
  const after = await memes.state();
  expect(after.setUp).toBe(true);
  expect(after.memes.find((m) => m.id === "dew-it")).toMatchObject({
    id: "dew-it",
    name: "Dew it",
    meaning: "Yes, go ahead and do it.",
    caption: "Dew it.",
    url: "relay-media://file/t/dew-it.jpg",
  });
  expect(after.memes.filter((m) => m.url)).toHaveLength(1);
});

it("keeps the person's list as they edited it", async () => {
  await memes.prepare();
  const list = join(dir, "memes", "memes.json");
  const file = JSON.parse(await readFile(list, "utf8"));
  file.memes = [{ id: "sad-cat", meaning: "Sad." }, ...file.memes.slice(1)];
  await writeFile(list, JSON.stringify(file));
  await memes.prepare();
  const state = await memes.state();
  expect(state.memes[0]).toEqual({ id: "sad-cat", name: "Sad cat", meaning: "Sad." });
  // The built-in it replaced stays gone.
  expect(state.memes.some((m) => m.id === builtInMemes[0]!.id)).toBe(false);
});

it("says what's wrong with a broken memes.json instead of overwriting it", async () => {
  await memes.prepare();
  const list = join(dir, "memes", "memes.json");
  await writeFile(list, "{ nope");
  const state = await memes.prepare();
  expect(state.setUp).toBe(true);
  expect(state.memes).toEqual([]);
  expect(state.problems[0]).toMatch(/^memes.json isn't valid JSON/);
  expect(await readFile(list, "utf8")).toBe("{ nope");
  // Valid JSON, but not a list where the memes go.
  const odd = '{ "memes": { "dew": "drake" } }';
  await writeFile(list, odd);
  expect((await memes.prepare()).problems[0]).toMatch(/"memes" list/);
  expect(await readFile(list, "utf8")).toBe(odd);
});
