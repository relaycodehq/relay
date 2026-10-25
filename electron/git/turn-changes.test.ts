import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readlink, rm, symlink, stat, writeFile } from "node:fs/promises";
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
} from "./turn-changes";
import { gitIn, tempRepo } from "../../tests/fixtures/git-repo";

let root: string;
const git = (...args: string[]) => gitIn(root, ...args);

beforeEach(async () => {
  root = await tempRepo("relay-turn-");
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

it("lists only files the agent changed itself, not edits made meanwhile by anyone else", async () => {
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
  expect(files.map((f) => f.path)).toEqual(["a.ts", "gone.ts"]);
  // Only the agent's files can be rolled back from its card.
  await expect(turnDiff(root, id, "a.ts")).resolves.toBeTruthy();
});

it("keeps no ref when only someone else changed files during the turn", async () => {
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "a.ts"), "theirs\n");
  expect(
    await finishTurn(root, id, before!, id, { edited: [], commands: [] }),
  ).toEqual([]);
  expect(() => git("rev-parse", "--verify", "-q", turnRef(id))).toThrow();
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

it("returns both sides of a changed image so the diff can show it", async () => {
  const png = (tag: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, tag]);
  await writeFile(join(root, "logo.png"), png(1));
  await writeFile(join(root, "notes.bin"), png(1));
  git("add", ".");
  git("commit", "-qm", "Binaries");
  const id = randomUUID();
  const before = await startTurn(root, id);
  await writeFile(join(root, "logo.png"), png(2));
  await writeFile(join(root, "notes.bin"), png(2));
  await writeFile(join(root, "new.png"), png(3));
  await finishTurn(root, id, before!);

  const dataUrl = (tag: number) =>
    `data:image/png;base64,${png(tag).toString("base64")}`;
  expect((await turnDiff(root, id, "logo.png")).images).toEqual({
    old: dataUrl(1),
    next: dataUrl(2),
  });
  expect((await turnDiff(root, id, "new.png")).images).toEqual({
    old: null,
    next: dataUrl(3),
  });
  const other = await turnDiff(root, id, "notes.bin");
  expect(other.binary).toBe(true);
  expect(other.images).toBeUndefined();
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

it("rolls back and redoes a turn that added and retargeted symlinks", async () => {
  await symlink("a.ts", join(root, "moved"));
  git("add", ".");
  git("commit", "-qm", "Link");
  const id = randomUUID();
  const before = (await startTurn(root, id))!;
  await symlink("a.ts", join(root, "link"));
  await rm(join(root, "moved"));
  await symlink("gone.ts", join(root, "moved"));
  await finishTurn(root, id, before);

  const result = await revertTurn(root, id, ["link", "moved"]);
  expect(result.conflicts).toEqual([]);
  expect(existsSync(join(root, "link"))).toBe(false);
  expect(await readlink(join(root, "moved"))).toBe("a.ts");
  const redo = await redoRevert(root, id, result.undo!, ["link", "moved"]);
  expect(redo.conflicts).toEqual([]);
  expect(await readlink(join(root, "link"))).toBe("a.ts");
  expect(await readlink(join(root, "moved"))).toBe("gone.ts");
});

it.skipIf(process.platform === "win32")(
  "rolls back and redoes executable-bit changes without content changes",
  async () => {
    git("config", "core.filemode", "true");
    await chmod(join(root, "a.ts"), 0o644);
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await chmod(join(root, "a.ts"), 0o755);
    expect(await finishTurn(root, id, before)).toEqual([
      { path: "a.ts", additions: 0, deletions: 0 },
    ]);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o644);
    expect(git("status", "--porcelain")).toBe("");
    expect(result.undo).toBeTruthy();
    await redoRevert(root, id, result.undo!, ["a.ts"]);
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps a private file private when rolling back and redoing only its executable bit",
  async () => {
    git("config", "core.filemode", "true");
    await chmod(join(root, "a.ts"), 0o600);
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await chmod(join(root, "a.ts"), 0o700);
    await finishTurn(root, id, before);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o600);
    await redoRevert(root, id, result.undo!, ["a.ts"]);
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o700);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps private permissions when restoring a file with different contents",
  async () => {
    await chmod(join(root, "a.ts"), 0o600);
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await writeFile(join(root, "a.ts"), "one\nTWO\n");
    await finishTurn(root, id, before);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect(await read("a.ts")).toBe("one\ntwo\n");
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o600);
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "restores already deleted files if a later checkout fails",
  async () => {
    await mkdir(join(root, "locked"));
    await writeFile(join(root, "locked", "old.txt"), "old\n");
    git("add", ".");
    git("commit", "-qm", "Directory");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await rm(join(root, "locked", "old.txt"));
    await writeFile(join(root, "created.txt"), "created\n");
    await chmod(join(root, "created.txt"), 0o600);
    const paths = (await finishTurn(root, id, before)).map((file) => file.path);
    const status = git("status", "--porcelain");
    await chmod(join(root, "locked"), 0o555);
    try {
      await expect(revertTurn(root, id, paths)).rejects.toThrow(
        "Permission denied",
      );
      expect(await read("created.txt")).toBe("created\n");
      expect((await stat(join(root, "created.txt"))).mode & 0o777).toBe(0o600);
      expect(await read("locked/old.txt")).toBeNull();
      expect(git("status", "--porcelain")).toBe(status);
      expect(
        git("for-each-ref", "refs/relay/rewinds", "refs/relay/reverts"),
      ).toBe("");
    } finally {
      await chmod(join(root, "locked"), 0o755);
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "keeps and reports the durable preimage if filesystem recovery also fails",
  async () => {
    await mkdir(join(root, "locked"));
    await writeFile(join(root, "locked", "old.txt"), "old\n");
    await writeFile(
      join(root, ".gitattributes"),
      "locked/old.txt filter=fail\n",
    );
    git("add", ".");
    git("commit", "-qm", "Directory");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await rm(join(root, "locked", "old.txt"));
    await writeFile(join(root, "created.txt"), "created\n");
    const paths = (await finishTurn(root, id, before)).map((file) => file.path);
    // The failed checkout makes the root unwritable after created.txt was
    // deleted, so the recovery write fails too. This script lives only in the fixture.
    await writeFile(
      join(root, ".git", "fail-smudge"),
      'chmod 555 "$PWD"\nexit 1\n',
    );
    git("config", "filter.fail.clean", "cat");
    git("config", "filter.fail.smudge", "sh .git/fail-smudge");
    git("config", "filter.fail.required", "true");
    try {
      const error = await revertTurn(root, id, paths).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Recovery also failed");
      const ref = /Git ref (refs\/relay\/rewinds\/[a-f0-9-]+)/.exec(
        (error as Error).message,
      )?.[1];
      expect(ref).toBeDefined();
      expect(git("show", `${ref}:created.txt`)).toBe("created");
      expect(
        git("for-each-ref", "--format=%(refname)", "refs/relay/rewinds"),
      ).toBe(ref);
    } finally {
      await chmod(root, 0o755);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps later contents when rolling back an executable-bit change",
  async () => {
    git("config", "core.filemode", "true");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await chmod(join(root, "a.ts"), 0o755);
    await finishTurn(root, id, before);
    await writeFile(join(root, "a.ts"), "one\ntwo\nlater\n");
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect(await read("a.ts")).toBe("one\ntwo\nlater\n");
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o644);
    await redoRevert(root, id, result.undo!, ["a.ts"]);
    expect(await read("a.ts")).toBe("one\ntwo\nlater\n");
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps a later executable-bit change when rolling back content",
  async () => {
    git("config", "core.filemode", "true");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await writeFile(join(root, "a.ts"), "one\nTWO\n");
    await finishTurn(root, id, before);
    await chmod(join(root, "a.ts"), 0o755);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect(await read("a.ts")).toBe("one\ntwo\n");
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps a later executable-bit change when the user already restored the original contents",
  async () => {
    git("config", "core.filemode", "true");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await writeFile(join(root, "a.ts"), "one\nTWO\n");
    await finishTurn(root, id, before);
    await writeFile(join(root, "a.ts"), "one\ntwo\n");
    await chmod(join(root, "a.ts"), 0o755);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect(await read("a.ts")).toBe("one\ntwo\n");
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === "win32")(
  "preserves later binary contents when rolling back only an executable bit",
  async () => {
    git("config", "core.filemode", "true");
    await writeFile(join(root, "a.ts"), Buffer.from([0, 1, 2]));
    git("commit", "-qam", "Binary");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await chmod(join(root, "a.ts"), 0o755);
    await finishTurn(root, id, before);
    const later = Buffer.from([0, 3, 4]);
    await writeFile(join(root, "a.ts"), later);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect(await readFile(join(root, "a.ts"))).toEqual(later);
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o644);
  },
);

it("rolls back and redoes directory-to-file replacements", async () => {
  await mkdir(join(root, "a"));
  await writeFile(join(root, "a", "nested.txt"), "nested\n");
  git("add", ".");
  git("commit", "-qm", "Directory");
  const id = randomUUID();
  const before = (await startTurn(root, id))!;
  await rm(join(root, "a"), { recursive: true });
  await writeFile(join(root, "a"), "replacement\n");
  const paths = (await finishTurn(root, id, before)).map((file) => file.path);
  const result = await revertTurn(root, id, paths);
  expect(result.conflicts).toEqual([]);
  expect(await read("a/nested.txt")).toBe("nested\n");
  expect(git("status", "--porcelain")).toBe("");
  expect(git("for-each-ref", "--format=%(refname)", "refs/relay/reverts")).toBe(
    revertRef(id, result.undo!),
  );
  expect((await redoRevert(root, id, result.undo!, paths)).conflicts).toEqual(
    [],
  );
  expect(await read("a")).toBe("replacement\n");
});

it("rolls back and redoes file-to-directory replacements", async () => {
  const id = randomUUID();
  const before = (await startTurn(root, id))!;
  await rm(join(root, "a.ts"));
  await mkdir(join(root, "a.ts"));
  await writeFile(join(root, "a.ts", "nested.txt"), "nested\n");
  const paths = (await finishTurn(root, id, before)).map((file) => file.path);
  const result = await revertTurn(root, id, paths);
  expect(result.conflicts).toEqual([]);
  expect(await read("a.ts")).toBe("one\ntwo\n");
  expect(git("status", "--porcelain")).toBe("");
  expect((await redoRevert(root, id, result.undo!, paths)).conflicts).toEqual(
    [],
  );
  expect(await read("a.ts/nested.txt")).toBe("nested\n");
});

it("does not replace a directory containing later or ignored files, even when forced", async () => {
  const id = randomUUID();
  const before = (await startTurn(root, id))!;
  await rm(join(root, "a.ts"));
  await mkdir(join(root, "a.ts", "build"), { recursive: true });
  await writeFile(join(root, "a.ts", "nested.txt"), "nested\n");
  const paths = (await finishTurn(root, id, before)).map((file) => file.path);
  await writeFile(join(root, "a.ts", "build", "later.txt"), "keep me\n");
  for (const force of [false, true]) {
    expect(await revertTurn(root, id, paths, force)).toEqual({
      moved: [],
      conflicts: ["a.ts"],
    });
    expect(await read("a.ts/nested.txt")).toBe("nested\n");
    expect(await read("a.ts/build/later.txt")).toBe("keep me\n");
  }
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

it.skipIf(process.platform === "win32")(
  "preserves private permissions while merging a content rollback",
  async () => {
    await writeFile(join(root, "a.ts"), "1\n2\n3\n4\n5\n6\n7\n8\n");
    git("commit", "-qam", "Longer");
    const id = randomUUID();
    const before = (await startTurn(root, id))!;
    await writeFile(join(root, "a.ts"), "1\nTWO\n3\n4\n5\n6\n7\n8\n");
    await finishTurn(root, id, before);
    await writeFile(join(root, "a.ts"), "1\nTWO\n3\n4\n5\n6\n7\nEIGHT\n");
    await chmod(join(root, "a.ts"), 0o600);
    const result = await revertTurn(root, id, ["a.ts"]);
    expect(result.conflicts).toEqual([]);
    expect(await read("a.ts")).toBe("1\n2\n3\n4\n5\n6\n7\nEIGHT\n");
    expect((await stat(join(root, "a.ts"))).mode & 0o777).toBe(0o600);
  },
);

it("writes nothing when any file of the turn conflicts", async () => {
  const id = await agentTurn();
  await writeFile(join(root, "src", "deep", "new.ts"), "fresh\nmine\n");
  const result = await revertTurn(root, id, ["a.ts", "src/deep/new.ts"]);
  expect(result.conflicts).toEqual(["src/deep/new.ts"]);
  expect(await read("a.ts")).toBe("one\nTWO\n");
});
