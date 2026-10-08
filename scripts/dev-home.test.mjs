import {
  mkdirSync,
  cpSync,
  lstatSync,
  symlinkSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:fs", async (actual) => {
  const fs = await actual();
  return { ...fs, cpSync: vi.fn(fs.cpSync) };
});

let scratch, home;
beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), "relay-dev-home-test-"));
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "XDG_CONFIG_HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
  ])
    vi.stubEnv(key, scratch);
  vi.resetModules();
  home = await import("./dev-home.mjs");
  expect(home.userData.startsWith(scratch)).toBe(true);
  mkdirSync(home.userData, { recursive: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  const writable = (path) => {
    if (!lstatSync(path).isDirectory()) return;
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) writable(join(path, entry));
  };
  writable(scratch);
  rmSync(scratch, { recursive: true, force: true });
});

it("removes newer saved data, keeps caches, and backs up everything replaced", () => {
  const file = (name) => join(home.userData, name);
  writeFileSync(file("state.json"), "old state");
  const snapshot = home.snapshot("baseline");
  writeFileSync(file("state.json"), "new state");
  writeFileSync(file("usage.jsonl"), "new usage");
  for (const name of ["IndexedDB", "Local Storage", "project-chats", "Cache"]) {
    mkdirSync(file(name));
    writeFileSync(join(file(name), "new"), "newer");
  }
  home.restore(basename(snapshot));
  expect(readFileSync(file("state.json"), "utf8")).toBe("old state");
  expect(readdirSync(home.userData).sort()).toEqual([
    "Cache",
    "Dev snapshots",
    "state.json",
  ]);
  const backup = join(
    file("Dev snapshots"),
    home.listSnapshots().find((name) => name.endsWith("before restore")),
  );
  expect(readFileSync(join(backup, "state.json"), "utf8")).toBe("new state");
  expect(readFileSync(join(backup, "usage.jsonl"), "utf8")).toBe("new usage");
  expect(readFileSync(join(backup, "IndexedDB", "new"), "utf8")).toBe("newer");
});

it("does not touch live data when the snapshot is missing", () => {
  writeFileSync(join(home.userData, "state.json"), "preserve me");
  expect(() => home.restore("missing")).toThrow();
  expect(readFileSync(join(home.userData, "state.json"), "utf8")).toBe(
    "preserve me",
  );
});

it("keeps eight snapshots and uses Windows-safe folder labels", () => {
  for (let i = 0; i < 10; i++) home.snapshot(`branch<>|${i}`);
  expect(home.listSnapshots()).toHaveLength(8);
  expect(home.listSnapshots().every((name) => !/[<>|]/.test(name))).toBe(true);
});

it("uses private control files and never follows a planted temporary symlink", () => {
  home.writeJson(home.recordFile, { initial: true });
  const target = join(scratch, "preserve");
  writeFileSync(target, "untouched");
  symlinkSync(target, home.recordFile + ".tmp");
  home.writeJson(home.recordFile, { changed: true });
  expect(readFileSync(target, "utf8")).toBe("untouched");
  expect(home.readJson(home.recordFile)).toEqual({ changed: true });
  if (process.platform !== "win32") {
    expect(lstatSync(home.controlDir).mode & 0o777).toBe(0o700);
    expect(lstatSync(home.recordFile).mode & 0o777).toBe(0o600);
  }
  rmSync(home.recordFile);
  symlinkSync(target, home.recordFile);
  expect(home.readJson(home.recordFile)).toBeNull();
});

