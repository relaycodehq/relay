import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BlameService } from "./blame";

const server = "https://git.example.test/gitea",
  repo = { owner: "Web", name: "portal" };
let root: string, base: string, head: string, service: BlameService;
const roots: string[] = [];
const oldPath = "src/original name.ts",
  newPath = "src/renamed name.ts";
const context = Array.from(
  { length: 8 },
  (_, i) => `export const unchanged${i} = ${i};\n`,
).join("");
const original =
  "export const retained = 1;\nexport const changed = 1;\nexport const removed = 1;\n" +
  context;
const updated =
  "export const retained = 1;\nexport const changed = 2;\n" + context;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-blame-"));
  roots.push(root);
  service = new BlameService();
  git("init", "--quiet");
  git("config", "user.name", "Alice Original");
  git("config", "user.email", "alice@example.invalid");
  git("remote", "add", "origin", `${server}/Web/portal.git`);
  await mkdir(join(root, "src"));
  await writeFile(join(root, oldPath), original);
  git("add", ".");
  git("commit", "--quiet", "-m", "Original implementation");
  base = git("rev-parse", "HEAD");
  git("mv", oldPath, newPath);
  await writeFile(join(root, newPath), updated);
  git("config", "user.name", "Bob Reviewer");
  git("config", "user.email", "bob@example.invalid");
  git("add", ".");
  git("commit", "--quiet", "-m", "Rename and improve implementation");
  head = git("rev-parse", "HEAD");
});
afterEach(async () => {
  service.dispose();
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const blame = (revision: string, path: string, line: number) =>
  service.read(root, server, repo, { revision, path, line });
describe("line blame", () => {
  it("attributes both pinned revisions and renamed/deleted lines without reading working-tree edits", async () => {
    expect(await blame(base, oldPath, 3)).toMatchObject({
      commit: base,
      author: "Alice Original",
      summary: "Original implementation",
      shallow: false,
    });
    expect(await blame(head, newPath, 2)).toMatchObject({
      commit: head,
      author: "Bob Reviewer",
      email: "bob@example.invalid",
      summary: "Rename and improve implementation",
    });
    // Git follows file renames while attributing unchanged lines to their original author.
    expect(await blame(head, newPath, 1)).toMatchObject({
      commit: base,
      author: "Alice Original",
    });
    const local = "// Uncommitted insertion\n" + updated;
    await writeFile(join(root, newPath), local);
    service.dispose();
    expect(await blame(head, newPath, 2)).toMatchObject({
      commit: head,
      author: "Bob Reviewer",
    });
    expect(await readFile(join(root, newPath), "utf8")).toBe(local);
    expect(git("diff", "--cached")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(head);
  });
  it("deduplicates lookups, caches immutable results and cancels superseded work", async () => {
    const query = { revision: head, path: newPath, line: 2 };
    const first = service.read(root, server, repo, query);
    expect(service.read(root, server, repo, query)).toBe(first);
    const result = await first;
    expect(await service.read(root, server, repo, query)).toBe(result);
    const obsolete = blame(base, oldPath, 1).catch((error) => error);
    expect(await blame(base, oldPath, 2)).toMatchObject({
      author: "Alice Original",
    });
    expect(await obsolete).toBeInstanceOf(Error);
    const pending = blame(base, oldPath, 3).catch((error) => error);
    service.dispose();
    expect(await pending).toBeInstanceOf(Error);
  });
  it("rejects bad inputs, missing history, mismatched repositories and nonexistent lines", async () => {
    for (const input of [
      { revision: "--help", path: newPath, line: 2 },
      { revision: head, path: "../secret", line: 2 },
      { revision: head, path: newPath, line: 0 },
    ])
      expect(() => service.read(root, server, repo, input)).toThrow();
    await expect(blame("a".repeat(40), newPath, 2)).rejects.toThrow(
      "Fetch the PR’s history",
    );
    await expect(blame(head, newPath, 9999)).rejects.toThrow(
      "Could not read blame",
    );
    await expect(blame(head, oldPath, 1)).rejects.toThrow(
      "Could not read blame",
    );
    git("remote", "set-url", "origin", "https://other.example/private.git");
    await expect(blame(head, newPath, 1)).rejects.toThrow("no longer matches");
  });
  it("labels incomplete history in shallow clones", async () => {
    const shallow = await mkdtemp(join(tmpdir(), "relay-blame-shallow-"));
    roots.push(shallow);
    execFileSync("git", [
      "clone",
      "--quiet",
      "--depth=1",
      `file://${root}`,
      shallow,
    ]);
    execFileSync("git", [
      "-C",
      shallow,
      "remote",
      "set-url",
      "origin",
      `${server}/Web/portal.git`,
    ]);
    const query = { revision: head, path: newPath, line: 1 };
    const result = await service.read(shallow, server, repo, query);
    expect(result.shallow).toBe(true);
    expect(await service.read(shallow, server, repo, query)).not.toBe(result);
  });
});
