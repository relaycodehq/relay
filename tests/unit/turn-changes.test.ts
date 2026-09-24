import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finishTurn,
  ownFiles,
  parseNumstat,
  redoRevert,
  revertRef,
  revertTurn,
  startTurn,
  turnDiff,
  turnRef,
} from "../../electron/turn-changes";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-turn-")));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, ".gitignore"), "build/\n");
  await writeFile(join(root, "a.ts"), "one\ntwo\n");
  await writeFile(join(root, "gone.ts"), "bye\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("lists only what the turn changed and keeps the user's index and prior edits intact", async () => {
  // Work that predates the turn, one piece staged, must not show up.
  await writeFile(join(root, "a.ts"), "one\ntwo\nmine\n");
  await writeFile(join(root, "staged.ts"), "staged\n");
  git("add", "staged.ts");
  const status = git("status", "--porcelain");
  const id = randomUUID();
  const before = await startTurn(root, id);
  expect(before).toMatch(/^[0-9a-f]{40,64}$/);

  await writeFile(join(root, "a.ts"), "one\nTWO\nmine\nthree\n");
  await rm(join(root, "gone.ts"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "new.ts"), "fresh\n");
  await mkdir(join(root, "build"));
  await writeFile(join(root, "build", "out.js"), "ignored\n");

  const files = await finishTurn(root, id, before!);
  expect(files).toEqual([
    { path: "a.ts", additions: 2, deletions: 1 },
    { path: "gone.ts", additions: 0, deletions: 1 },
    { path: "src/new.ts", additions: 1, deletions: 0 },
  ]);
  // The real index is untouched: staged.ts is still the only staged file.
  expect(git("diff", "--cached", "--name-only")).toBe("staged.ts");
  expect(status).toContain("A  staged.ts");

  const pair = await turnDiff(root, id, "a.ts");
  expect(pair.old?.contents).toBe("one\ntwo\nmine\n");
  expect(pair.next?.contents).toBe("one\nTWO\nmine\nthree\n");
  expect((await turnDiff(root, id, "gone.ts")).next).toBeNull();
  expect((await turnDiff(root, id, "src/new.ts")).old).toBeNull();
});

it("lists the agent's own files first and marks edits made meanwhile by anyone else", async () => {
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "b.ts"), "b\n");
  await writeFile(join(root, "src", "b.tsx"), "view\n");
  git("add", ".");
  git("commit", "-qm", "More");
  const id = randomUUID();
  const before = await startTurn(root, id);
  // The agent: a file tool edit (absolute path) and a command naming a file.
  await writeFile(join(root, "a.ts"), "one\nTWO\n");
  await rm(join(root, "gone.ts"));
  // Someone else: the user's editor, another thread, a CLI session.
  await writeFile(join(root, "src", "b.ts"), "theirs\n");
  await writeFile(join(root, "src", "b.tsx"), "theirs\n");
  await writeFile(join(root, "notes.md"), "theirs\n");
  const files = await finishTurn(root, id, before!, id, {
    edited: [join(root, "a.ts")],
    // Names src/b.tsx's neighbour only as part of a longer path.
    commands: ["/bin/zsh -lc 'rm gone.ts && cat src/b.tsx.bak'"],
  });
  expect(files.filter((f) => !f.unclaimed).map((f) => f.path)).toEqual([
    "a.ts",
    "gone.ts",
  ]);
  expect(files.filter((f) => f.unclaimed).map((f) => f.path)).toEqual([
    "notes.md",
    "src/b.ts",
    "src/b.tsx",
  ]);
  // Either kind opens its diff; the card rolls back only the agent's together.
  await expect(turnDiff(root, id, "a.ts")).resolves.toBeTruthy();
  await expect(turnDiff(root, id, "notes.md")).resolves.toBeTruthy();
});

it("keeps the snapshot when only someone else changed files during the turn", async () => {
  // e.g. `rm -rf dir` or a formatter: a command that names no file it changed.
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "theirs\n");
  expect(
    await finishTurn(root, id, before!, id, { edited: [], commands: [] }),
  ).toEqual([{ path: "a.ts", additions: 1, deletions: 2, unclaimed: true }]);
  expect(git("rev-parse", "--verify", "-q", turnRef(id))).toBeTruthy();
});

it("matches the agent's paths whether relative, absolute or dotted", () => {
  const files = [
    { path: "app/src/x.ts", additions: 1, deletions: 0 },
    { path: "app/src/y.ts", additions: 1, deletions: 0 },
    { path: "app/src/z.ts", additions: 1, deletions: 0 },
    { path: "app/src/other.ts", additions: 1, deletions: 0 },
  ];
  expect(
    ownFiles(
      files,
      {
        edited: ["app/src/x.ts", "/repo/app/src/y.ts"],
        commands: ["sed -i '' 's/a/b/' ./app/src/z.ts"],
      },
      "/repo",
    ).map((f) => f.path),
  ).toEqual(["app/src/x.ts", "app/src/y.ts", "app/src/z.ts"]);
});

