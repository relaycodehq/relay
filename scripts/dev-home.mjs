// What scripts/dev-supervisor.mjs and scripts/dev-switch.mjs share: where the
// running supervisor is recorded, the checkouts Relay can run from, and the
// snapshots of the dev data taken before each switch.
import { execFileSync } from "node:child_process";
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The supervisor running now: { pid, home, running }. */
export const recordFile = join(tmpdir(), "relay-dev.json");
/** Where a switch is asked for: { to } or { restore }. */
export const requestFile = join(tmpdir(), "relay-dev-request.json");

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

export function writeJson(file, value) {
  // Renamed into place, so a reader never sees half of it.
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

export function readJson(file) {
  try {
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
export function supervisor() {
  const record = readJson(recordFile);
  return record && alive(record.pid) ? record : null;
}

/**
 * The repository's checkouts, the main one first, each with why Relay can't
 * run from it when it can't.
 */
export function checkouts(from) {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: from,
    encoding: "utf8",
  });
  return out
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => lines[0]?.startsWith("worktree "))
    .map((lines, i) => {
      const path = lines[0].slice("worktree ".length);
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
  if (!existsSync(join(path, "node_modules", ".bin", "electron")))
    return "No node_modules: install there or link the main checkout's";
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
  if (["project-chats", "Local Storage", "IndexedDB"].includes(name))
    return true;
  return /\.jsonl?$/.test(name) && statSync(join(userData, name)).isFile();
}

/** Copies Relay's records aside while it isn't running. Clones on APFS, so it's instant. */
export function snapshot(label, { prune = true } = {}) {
  if (!existsSync(userData)) return;
  const stamp = new Date().toISOString().slice(0, 23).replace(/[:.]/g, "-");
  const dir = join(snapshots, `${stamp} ${label.replace(/[\\/:]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(userData))
    if (kept(name))
      cpSync(join(userData, name), join(dir, name), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
  if (prune)
    for (const old of listSnapshots().slice(KEEP))
      rmSync(join(snapshots, old), { recursive: true, force: true });
  return dir;
}

/** Snapshot folder names, newest first. */
export function listSnapshots() {
  if (!existsSync(snapshots)) return [];
  return readdirSync(snapshots)
    .filter((n) => statSync(join(snapshots, n)).isDirectory())
    .sort()
    .reverse();
}

/** The snapshot `name` starts, or the newest. */
export function findSnapshot(name) {
  const all = listSnapshots();
  return name
    ? all.find((n) => n.startsWith(name) || n.includes(name))
    : all[0];
}

/** Puts a snapshot back, after taking one of what it replaces. Relay must not be running. */
export function restore(name) {
  const from = join(snapshots, name);
  snapshot("before restore", { prune: false });
  for (const item of readdirSync(from)) {
    rmSync(join(userData, item), { recursive: true, force: true });
    cpSync(join(from, item), join(userData, item), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
}
