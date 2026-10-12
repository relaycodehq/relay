// Writes dist-phone/: the phone app's code as a release APK would carry it
// (Hermes bytecode and its images), with a manifest the desktop hands to
// paired phones so they update from it. See electron/remote/phone-app.ts.
//
//   node scripts/export-phone-bundle.mjs [version]
//   node scripts/export-phone-bundle.mjs --dev [--runtime <hash>]
//
// --dev stamps x.y.z.<seconds>, so a running dev Relay pushes it to its phone
// and the next real release still counts as newer. --runtime stands in for the
// local fingerprint, which can drift from the release machine's on the same
// native code; pass the installed APK's own (`relayRuntime` in its
// assets/app.config) only when no native code changed since that APK. It is
// refused once anything native changed since the last release tag.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lastReleaseTag, nativeChangesSince } from "./phone-native-changes.mjs";
import { resolveVersion, syncVersion } from "./sync-version.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = join(repo, "mobile");
const out = join(repo, "dist-phone");
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const runtimeArg = args.indexOf("--runtime");
const given = runtimeArg >= 0 ? args[runtimeArg + 1] : undefined;
if (runtimeArg >= 0 && !/^[0-9a-f]{40}$/.test(given ?? ""))
  throw new Error("--runtime takes the 40-character fingerprint.");
if (given) {
  const tag = lastReleaseTag(repo);
  const changed = nativeChangesSince(tag, repo);
  if (changed.length) {
    console.error(
      `--runtime refused: the phone's native side changed since ${tag}, so an ` +
        `APK from then may not run this bundle. Build a new APK instead.\n  ` +
        changed.join("\n  "),
    );
    process.exit(1);
  }
}
const version = dev
  ? `${resolveVersion()}.${Math.floor(Date.now() / 1000)}`
  : args[0] === undefined
    ? syncVersion()
    : resolveVersion({ version: args[0] });

const { phoneRuntime } = await import(join(mobile, "scripts", "runtime.mjs"));
const runtime = given ?? (await phoneRuntime());

const work = mkdtempSync(join(tmpdir(), "relay-phone-bundle-"));
const js = join(work, "index.android.js");
const res = join(work, "res");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(
  npx,
  [
    "expo",
    "export:embed",
    "--platform",
    "android",
    "--dev",
    "false",
    "--minify",
    "true",
    "--entry-file",
    "index.ts",
    "--bundle-output",
    js,
    "--assets-dest",
    res,
    "--reset-cache",
  ],
  {
    cwd: mobile,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", RELAY_VERSION: version },
    shell: process.platform === "win32",
  },
);

// The compiler react-native's Gradle build uses, so the bytecode matches the APK's Hermes.
const fromRn = createRequire(
  createRequire(join(mobile, "package.json")).resolve(
    "react-native/package.json",
  ),
);
const hermes = dirname(fromRn.resolve("hermes-compiler/package.json"));
const bin = {
  darwin: "osx-bin/hermesc",
  linux: "linux64-bin/hermesc",
  win32: "win64-bin/hermesc.exe",
}[process.platform];
if (!bin) throw new Error(`No hermesc for ${process.platform}`);
const bundle = "index.android.bundle";
execFileSync(
  join(hermes, "hermesc", bin),
  [
    "-emit-binary",
    "-O",
    "-max-diagnostic-width=80",
    "-out",
    join(work, bundle),
    js,
  ],
  {
    stdio: "inherit",
  },
);

rmSync(out, { recursive: true, force: true });
cpSync(join(work, bundle), join(out, bundle));
if (existsSync(res)) cpSync(res, out, { recursive: true });
rmSync(work, { recursive: true, force: true });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const files = walk(out).map((file) => ({
  path: relative(out, file).split(sep).join("/"),
  size: statSync(file).size,
  sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
}));
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify({ version, runtime, bundle, files }, null, 2) + "\n",
);
const total = files.reduce((n, f) => n + f.size, 0);
console.log(
  `dist-phone → ${version}, runtime ${runtime.slice(0, 12)}, ${files.length} files, ${(total / 1e6).toFixed(1)} MB`,
);
