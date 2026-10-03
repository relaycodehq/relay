import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalFile, saveLocalFile } from "./local-files";

const ref = { owner: "Web", name: "portal", number: 7 };
const server = "https://git.example.test/gitea";
let root: string, head: string;
const path = "src/code.ts";
const original = "\ufeffexport const count = 1;\r\n";
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const read = () => readLocalFile(root, server, ref, head, path);
const save = (version: string, contents: string) =>
  saveLocalFile(root, server, ref, head, path, version, contents);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-local-file-"));
  git("init", "--quiet");
  git("config", "user.name", "Relay test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  git("remote", "add", "origin", `${server}/Web/portal.git`);
  await mkdir(join(root, "src"));
  await writeFile(join(root, path), original, { mode: 0o755 });
  git("add", ".");
  git("commit", "--quiet", "-m", "PR head");
  head = git("rev-parse", "HEAD");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local code editing", () => {
  it("loads existing work, preserves BOM/EOL/mode, and saves without staging or committing", async () => {
    const local = original.replace("1;", "2;");
    await writeFile(join(root, path), local);
    const file = await read();
    expect(file.original).toBe(original);
    expect(file.contents).toBe(local);
    const edited = local.replace("2;", "3;");
    const result = await save(file.version, edited);
    expect(await readFile(join(root, path), "utf8")).toBe(edited);
    expect((await stat(join(root, path))).mode & 0o777).toBe(0o755);
    expect(git("diff", "--cached")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect((await read()).version).toBe(result.version);
  });
  it("rejects an external change without overwriting it", async () => {
    const file = await read();
    await writeFile(join(root, path), "Changed in PhpStorm\n");
    await expect(save(file.version, "My buffer\n")).rejects.toThrow(
      "changed on disk",
    );
    expect(await readFile(join(root, path), "utf8")).toBe(
      "Changed in PhpStorm\n",
    );
  });
  it("serializes overlapping saves with the same expected version", async () => {
    const file = await read();
    const results = await Promise.allSettled([
      save(file.version, "first\n"),
      save(file.version, "second\n"),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(await readFile(join(root, path), "utf8")).toBe("first\n");
  });
  it("revalidates the checkout and remote before writing", async () => {
    const file = await read();
    await expect(
      saveLocalFile(
        root,
        server,
        ref,
        "a".repeat(40),
        path,
        file.version,
        "bad",
      ),
    ).rejects.toThrow("different commit");
    git("remote", "set-url", "origin", "https://other.test/Web/portal.git");
    await expect(save(file.version, "bad")).rejects.toThrow("remote");
    expect(await readFile(join(root, path), "utf8")).toBe(original);
  });
  it("rejects symlinks, parent symlinks, hard links and paths outside tracked PR files", async () => {
    const file = await read();
    await rename(join(root, path), join(root, "target.ts"));
    await symlink("../target.ts", join(root, path));
    await expect(save(file.version, "bad")).rejects.toThrow("Symbolic links");
    await rm(join(root, path));
    await link(join(root, "target.ts"), join(root, path));
    await expect(read()).rejects.toThrow("Hard-linked");
    await rm(join(root, path));
    await writeFile(join(root, path), original);
    await rename(join(root, "src"), join(root, "actual-src"));
    await symlink("actual-src", join(root, "src"));
    await expect(read()).rejects.toThrow("Symbolic links");
    for (const name of ["../secret", ".git/config", "target.ts"])
      await expect(
        readLocalFile(root, server, ref, head, name),
      ).rejects.toThrow();
    expect(await readFile(join(root, "target.ts"), "utf8")).toBe(original);
  });
  it("rejects binary, non-UTF8, oversized and read-only writes", async () => {
    const file = await read();
    await chmod(join(root, path), 0o444);
    await expect(save(file.version, "bad")).rejects.toThrow("read-only");
    await chmod(join(root, path), 0o644);
    for (const value of [
      Buffer.from([0]),
      Buffer.from([0xff]),
      Buffer.alloc(2 * 1024 * 1024 + 1, 65),
    ]) {
      await writeFile(join(root, path), value);
      await expect(read()).rejects.toThrow();
    }
  });
});
