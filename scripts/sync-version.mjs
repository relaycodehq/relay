// Keep desktop, headless and phone metadata on the same release version.
// Usage: node scripts/sync-version.mjs [X.Y.Z | --package]
//        node scripts/sync-version.mjs --bump [patch | minor | major | X.Y.Z]
// Without an argument, take the newer of package.json and a reachable vX.Y.Z
// tag. A source archive without Git uses package.json; an explicit version
// (as on the release machine) always wins.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validate(version) {
  if (!releaseVersion.test(version))
    throw new Error(`Not a release version: ${version}`);
  return version;
}

function isNewer(version, current) {
  const a = version.split(".").map(Number);
  const b = current.split(".").map(Number);
  const difference = a.findIndex((part, i) => part !== b[i]);
  return difference >= 0 && a[difference] > b[difference];
}

export function resolveVersion({ root = repo, version } = {}) {
  if (version !== undefined) return validate(version.replace(/^v/, ""));
  const current = validate(readJson(join(root, "package.json")).version);
  let tagged;
  try {
    tagged = execFileSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .trim()
      .slice(1);
  } catch {
    return current;
  }
  if (!releaseVersion.test(tagged)) return current;
  return isNewer(tagged, current) ? tagged : current;
}

export function syncVersion(options = {}) {
  const root = options.root ?? repo;
  const version = resolveVersion(options);
  // Read everything before writing, so a broken file doesn't leave half the
  // metadata synced. Dependency versions and lockfile entries stay untouched.
  const files = [
    "package.json",
    "package-lock.json",
    "mobile/package.json",
    "mobile/package-lock.json",
    "mobile/app.json",
  ].map((name) => {
    const path = join(root, name);
    const before = readFileSync(path, "utf8");
    const data = JSON.parse(before);
    if (name === "mobile/app.json") data.expo.version = version;
    else {
      data.version = version;
      if (name.endsWith("package-lock.json"))
        data.packages[""].version = version;
    }
    return { path, before, after: JSON.stringify(data, null, 2) + "\n" };
  });
  for (const { path, before, after } of files)
    if (before !== after) writeFileSync(path, after);
  return version;
}

/** Bump the effective version and sync every file directly, without npm hooks. */
export function bumpVersion({ root = repo, bump = "patch" } = {}) {
  const current = resolveVersion({ root });
  const index = ["major", "minor", "patch"].indexOf(bump);
  let version;
  if (index >= 0) {
    const parts = current.split(".").map(Number);
    parts[index] += 1;
    parts.fill(0, index + 1);
    version = parts.join(".");
  } else version = resolveVersion({ version: bump });
  if (!isNewer(version, current))
    throw new Error(`Version ${version} must be newer than ${current}.`);
  return syncVersion({ root, version });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const given = process.argv[2];
  if (process.argv.length > (given === "--bump" ? 4 : 3))
    throw new Error(
      "Usage: sync-version.mjs [X.Y.Z | --package | --bump [patch | minor | major | X.Y.Z]]",
    );
  const version =
    given === "--bump"
      ? bumpVersion({ bump: process.argv[3] })
      : syncVersion({
          version:
            given === "--package"
              ? readJson(join(repo, "package.json")).version
              : given,
        });
  console.log(`Relay ${version}: desktop, headless and phone synced`);
}