it("refuses a symlink or public control directory", () => {
  const target = join(scratch, "other");
  mkdirSync(target);
  mkdirSync(join(home.controlDir, ".."), { recursive: true });
  symlinkSync(target, home.controlDir, "dir");
  expect(() => home.writeJson(home.recordFile, {})).toThrow(/private/);
  rmSync(home.controlDir);
  mkdirSync(home.controlDir, { mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(home.controlDir, 0o755);
    expect(() => home.writeJson(home.recordFile, {})).toThrow(/private/);
  }
});

it("rejects an unrelated live PID and authenticates a live supervisor endpoint", async () => {
  const token = "fixture-token";
  const server = createServer((socket) => {
    socket.on("data", () => {});
    socket.on("end", () => socket.end(token));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const record = {
      pid: process.pid,
      port: server.address().port,
      token: "stale-token",
    };
    home.writeJson(home.recordFile, record);
    expect(await home.supervisor()).toBeNull();
    home.writeJson(home.recordFile, { ...record, token });
    expect(await home.supervisor()).toMatchObject({ pid: process.pid, token });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

it("rejects traversal, absolute names and snapshot symlinks before touching live data", () => {
  writeFileSync(join(home.userData, "state.json"), "preserve");
  const valid = home.snapshot("baseline");
  const outside = join(scratch, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "state.json"), "injected");
  const root = join(home.userData, "Dev snapshots");
  symlinkSync(outside, join(root, "linked"), "dir");
  for (const name of [
    relative(root, outside),
    outside,
    "linked",
    "..\\outside",
  ]) {
    expect(() => home.snapshotPath(name)).toThrow();
    expect(() => home.restore(name)).toThrow();
  }
  expect(home.snapshotPath(basename(valid))).toBe(valid);
  expect(readFileSync(join(home.userData, "state.json"), "utf8")).toBe(
    "preserve",
  );
});

it("requires exact names or an unambiguous prefix", () => {
  const root = join(home.userData, "Dev snapshots");
  mkdirSync(join(root, "2026-01-01 alpha"), { recursive: true });
  mkdirSync(join(root, "2026-01-02 alphabeta"));
  expect(() => home.findSnapshot("2026")).toThrow(/ambiguous/);
  expect(home.findSnapshot("2026-01-01")).toBe("2026-01-01 alpha");
  expect(home.findSnapshot("2026-01-01 alpha")).toBe("2026-01-01 alpha");
  expect(home.findSnapshot("alpha")).toBeUndefined();
});

it("ignores dangling links and never lists incomplete snapshots", () => {
  writeFileSync(join(home.userData, "state.json"), "state");
  symlinkSync(join(scratch, "missing"), join(home.userData, "broken.json"));
  const copied = home.snapshot("safe");
  expect(readFileSync(join(copied, "state.json"), "utf8")).toBe("state");
  const root = join(home.userData, "Dev snapshots");
  symlinkSync(join(scratch, "missing"), join(root, "broken"));
  mkdirSync(join(root, ".pending-interrupted"));
  writeFileSync(join(root, "file"), "ignore");
  expect(home.listSnapshots()).toEqual([basename(copied)]);
});

it("caps repeated restore backups and preserves the latest before-restore copy", async () => {
  writeFileSync(join(home.userData, "state.json"), "initial");
  const baseline = home.snapshot("baseline");
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    writeFileSync(join(home.userData, "state.json"), "new " + i);
    // Restore the oldest entry too: retention must run after it is consumed.
    home.restore(i === 0 ? basename(baseline) : home.listSnapshots().at(-1));
    expect(home.listSnapshots().length).toBeLessThanOrEqual(8);
  }
  const latest = home
    .listSnapshots()
    .find((name) => name.endsWith("before restore"));
  expect(
    readFileSync(
      join(home.userData, "Dev snapshots", latest, "state.json"),
      "utf8",
    ),
  ).toBe("new 11");
});

it("removes a partial snapshot when copying fails", () => {
  writeFileSync(join(home.userData, "state.json"), "preserve");
  vi.mocked(cpSync).mockImplementationOnce((from, to) => {
    writeFileSync(to, "partial");
    throw new Error("disk full");
  });
  expect(() => home.snapshot("fails")).toThrow("disk full");
  expect(home.listSnapshots()).toEqual([]);
  expect(readdirSync(join(home.userData, "Dev snapshots"))).toEqual([]);
  expect(readFileSync(join(home.userData, "state.json"), "utf8")).toBe(
    "preserve",
  );
});

it
  .skipIf(process.platform === "win32" || process.getuid?.() === 0)
  .each(["project-chats", "project-chats/nested"])(
  "reports an unreadable %s directory without aborting the copying subprocess",
  (name) => {
    const blocked = join(home.userData, name);
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(blocked, "chat.json"), "conversation");
    writeFileSync(join(home.userData, "state.json"), "preserve");
    // Copy a different directory too, so this exercises a genuine partial copy.
    mkdirSync(join(home.userData, "IndexedDB"));
    writeFileSync(join(home.userData, "IndexedDB", "record"), "database");
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import assert from "node:assert/strict";
      import { chmodSync, readFileSync, readdirSync, rmSync } from "node:fs";
      import { join } from "node:path";
      const { snapshot, userData, listSnapshots } = await import(process.argv[1]);
      const baseline = snapshot("readable");
      assert.equal(readFileSync(join(baseline, "IndexedDB", "record"), "utf8"), "database");
      assert.equal(readFileSync(join(baseline, ${JSON.stringify(name)}, "chat.json"), "utf8"), "conversation");
      rmSync(baseline, { recursive: true });
      chmodSync(join(userData, "IndexedDB"), 0o555);
      chmodSync(join(userData, ${JSON.stringify(name)}), 0o000);
      assert.throws(() => snapshot("unreadable"), { code: "EACCES" });
      assert.equal(readFileSync(join(userData, "state.json"), "utf8"), "preserve");
      assert.deepEqual(listSnapshots(), []);
      assert.deepEqual(readdirSync(join(userData, "Dev snapshots")), []);
      console.log("caught EACCES; live data preserved; partial snapshot removed");
    `,
          new URL("./dev-home.mjs", import.meta.url).href,
        ],
        {
          cwd: scratch,
          env: { ...process.env },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal, result.stderr).toBeNull();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "caught EACCES; live data preserved; partial snapshot removed",
      );
    } finally {
      // A native abort bypasses the child's cleanup; the parent must repair permissions.
      chmodSync(blocked, 0o700);
    }
  },
);

it
  .skipIf(process.platform === "win32" || process.getuid?.() === 0)
  .each([
    "project-chats",
    "project-chats/nested",
    "project-chats/nested/chat.json",
  ])("unreadable restore data at %s leaves live records intact", (name) => {
  const nested = join(home.userData, "project-chats", "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "chat.json"), "old conversation");
  writeFileSync(join(home.userData, "state.json"), "old");
  const source = home.snapshot("restore-source");
  writeFileSync(join(home.userData, "state.json"), "current");
  writeFileSync(join(nested, "chat.json"), "live conversation");
  writeFileSync(join(home.userData, "live-only.json"), "new record");
  const blocked = join(source, name);
  const mode = lstatSync(blocked).isDirectory() ? 0o700 : 0o600;
  chmodSync(blocked, 0o000);
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import assert from "node:assert/strict";
          import { readFileSync, readdirSync } from "node:fs";
          import { join } from "node:path";
          const { restore, userData, listSnapshots } = await import(process.argv[1]);
          const before = readdirSync(userData).sort();
          assert.throws(() => restore(process.argv[2]), { code: "EACCES" });
          assert.equal(readFileSync(join(userData, "state.json"), "utf8"), "current");
          assert.equal(readFileSync(join(userData, "project-chats", "nested", "chat.json"), "utf8"), "live conversation");
          assert.equal(readFileSync(join(userData, "live-only.json"), "utf8"), "new record");
          assert.deepEqual(readdirSync(userData).sort(), before);
          assert.deepEqual(listSnapshots(), [process.argv[2]]);
          assert.deepEqual(readdirSync(join(userData, "Dev snapshots")), [process.argv[2]]);
          console.log("caught EACCES; live records intact; staging cleaned up");
        `,
        new URL("./dev-home.mjs", import.meta.url).href,
        basename(source),
      ],
      {
        cwd: scratch,
        env: { ...process.env },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "caught EACCES; live records intact; staging cleaned up",
    );
  } finally {
    chmodSync(blocked, mode);
  }
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "restores and prunes read-only directories using real copies without leaking staging",
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from "node:assert/strict";
      import { mkdirSync, chmodSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
      import { join, basename } from "node:path";
      const { snapshot, restore, userData, listSnapshots } = await import(process.argv[1]);
      const nested = join(userData, "project-chats", "nested");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "chat.json"), "conversation");
      chmodSync(nested, 0o555);
      const source = snapshot("read-only");
      for (let i = 0; i < 2; i++) {
        restore(basename(source));
        assert.equal(readFileSync(join(nested, "chat.json"), "utf8"), "conversation");
        assert.equal(statSync(nested).mode & 0o777, 0o555);
        assert.equal(statSync(join(source, "project-chats", "nested")).mode & 0o777, 0o555);
      }
      for (let i = 0; i < 9; i++) snapshot("prune");
      assert.equal(listSnapshots().length, 8);
      assert.equal(readdirSync(join(userData, "Dev snapshots")).length, 8);
      console.log("restored twice; pruned read-only copies; no staging remains");
    `,
        new URL("./dev-home.mjs", import.meta.url).href,
      ],
      {
        cwd: scratch,
        env: { ...process.env },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal, result.stderr).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no staging remains");
  },
);
