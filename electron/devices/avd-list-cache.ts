/**
 * Loaded into the hub with `node --import`. The hub asks `avdmanager list avd`
 * on every device-list poll (twice a second), and avdmanager is a JVM that
 * starts at ~250% of a core for a second. The answer only changes when an AVD
 * is added or removed, so it's kept until the AVD folder changes, any other
 * avdmanager call runs, or a minute passes.
 */
export const AVD_LIST_CACHE = `
import cp from "node:child_process";
import { statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const TTL = 60_000;
const execFile = cp.execFile;
const execFileAsync = promisify(execFile);
let cached;
let pending;

const avdDir = () =>
  process.env.ANDROID_AVD_HOME ||
  join(process.env.ANDROID_USER_HOME || join(homedir(), ".android"), "avd");
const stamp = () => {
  try {
    return statSync(avdDir()).mtimeMs;
  } catch {
    return 0;
  }
};
const isAvdmanager = (file) => /^avdmanager(\\.bat)?$/i.test(basename(String(file)));

function listAvd(file, args, options) {
  const key = file + "\\0" + stamp();
  if (cached && cached.key === key && Date.now() - cached.at < TTL)
    return Promise.resolve(cached.value);
  if (pending && pending.key === key) return pending.promise;
  const promise = execFileAsync(file, args, options).then(
    (value) => {
      if (pending?.promise === promise) cached = { key, at: Date.now(), value };
      return value;
    },
  ).finally(() => {
    if (pending?.promise === promise) pending = undefined;
  });
  pending = { key, promise };
  return promise;
}

function wrapped(file, ...rest) {
  if (isAvdmanager(file)) cached = pending = undefined;
  return execFile.call(this, file, ...rest);
}
Object.defineProperty(wrapped, promisify.custom, {
  value(file, args, options) {
    if (isAvdmanager(file)) {
      if (Array.isArray(args) && args.length === 2 && args[0] === "list" && args[1] === "avd")
        return listAvd(file, args, options);
      cached = pending = undefined;
    }
    return execFileAsync(file, args, options);
  },
});
cp.execFile = wrapped;
syncBuiltinESMExports();
`;
