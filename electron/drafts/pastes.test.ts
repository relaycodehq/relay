import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readPaste, savePaste, setPastesRoot, sweepPastes } from "./pastes";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-pastes-"));
  setPastesRoot(root);
});

afterEach(() => rm(root, { recursive: true, force: true }));

it("keeps each paste in a folder of its own under its message's name", async () => {
  const first = await savePaste("one", 1);
  const second = await savePaste("two", 2);
  expect(basename(first)).toBe("pasted-text.txt");
  expect(basename(second)).toBe("pasted-text-2.txt");
  expect(dirname(first)).not.toBe(dirname(second));
  expect(await readFile(second, "utf8")).toBe("two");
});

it("treats a paste whose file is gone as nothing to carry", async () => {
  const path = await savePaste("one", 1);
  await rm(dirname(path), { recursive: true });
  expect(await readPaste(path, 0, 10)).toBeNull();
});

it("sweeps old pastes that no saved thread names, and keeps the rest", async () => {
  const kept = await savePaste("kept", 1);
  const named = await savePaste("named", 1);
  const fresh = await savePaste("fresh", 1);
  const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  for (const path of [kept, named]) await utimes(dirname(path), longAgo, longAgo);
  const chats = join(root, "..", basename(root) + "-chats");
  await mkdir(chats);
  try {
    await writeFile(join(chats, "a.json"), JSON.stringify({ body: `\`${named}\`` }));
    await sweepPastes([chats]);
    expect(await readFile(named, "utf8")).toBe("named");
    expect(await readFile(fresh, "utf8")).toBe("fresh");
    await expect(readFile(kept, "utf8")).rejects.toThrow();
  } finally {
    await rm(chats, { recursive: true, force: true });
  }
});