it("matches a file a command names from the folder it changed into", () => {
  const files = [
    { path: "app/src/x.ts", additions: 1, deletions: 0 },
    { path: "app/src/y.ts", additions: 1, deletions: 0 },
    { path: "web/z.ts", additions: 1, deletions: 0 },
  ];
  expect(
    ownFiles(
      files,
      {
        edited: [],
        commands: [
          `/bin/zsh -lc "cd app/src && sed -i '' 's/a/b/' x.ts"`,
          "cd '/repo/web' && npx prettier --write ./z.ts",
        ],
      },
      "/repo",
    ).map((f) => f.path),
  ).toEqual(["app/src/x.ts", "web/z.ts"]);
});

it("drops the ref when a turn changes nothing", async () => {
  const id = randomUUID();
  const before = await startTurn(root, id);
  expect(git("for-each-ref", "--format=%(refname)", "refs/relay")).toBe(
    turnRef(id),
  );
  expect(await finishTurn(root, id, before!)).toEqual([]);
  expect(git("for-each-ref", "refs/relay")).toBe("");
  await expect(turnDiff(root, id, "a.ts")).rejects.toThrow(
    "no longer available",
  );
});

it("snapshots a repository without commits", async () => {
  await rm(join(root, ".git"), { recursive: true, force: true });
  git("init", "-q", "-b", "main");
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "changed\n");
  expect((await finishTurn(root, id, before!)).map((f) => f.path)).toEqual([
    "a.ts",
  ]);
});

it("marks binary files from numstat", () => {
  expect(parseNumstat("-\t-\timg.png\0" + "3\t0\tb.ts\0")).toEqual([
    { path: "b.ts", additions: 3, deletions: 0 },
    { path: "img.png", additions: 0, deletions: 0, binary: true },
  ]);
});

async function agentTurn() {
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "one\nTWO\n");
  await rm(join(root, "gone.ts"));
  await mkdir(join(root, "src", "deep"), { recursive: true });
  await writeFile(join(root, "src", "deep", "new.ts"), "fresh\n");
  await finishTurn(root, id, before!);
  return id;
}
const read = (path: string) =>
  readFile(join(root, path), "utf8").catch(() => null);

it("rolls a whole turn back and redoes it", async () => {
  const id = await agentTurn();
  const paths = ["a.ts", "gone.ts", "src/deep/new.ts"];
  const result = await revertTurn(root, id, paths);
  expect(result.conflicts).toEqual([]);
  expect(await read("a.ts")).toBe("one\ntwo\n");
  expect(await read("gone.ts")).toBe("bye\n");
  expect(await read("src/deep/new.ts")).toBeNull();
  // Folders the rollback emptied go too.
  expect(existsSync(join(root, "src"))).toBe(false);
  expect(git("status", "--porcelain")).toBe("");
  expect(git("for-each-ref", "--format=%(refname)", "refs/relay/reverts")).toBe(
    revertRef(id, result.undo!),
  );

  expect((await redoRevert(root, id, result.undo!, paths)).conflicts).toEqual(
    [],
  );
  expect(await read("a.ts")).toBe("one\nTWO\n");
  expect(await read("gone.ts")).toBeNull();
  expect(await read("src/deep/new.ts")).toBe("fresh\n");
});

it("rolls back one file and leaves the rest of the turn", async () => {
  const id = await agentTurn();
  await revertTurn(root, id, ["a.ts"]);
  expect(await read("a.ts")).toBe("one\ntwo\n");
  expect(await read("src/deep/new.ts")).toBe("fresh\n");
  expect(await read("gone.ts")).toBeNull();
});

it("keeps later edits that merge and refuses ones that don't", async () => {
  await writeFile(join(root, "a.ts"), "1\n2\n3\n4\n5\n6\n7\n8\n");
  git("commit", "-qam", "Longer");
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "1\nTWO\n3\n4\n5\n6\n7\n8\n");
  await finishTurn(root, id, before!);

  // An edit elsewhere in the file merges: only the turn's line goes back.
  await writeFile(join(root, "a.ts"), "1\nTWO\n3\n4\n5\n6\n7\nEIGHT\n");
  const merged = await revertTurn(root, id, ["a.ts"]);
  expect(merged.conflicts).toEqual([]);
  expect(await read("a.ts")).toBe("1\n2\n3\n4\n5\n6\n7\nEIGHT\n");
  await redoRevert(root, id, merged.undo!, ["a.ts"]);
  expect(await read("a.ts")).toBe("1\nTWO\n3\n4\n5\n6\n7\nEIGHT\n");

  // An edit on the turn's own line conflicts, and nothing is written...
  await writeFile(join(root, "a.ts"), "1\nTwo!\n3\n4\n5\n6\n7\n8\n");
  expect(await revertTurn(root, id, ["a.ts"])).toEqual({
    moved: [],
    conflicts: ["a.ts"],
  });
  expect(await read("a.ts")).toBe("1\nTwo!\n3\n4\n5\n6\n7\n8\n");
  // ...until forced.
  expect((await revertTurn(root, id, ["a.ts"], true)).conflicts).toEqual([]);
  expect(await read("a.ts")).toBe("1\n2\n3\n4\n5\n6\n7\n8\n");
});

it("writes nothing when any file of the turn conflicts", async () => {
  const id = await agentTurn();
  await writeFile(join(root, "src", "deep", "new.ts"), "fresh\nmine\n");
  const result = await revertTurn(root, id, ["a.ts", "src/deep/new.ts"]);
  expect(result.conflicts).toEqual(["src/deep/new.ts"]);
  expect(await read("a.ts")).toBe("one\nTWO\n");
});
