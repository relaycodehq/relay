// What scripts/dev-supervisor.mjs and scripts/dev-switch.mjs share: where the
// running supervisor is recorded, the checkouts Relay can run from, and the
// snapshots of the dev data taken before each switch.
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";
import {
  constants,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const appData =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support")
    : process.platform === "win32"
      ? process.env.APPDATA
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
/** The dev app's data, as electron/main.ts names it. */
export const userData = join(appData, "Relay Experimental");
const snapshots = join(userData, "Dev snapshots");
const KEEP = 8;
let lastSnapshotTime = 0;
// One control directory per user, shared by all their checkouts.
export const controlDir = join(appData, "Relay dev");
export const recordFile = join(controlDir, "supervisor.json");
export const requestFile = join(controlDir, "request.json");

function ensureControlDir() {
  mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(controlDir);
  if (
    !stat.isDirectory() ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (process.platform !== "win32" && stat.mode & 0o077)
  )
    throw new Error(
      "Relay's dev control directory must be private and owned by this user.",
    );
}

export function writeJson(file, value) {
  // Renamed into place, so a reader never sees half of it.
  ensureControlDir();
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function readJson(file) {
  try {
    ensureControlDir();
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      (process.getuid && stat.uid !== process.getuid()) ||
      (process.platform !== "win32" && stat.mode & 0o022)
    )
      return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** The live supervisor's record, if one runs. */
export async function supervisor() {
  const record = readJson(recordFile);
  if (
    !record ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65535 ||
    typeof record.token !== "string" ||
    !record.token ||
    !alive(record.pid)
  )
    return null;
  // A stale PID can belong to anything. Only the live supervisor can answer
  // the token on its ephemeral loopback listener.
  const matches = await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: record.port });
    let reply = "";
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => socket.end(record.token));
    socket.on("data", (data) => {
      reply += data;
      if (reply.length > record.token.length) finish(false);
    });
    socket.once("end", () => finish(reply === record.token));
    socket.once("close", () => finish(false));
  });
  return matches ? record : null;
}

/**
 * The repository's checkouts, the main one first, each with why Relay can't
 * run from it when it can't.
 */
export function checkouts(from) {
  const out = execFileSync(
    "git",
    ["-c", "core.quotePath=false", "worktree", "list", "--porcelain"],
    {
      cwd: from,
      encoding: "utf8",
    },
  );
  return out
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => lines[0]?.startsWith("worktree "))
    .map((lines, i) => {
      const path = resolve(lines[0].slice("worktree ".length));
      const branch = lines
        .find((l) => l.startsWith("branch "))
        ?.slice("branch ".length)
        .replace(/^refs\/heads\//, "");
      return { path, branch, main: i === 0, problem: problem(path) };
    })
    .filter((c) => existsSync(c.path));
}

function problem(path) {
  if (!existsSync(join(path, "scripts", "dev.mjs")))
    return "Not a Relay checkout";
  if (!existsSync(join(path, "node_modules", "electron", "cli.js")))
    return "No node_modules: install there or link the main checkout's";
  if (!existsSync(join(path, "scripts", "dev-process.mjs")))
    return "Rebase this checkout to include the current dev-switch support";
}

/** The checkout `name` means: "main", a path, a branch or a folder name. */
export function findCheckout(list, name) {
  if (name === "main") return list[0];
  const path = resolve(name);
  return (
    list.find((c) => c.path === path) ??
    list.find((c) => c.branch === name) ??
    list.find((c) => c.path.split(/[\\/]/).pop() === name)
  );
}

export const checkoutName = (c) =>
  c.main ? "main" : (c.branch ?? c.path.split(/[\\/]/).pop());

/** Whether `name` in the data folder is worth keeping: what Relay knows, not caches or models. */
function kept(name) {
  if (
    !["project-chats", "Local Storage", "IndexedDB"].includes(name) &&
    !/\.jsonl?$/.test(name)
  )
    return false;
  try {
    const stat = statSync(join(userData, name));
    return /\.jsonl?$/.test(name) ? stat.isFile() : stat.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false; // A dangling link has no data to copy.
    throw error;
  }
}

