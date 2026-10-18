import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { savePaste, setPastesRoot } from "./pastes";

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
