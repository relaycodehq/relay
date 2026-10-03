import { beforeEach, afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  realpath,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  rename,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workingTree, workingDiff, performGitAction } from "./working-tree";
import { revisionDiff } from "./turn-changes";
let root: string, remote: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-git-")));
  remote = await mkdtemp(join(tmpdir(), "relay-origin-"));
  execFileSync("git", ["init", "--bare", "-q", remote]);
  git("init", "-q", "-b", "review");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", remote);
  await writeFile(join(root, "code.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  git("push", "-qu", "origin", "review");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
});
it("keeps partially staged work separate, commits only the index, then pushes explicitly", async () => {
  await writeFile(join(root, "code.ts"), "export const a = 2;\n");
  git("add", "code.ts");
  await writeFile(join(root, "code.ts"), "export const a = 3;\n");
  expect(
    (await workingDiff(root, "code.ts", "staged")).next?.contents,
  ).toContain("= 2");
  expect(
    (await workingDiff(root, "code.ts", "unstaged")).next?.contents,
  ).toContain("= 3");
  let tree = await workingTree(root);
  expect(tree.changes[0]).toMatchObject({ index: "M", worktree: "M" });
  tree = await performGitAction(root, {
    kind: "commit",
    revision: tree.revision,
    message: "Only staged",
  });
  expect(git("show", "HEAD:code.ts")).toContain("= 2");
  expect(await readFile(join(root, "code.ts"), "utf8")).toContain("= 3");
  expect(tree.ahead).toBe(1);
  await performGitAction(root, { kind: "push", revision: tree.revision });
  expect((await workingTree(root)).ahead).toBe(0);
});
it("commits only the chosen files and leaves the rest of the checkout alone", async () => {
  await writeFile(join(root, "gone.ts"), "x\n");
  git("add", "gone.ts");
  git("commit", "-qm", "Add gone");
  await writeFile(join(root, "code.ts"), "export const a = 2;\n");
  await writeFile(join(root, "new.ts"), "new\n");
  await rm(join(root, "gone.ts"));
  await writeFile(join(root, "staged.ts"), "someone else's\n");
  await writeFile(join(root, "other.ts"), "not mine\n");
  git("add", "staged.ts");
  let tree = await workingTree(root);
  tree = await performGitAction(root, {
    kind: "commit",
    revision: tree.revision,
    message: "Chosen files",
    paths: ["code.ts", "new.ts", "gone.ts"],
  });
  expect(
    git("show", "--name-status", "--format=", "HEAD").split("\n").sort(),
  ).toEqual(["A\tnew.ts", "D\tgone.ts", "M\tcode.ts"]);
  expect(tree.changes.map((c) => [c.path, c.index]).sort()).toEqual([
    ["other.ts", "?"],
    ["staged.ts", "A"],
  ]);
  await expect(
    performGitAction(root, {
      kind: "commit",
      revision: tree.revision,
      message: "Stale",
      paths: ["code.ts"],
    }),
  ).rejects.toThrow("no longer changed");
});
it("commits chosen files that were deleted or renamed through the index", async () => {
  await writeFile(join(root, "a.txt"), "a\n");
  await writeFile(join(root, "c.txt"), "c\n");
  git("add", ".");
  git("commit", "-qm", "Add a and c");
  git("rm", "-q", "a.txt");
  git("mv", "c.txt", "d.txt");
  await writeFile(join(root, "other.ts"), "not mine\n");
  let tree = await workingTree(root);
  expect(tree.changes.find((c) => c.path === "d.txt")?.previousPath).toBe(
    "c.txt",
  );
  tree = await performGitAction(root, {
    kind: "commit",
    revision: tree.revision,
    message: "Remove and rename",
    paths: ["a.txt", "d.txt"],
  });
  expect(
    git("show", "--name-status", "--format=", "-M", "HEAD").split("\n").sort(),
  ).toEqual(["D\ta.txt", "R100\tc.txt\td.txt"]);
  expect(tree.changes.map((c) => c.path)).toEqual(["other.ts"]);
});
it("works in a repository with no commits yet, first commit included", async () => {
  const fresh = await realpath(await mkdtemp(join(tmpdir(), "relay-fresh-")));
  try {
    const run = (...args: string[]) =>
      execFileSync("git", ["-C", fresh, ...args], { encoding: "utf8" }).trim();
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.invalid");
    await writeFile(join(fresh, "first.ts"), "one\ntwo\n");
    await writeFile(join(fresh, "staged.ts"), "x\n");
    await writeFile(join(fresh, "left.ts"), "left\n");
    run("add", "staged.ts");
    let tree = await workingTree(fresh);
    expect(tree.head).toBe("");
    expect(tree.branch).toBe("main");
    expect(tree.lines).toEqual({ additions: 4, deletions: 0 });
    tree = await performGitAction(fresh, {
      kind: "commit",
      revision: tree.revision,
      message: "First",
      paths: ["first.ts", "staged.ts"],
    });
    expect(
      run("show", "--name-status", "--format=", "HEAD").split("\n").sort(),
    ).toEqual(["A\tfirst.ts", "A\tstaged.ts"]);
    expect(tree.changes.map((c) => c.path)).toEqual(["left.ts"]);
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
});
it("unstages and discards staged files in a repository with no commits yet", async () => {
  const fresh = await realpath(await mkdtemp(join(tmpdir(), "relay-fresh-")));
  try {
    const run = (...args: string[]) =>
      execFileSync("git", ["-C", fresh, ...args], { encoding: "utf8" }).trim();
    run("init", "-q", "-b", "main");
    await writeFile(join(fresh, "keep.ts"), "keep\n");
    await writeFile(join(fresh, "drop.ts"), "drop\n");
    await writeFile(join(fresh, "loose.ts"), "loose\n");
    run("add", "keep.ts", "drop.ts");
    const trashed: string[] = [];
    const trash = async (file: string) => {
      trashed.push(await readFile(file, "utf8"));
    };
    let tree = await workingTree(fresh);
    tree = await performGitAction(fresh, {
      kind: "unstage",
      revision: tree.revision,
      paths: ["keep.ts"],
    });
    expect(tree.changes.find((c) => c.path === "keep.ts")?.index).toBe("?");
    run("add", "keep.ts");
    tree = await workingTree(fresh);
    tree = await performGitAction(
      fresh,
      {
        kind: "discard",
        revision: tree.revision,
        paths: ["drop.ts"],
        area: "staged",
      },
      trash,
    );
    expect(trashed).toEqual(["drop\n"]);
    expect(tree.changes.map((c) => c.path)).toEqual(["keep.ts", "loose.ts"]);
    expect(await readFile(join(fresh, "keep.ts"), "utf8")).toBe("keep\n");
    await expect(readFile(join(fresh, "drop.ts"))).rejects.toThrow();
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
});
it("loads and pulls an unborn branch whose upstream already has commits", async () => {
  const fresh = await realpath(await mkdtemp(join(tmpdir(), "relay-fresh-")));
  try {
    const run = (...args: string[]) =>
      execFileSync("git", ["-C", fresh, ...args], { encoding: "utf8" }).trim();
    run("init", "-q", "-b", "main");
    run("remote", "add", "origin", remote);
    git("push", "-q", "origin", "review:main");
    run("fetch", "-q");
    run("config", "branch.main.remote", "origin");
    run("config", "branch.main.merge", "refs/heads/main");
    let tree = await workingTree(fresh);
    expect(tree).toMatchObject({
      head: "",
      upstream: "origin/main",
      ahead: 0,
      behind: 1,
      outgoing: [],
    });
    tree = await performGitAction(fresh, {
      kind: "pull",
      revision: tree.revision,
    });
    expect(tree.head).not.toBe("");
    expect(tree.behind).toBe(0);
    expect(await readFile(join(fresh, "code.ts"), "utf8")).toContain("a = 1");
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
});
it("handles literal odd filenames, renames, deletion and untracked files", async () => {
  const name = ":(glob)* weird\nfile.ts";
  await writeFile(join(root, name), "new\n");
  let tree = await workingTree(root);
  expect((await workingDiff(root, name, "unstaged")).old).toBeNull();
  tree = await performGitAction(root, {
    kind: "stage",
    revision: tree.revision,
    paths: [name],
  });
  expect(tree.changes.find((c) => c.path === name)?.index).toBe("A");
  tree = await performGitAction(root, {
    kind: "unstage",
    revision: tree.revision,
    paths: [name],
  });
  expect(tree.changes.find((c) => c.path === name)?.index).toBe("?");
  await rename(join(root, "code.ts"), join(root, "renamed.ts"));
  git("add", "-A");
  tree = await workingTree(root);
  expect(tree.changes.find((c) => c.path === "renamed.ts")?.previousPath).toBe(
    "code.ts",
  );
  expect((await workingDiff(root, "renamed.ts", "staged")).old?.name).toBe(
    "code.ts",
  );
  await performGitAction(root, {
    kind: "unstage",
    revision: tree.revision,
    paths: ["renamed.ts"],
  });
  expect(
    git("diff", "--cached", "--name-only", "--", "code.ts", "renamed.ts"),
  ).toBe("");
  expect(
    (await workingTree(root)).changes.find((c) => c.path === "code.ts")
      ?.worktree,
  ).toBe("D");
});
it("ignores exactly the chosen untracked files, in .gitignore or this clone's exclude", async () => {
  await mkdir(join(root, "logs"));
  const odd = "logs/[a]*? b ";
  for (const name of [odd, "logs/ab b", "logs/x.log", "keep.txt"])
    await writeFile(join(root, name), "x\n");
  await writeFile(join(root, ".gitignore"), "# no trailing newline");
  git("add", ".gitignore");
  git("commit", "-qm", "Ignore file");
  let tree = await workingTree(root);
  tree = await performGitAction(root, {
    kind: "ignore",
    revision: tree.revision,
    paths: [odd],
    file: "gitignore",
  });
  tree = await performGitAction(root, {
    kind: "ignore",
    revision: tree.revision,
    paths: ["logs/x.log"],
    file: "exclude",
  });
  const untracked = tree.changes
    .filter((c) => c.index === "?")
    .map((c) => c.path)
    .sort();
  expect(untracked).toEqual(["keep.txt", "logs/ab b"]);
  expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
    "# no trailing newline\n/logs/\\[a]\\*\\? b\\ \n",
  );
  expect(git("check-ignore", "-v", "logs/x.log")).toContain("info/exclude");
  await expect(
    performGitAction(root, {
      kind: "ignore",
      revision: tree.revision,
      paths: ["code.ts"],
      file: "gitignore",
    }),
  ).rejects.toThrow("Only untracked files");
});
it("discards back to the index or to HEAD, keeping a copy of each file in the Trash", async () => {
  await writeFile(join(root, "code.ts"), "staged\n");
  git("add", "code.ts");
  await writeFile(join(root, "code.ts"), "staged\nworking\n");
  await writeFile(join(root, "added.ts"), "new\n");
  git("add", "added.ts");
  await writeFile(join(root, "loose.ts"), "untracked\n");
  const trashed: string[] = [];
  const trash = async (file: string) => {
    trashed.push(await readFile(file, "utf8"));
  };
  let tree = await workingTree(root);
  await expect(
    performGitAction(
      root,
      {
        kind: "discard",
        revision: tree.revision,
        paths: ["loose.ts"],
        area: "unstaged",
      },
      trash,
    ),
  ).rejects.toThrow("Only tracked files");
  await expect(
    performGitAction(root, {
      kind: "discard",
      revision: tree.revision,
      paths: ["code.ts"],
      area: "unstaged",
    }),
  ).rejects.toThrow("Trash");
  tree = await performGitAction(
    root,
    {
      kind: "discard",
      revision: tree.revision,
      paths: ["code.ts"],
      area: "unstaged",
    },
    trash,
  );
  expect(await readFile(join(root, "code.ts"), "utf8")).toBe("staged\n");
  expect(tree.changes.find((c) => c.path === "code.ts")).toMatchObject({
    index: "M",
    worktree: " ",
  });
  tree = await performGitAction(
    root,
    {
      kind: "discard",
      revision: tree.revision,
      paths: ["code.ts", "added.ts"],
      area: "staged",
    },
    trash,
  );
  expect(await readFile(join(root, "code.ts"), "utf8")).toBe(
    "export const a = 1;\n",
  );
  expect(tree.changes.map((c) => c.path)).toEqual(["loose.ts"]);
  expect(trashed).toEqual(["staged\nworking\n", "staged\n", "new\n"]);
});
it("shows changed binary and oversized files as binary instead of failing", async () => {
  await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0, 1]));
  await writeFile(join(root, "data.json"), "1".repeat(3 * 1024 * 1024));
  git("add", ".");
  git("commit", "-qm", "Assets");
  await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0, 2]));
  await writeFile(join(root, "data.json"), "2".repeat(3 * 1024 * 1024));
  const binary = { old: null, next: null, binary: true };
  const png = (tag: number) =>
    `data:image/png;base64,${Buffer.from([0x89, 0x50, 0, tag]).toString("base64")}`;
  const images = { old: png(1), next: png(2) };
  expect(await workingDiff(root, "logo.png", "unstaged")).toEqual({
    ...binary,
    images,
  });
  expect(await workingDiff(root, "data.json", "unstaged")).toEqual(binary);
  git("add", ".");
  expect(await workingDiff(root, "logo.png", "staged")).toEqual({
    ...binary,
    images,
  });
  expect(await workingDiff(root, "data.json", "staged")).toEqual(binary);
});
it("rejects stale state and non-fast-forward pushes without changing the working files", async () => {
  await writeFile(join(root, "code.ts"), "local\n");
  const old = await workingTree(root);
  await writeFile(join(root, "code.ts"), "changed again\n");
  await expect(
    performGitAction(root, {
      kind: "stage",
      revision: old.revision,
      paths: ["code.ts"],
    }),
  ).rejects.toThrow("checkout changed");
  expect(git("diff", "--cached")).toBe("");
  git("add", ".");
  git("commit", "-qm", "Local");
  const tree = await workingTree(root);
  git("checkout", "--detach", "-q", "HEAD~1");
  await writeFile(join(root, "other"), "remote\n");
  git("add", ".");
  git("commit", "-qm", "Other");
  git("push", "-q", "origin", "HEAD:review");
  git("checkout", "-q", "review");
  await expect(
    performGitAction(root, {
      kind: "push",
      revision: (await workingTree(root)).revision,
    }),
  ).rejects.toThrow(/rejected|fetch first/);
  expect(git("rev-parse", "HEAD")).toBe(tree.head);
});
it("hides a token kept in the push remote's address", async () => {
  // Gitea and GitHub both accept a token in place of the user name.
  for (const [url, shown] of [
    [
      "https://s3cret-token@git.example.invalid/team/repo.git",
      "https://[redacted]@git.example.invalid/team/repo.git",
    ],
    [
      "https://oauth2:s3cret-token@git.example.invalid/team/repo.git",
      "https://[redacted]@git.example.invalid/team/repo.git",
    ],
    [
      "ssh://git@git.example.invalid/team/repo.git",
      "ssh://git@git.example.invalid/team/repo.git",
    ],
  ]) {
    git("remote", "set-url", "--push", "origin", url);
    expect((await workingTree(root)).pushUrl).toBe(shown);
  }
});
it("changes its revision when only the staged part of a changed file moves", async () => {
  await writeFile(join(root, "untouched.ts"), "export const u = 1;\n");
  git("add", "untouched.ts");
  git("commit", "-qm", "Second file");
  await writeFile(join(root, "code.ts"), "export const a = 3;\n");
  const stage = (text: string) => {
    const blob = execFileSync(
      "git",
      ["-C", root, "hash-object", "-w", "--stdin"],
      { input: text, encoding: "utf8" },
    ).trim();
    git("update-index", "--cacheinfo", `100644,${blob},code.ts`);
  };
  stage("export const a = 2;\n");
  const before = await workingTree(root);
  // Same status line (MM) and the same working file; only the index differs.
  stage("export const a = 4;\n");
  const after = await workingTree(root);
  expect(after.changes).toEqual(before.changes);
  expect(after.revision).not.toBe(before.revision);
  // Refreshing unchanged files' index stat data is not a change.
  git("update-index", "-q", "--really-refresh");
  expect((await workingTree(root)).revision).toBe(after.revision);
});
it("lists the other changes beside an untracked nested repository", async () => {
  // Git reports a nested repository as one "inner/" entry it never looks into.
  await mkdir(join(root, "inner"));
  execFileSync("git", ["-C", join(root, "inner"), "init", "-q"]);
  await writeFile(join(root, "inner", "notes.md"), "Mine\n");
  await writeFile(join(root, "code.ts"), "export const a = 2;\n");
  let tree = await workingTree(root);
  expect(tree.changes.map((c) => c.path)).toEqual(["code.ts"]);
  tree = await performGitAction(root, {
    kind: "stage",
    revision: tree.revision,
    paths: ["code.ts"],
  });
  expect(tree.changes[0]).toMatchObject({ path: "code.ts", index: "M" });
});
it("shows Latin-1 files and Git LFS pointers as binary in diffs instead of failing", async () => {
  const lfs =
    "version https://git-lfs.github.com/spec/v1\noid sha256:" +
    "0".repeat(64) +
    "\nsize 3\n";
  await writeFile(join(root, "latin.txt"), Buffer.from("caf\xe9\n", "latin1"));
  await writeFile(join(root, "big.bin"), lfs);
  git("add", ".");
  git("commit", "-qm", "Add odd files");
  await writeFile(join(root, "latin.txt"), Buffer.from("caf\xe9s\n", "latin1"));
  await writeFile(join(root, "big.bin"), lfs.replace("size 3", "size 4"));
  for (const path of ["latin.txt", "big.bin"]) {
    expect((await workingDiff(root, path, "unstaged")).binary).toBe(true);
    expect((await revisionDiff(root, "HEAD~1", "HEAD", path)).binary).toBe(
      true,
    );
  }
});