function copyRecords(from, to) {
  cpSync(from, to, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    // Node 22's native directory fast path can abort the process on EACCES.
    // A filter keeps traversal in JavaScript, where copying errors are catchable.
    filter: () => true,
  });
}

// Copies preserve directory modes. Make only trees being deleted writable,
// without following links or changing the surviving archive/live records.
function removeRecords(path) {
  const makeWritable = (entry) => {
    const stat = lstatSync(entry, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) return;
    if ((stat.mode & 0o700) !== 0o700) chmodSync(entry, stat.mode | 0o700);
    for (const name of readdirSync(entry)) makeWritable(join(entry, name));
  };
  makeWritable(path);
  rmSync(path, { recursive: true, force: true });
}

function pruneSnapshots(keep) {
  const all = listSnapshots();
  const ordered = keep ? [keep, ...all.filter((name) => name !== keep)] : all;
  for (const old of ordered.slice(KEEP)) removeRecords(join(snapshots, old));
}

/** Copies records while Relay is stopped; incomplete copies are never listed. */
export function snapshot(label, { prune = true } = {}) {
  if (!existsSync(userData)) return;
  const items = readdirSync(userData).filter(kept);
  lastSnapshotTime = Math.max(Date.now(), lastSnapshotTime + 1);
  const stamp = new Date(lastSnapshotTime)
    .toISOString()
    .slice(0, 23)
    .replace(/[:.]/g, "-");
  mkdirSync(snapshots, { recursive: true });
  const temp = mkdtempSync(join(snapshots, ".pending-"));
  const dir = join(
    snapshots,
    `${stamp} ${randomUUID().slice(0, 8)} ${label.replace(/[\\/:*?"<>|]/g, "-")}`,
  );
  try {
    for (const name of items)
      copyRecords(join(userData, name), join(temp, name));
    renameSync(temp, dir);
  } catch (error) {
    removeRecords(temp);
    throw error;
  }
  if (prune) pruneSnapshots(basename(dir));
  return dir;
}

/** Snapshot folder names, newest first. Symlinks and unfinished copies are excluded. */
export function listSnapshots() {
  if (!existsSync(snapshots)) return [];
  return readdirSync(snapshots, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(".pending-"),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

/** An exact snapshot name, an unambiguous prefix, or the newest. */
export function findSnapshot(name) {
  const all = listSnapshots();
  if (!name) return all[0];
  if (all.includes(name)) return name;
  const matches = all.filter((n) => n.startsWith(name));
  if (matches.length > 1)
    throw new Error(`Snapshot prefix ${name} is ambiguous; use its full name.`);
  return matches[0];
}

/** Validate again in the supervisor, before stopping Relay and before restoring. */
export function snapshotPath(name) {
  if (
    typeof name !== "string" ||
    name !== basename(name) ||
    name.includes("\\") ||
    !listSnapshots().includes(name)
  )
    throw new Error("Not a snapshot in Relay's Dev snapshots directory.");
  return join(snapshots, name);
}

/** Restore after backing up what it replaces. Relay must not be running. */
export function restore(name) {
  const from = snapshotPath(name);
  // Read every source record into staging before touching live data. A metadata
  // or access check alone cannot prove that the actual copy will succeed.
  const staged = mkdtempSync(join(snapshots, ".pending-restore-"));
  try {
    copyRecords(from, staged);
    const items = readdirSync(staged);
    const backup = snapshot("before restore", { prune: false });
    for (const item of readdirSync(userData))
      if (kept(item)) removeRecords(join(userData, item));
    for (const item of items)
      copyRecords(join(staged, item), join(userData, item));
    // Prune only after consuming the source; it may be the oldest snapshot.
    pruneSnapshots(basename(backup));
  } finally {
    removeRecords(staged);
  }
}
