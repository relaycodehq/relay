import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  realpath,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoomsDatabase, token } from "../../server/database";
import { SharedWorkspace } from "../../server/workspace";
import { LiveSync, type SyncTransport } from "../../electron/live-sync";
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
let dir: string,
  a: string,
  b: string,
  db: RoomsDatabase,
  workspace: SharedWorkspace,
  alice: ReturnType<RoomsDatabase["create"]>,
  bob: typeof alice,
  room: string,
  sa: LiveSync,
  sb: LiveSync;
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const file = "code.ts",
  base = "export const a = 1;\nexport const b = 1;\n";
function transport(s: typeof alice): SyncTransport {
  return async (path, method = "GET", body) => {
    if (path === "" && method === "POST")
      return workspace.open(s, room, (body as { base: string }).base);
    if (path === "") return workspace.manifest(s, room);
    if (method === "PUT") return workspace.write(s, room, body);
    return workspace.read(
      s,
      room,
      new URL("http://test" + path).searchParams.get("path")!,
    );
  };
}
function client(root: string, s: typeof alice) {
  return new LiveSync(
    root,
    join(dir, root === a ? "alice.json" : "bob.json"),
    transport(s),
    async () => {},
    60000,
  );
}
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-sync-")));
  a = join(dir, "alice");
  b = join(dir, "bob");
  await mkdir(a);
  git(a, "init", "-q", "-b", "review");
  git(a, "config", "user.name", "Alice");
  git(a, "config", "user.email", "a@example.invalid");
  await writeFile(join(a, file), base);
  await writeFile(join(a, ".gitignore"), ".env\nignored/\n");
  git(a, "add", ".");
  git(a, "commit", "-qm", "Base");
  execFileSync("git", ["clone", "-q", a, b]);
  git(b, "config", "user.name", "Bob");
  git(b, "config", "user.email", "b@example.invalid");
  db = new RoomsDatabase(":memory:");
  workspace = new SharedWorkspace(db);
  alice = db.create(
    { server: "https://example.test", owner: "team", name: "repo" },
    "Alice",
    token(),
  );
  bob = db.join(alice.projectId, db.invite(alice).code, "Bob", token());
  room = db.open(alice, 7, "Review").id;
  sa = client(a, alice);
  sb = client(b, bob);
  await sa.start();
  await sb.start();
});
afterEach(async () => {
  await sa?.stop();
  await sb?.stop();
  db?.close();
  await rm(dir, { recursive: true, force: true });
});
it("syncs saved edits, new files, deletions and reversions without changing Git’s index", async () => {
  await writeFile(join(a, file), base.replace("a = 1", "a = 2"));
  await sa.tick();
  await sb.tick();
  expect(await readFile(join(b, file), "utf8")).toContain("a = 2");
  expect(git(b, "diff", "--cached")).toBe("");
  await mkdir(join(b, "src"));
  await writeFile(join(b, "src/new.ts"), "export const newCode = true;\n");
  await sb.tick();
  await sa.tick();
  expect(await readFile(join(a, "src/new.ts"), "utf8")).toContain("newCode");
  await rm(join(a, "src/new.ts"));
  await sa.tick();
  await sb.tick();
  await expect(readFile(join(b, "src/new.ts"))).rejects.toThrow();
  await writeFile(join(a, file), base);
  await sa.tick();
  await sb.tick();
  expect(await readFile(join(b, file), "utf8")).toBe(base);
  expect(sa.status().conflicts).toEqual([]);
  expect(sb.status().excluded).toEqual([]);
});
it("keeps both concurrent versions, requires reviewed conflict versions, and resumes from checkpoint", async () => {
  await writeFile(join(a, file), "Alice version\n");
  await writeFile(join(b, file), "Bob version\n");
  await sa.tick();
  await sb.tick();
  expect(sb.status().conflicts).toEqual([{ path: file, author: "Alice" }]);
  expect(await readFile(join(b, file), "utf8")).toBe("Bob version\n");
  const conflict = await sb.conflict(file);
  expect(conflict.shared?.contents).toBe("Alice version\n");
  await writeFile(join(b, file), "Bob updated\n");
  await expect(
    sb.resolve(file, "local", conflict.revision, conflict.localHash),
  ).rejects.toThrow("changed again");
  const latest = await sb.conflict(file);
  await sb.resolve(file, "local", latest.revision, latest.localHash);
  await sa.tick();
  expect(await readFile(join(a, file), "utf8")).toBe("Bob updated\n");
  await sb.stop();
  sb = client(b, bob);
  await writeFile(join(a, file), "Saved while Bob offline\n");
  await sa.tick();
  await sb.start();
  expect(await readFile(join(b, file), "utf8")).toBe(
    "Saved while Bob offline\n",
  );
  expect(sb.status().conflicts).toEqual([]);
  expect(await readFile(join(dir, "bob.json"), "utf8")).not.toContain(
    "Saved while",
  );
});
it("preserves staged contents, local commits and pauses on branch switches", async () => {
  await writeFile(join(b, file), "Staged Bob\n");
  git(b, "add", file);
  await sb.tick();
  await sa.tick();
  await writeFile(join(a, file), "Alice saved\n");
  await sa.tick();
  await sb.tick();
  expect(git(b, "show", `:code.ts`)).toBe("Staged Bob");
  expect(await readFile(join(b, file), "utf8")).toBe("Alice saved\n");
  git(b, "commit", "-qm", "Commit staged");
  await sb.tick();
  expect(sb.status().error).toBeNull();
  git(b, "switch", "-qc", "other");
  await writeFile(join(a, file), "Do not apply on other branch\n");
  await sa.tick();
  await sb.tick();
  expect(sb.status().error).toContain("return to branch");
  expect(await readFile(join(b, file), "utf8")).toBe("Alice saved\n");
});
it("excludes ignored and unsafe files and authorizes room/file writes", async () => {
  await writeFile(join(a, ".env"), "secret");
  await symlink("../outside", join(a, "link"));
  await writeFile(join(a, "binary"), Buffer.from([0, 1]));
  await sa.tick();
  const manifest = workspace.manifest(alice, room);
  expect(manifest.files.some((f) => f.path === ".env")).toBe(false);
  expect(sa.status().excluded.map((f) => f.path)).toEqual(["binary", "link"]);
  const other = db.create(
    { server: "https://example.test", owner: "team", name: "other" },
    "Other",
    token(),
  );
  expect(() => workspace.manifest(other, room)).toThrow("Room not found");
  for (const path of ["../escape", ".git/config", "dir/../../escape", "a\\b"])
    expect(() =>
      workspace.write(alice, room, {
        path,
        expected: 0,
        value: { contents: "oops", mode: 0o644 },
      }),
    ).toThrow();
  const first = workspace.write(alice, room, {
    path: "safe.ts",
    expected: 0,
    value: { contents: "one", mode: 0o644 },
  });
  expect(() =>
    workspace.write(bob, room, {
      path: "safe.ts",
      expected: 0,
      value: { contents: "two", mode: 0o644 },
    }),
  ).toThrow("colleague changed");
  expect(workspace.read(alice, room, "safe.ts").revision).toBe(first.revision);
});
it("refuses shared files under names Windows reads as the .git folder", async () => {
  // Windows drops a trailing dot, knows .git as GIT~1 and opens it through a
  // stream name, so each of these would land in .git/hooks on a Windows peer.
  for (const path of [
    ".git./hooks/post-checkout",
    ".git /hooks/post-checkout",
    "GIT~1/hooks/post-checkout",
    ".git::$INDEX_ALLOCATION/hooks/post-checkout",
    "sub/.git.",
  ])
    expect(() =>
      workspace.write(alice, room, {
        path,
        expected: 0,
        value: { contents: "#!/bin/sh\n", mode: 0o755 },
      }),
    ).toThrow("Unsafe repository path");
  for (const path of [".github/ci.yml", ".gitignore", "notes:draft.md"])
    workspace.write(alice, room, {
      path,
      expected: 0,
      value: { contents: "fine\n", mode: 0o644 },
    });
  await sb.tick();
  expect(await readFile(join(b, ".github/ci.yml"), "utf8")).toBe("fine\n");
  expect(await readFile(join(b, "notes:draft.md"), "utf8")).toBe("fine\n");
});
