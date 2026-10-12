// What changed in the phone app's native side since the last release tag, for
// export-phone-bundle.mjs: a borrowed --runtime is only honest while this is
// empty. Counts committed, uncommitted and untracked files alike.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The JS bundle can't carry these, so the APK's copy is what runs. Icons and
// splash images are native too, but a bundle runs fine beside older ones. The
// bundle is Android's, so iOS code doesn't count.
const native = [
  /^mobile\/modules\/[^/]+\/android\//,
  /^mobile\/modules\/[^/]+\/expo-module\.config\.json$/,
  /^mobile\/plugins\//,
  /^mobile\/app\.config\.js$/,
];

// Every release bumps their version; only the rest of them is native.
const versioned = {
  "mobile/package.json": (d) => ({ ...d, version: undefined }),
  "mobile/package-lock.json": (d) => ({
    ...d,
    version: undefined,
    packages: { ...d.packages, "": { ...d.packages?.[""], version: undefined } },
  }),
  "mobile/app.json": (d) => ({ ...d, expo: { ...d.expo, version: undefined } }),
};

export function lastReleaseTag(root) {
  return execFileSync(
    "git",
    ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

export function nativeChangesSince(tag, root) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const lines = (...args) => git(...args).split("\n").filter(Boolean);
  const touched = new Set([
    ...lines("diff", "--name-only", tag, "--", "mobile"),
    ...lines("ls-files", "--others", "--exclude-standard", "--", "mobile"),
  ]);
  return [...touched].sort().filter((path) => {
    if (native.some((pattern) => pattern.test(path))) return true;
    const strip = versioned[path];
    if (!strip) return false;
    const now = join(root, path);
    let before;
    try {
      before = git("show", `${tag}:${path}`);
    } catch {
      return true;
    }
    if (!existsSync(now)) return true;
    return (
      JSON.stringify(strip(JSON.parse(before))) !==
      JSON.stringify(strip(JSON.parse(readFileSync(now, "utf8"))))
    );
  });
}
