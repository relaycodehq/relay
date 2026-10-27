#!/usr/bin/env node
// Runs e2e specs against a private build. The checkout's dist/ and
// dist-electron/ are shared with the user's app and every other session's
// test runs, so a build there can be swapped out under a run (or swap theirs).
//
//   npm run test:e2e:isolated -- <specs> [playwright args]
//   npm run test:e2e:isolated -- --ref <rev> <specs>   a commit instead of the working tree
//   --keep      leave the copy in /private/tmp for a rerun or for poking at the build
//
// Spec filters are path regexes: `projects.spec` also matches
// `shared-projects.spec`, so write `e2e/projects.spec`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const take = (flag) => {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  return args.splice(at, flag === "--keep" ? 1 : 2).at(1) ?? true;
};
const ref = take("--ref");
const keep = take("--keep");
const repo = process.cwd();
const copy = mkdtempSync("/private/tmp/relay-e2e-");
const run = (command, rest) =>
  execFileSync(command, rest, { cwd: copy, stdio: "inherit" });

if (ref) {
  execFileSync("sh", ["-c", `git archive "$0" | tar -x -C "$1"`, ref, copy], {
    stdio: "inherit",
  });
} else {
  // Tracked and new files as they are on disk, uncommitted edits included.
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"])
    .toString()
    .split("\0")
    .filter((file) => file && existsSync(file));
  execFileSync("rsync", ["-a", "--from0", "--files-from=-", "./", copy + "/"], {
    input: files.join("\0"),
  });
}
for (const modules of [
  "node_modules",
  "tests/fixtures/language-toolchain/node_modules",
  "packaging/checks-typescript/node_modules",
])
  if (existsSync(join(repo, modules)) && !existsSync(join(copy, modules)))
    symlinkSync(join(repo, modules), join(copy, modules));

console.log(`Building into ${copy}`);
run("npx", ["vite", "build", "--logLevel", "warn"]);
run("node", ["scripts/build-electron.mjs"]);
const result = spawnSync("npx", ["playwright", "test", ...args], {
  cwd: copy,
  stdio: "inherit",
});
if (keep) console.log(`Kept ${copy}`);
else rmSync(copy, { recursive: true, force: true });
process.exit(result.status ?? 1);
