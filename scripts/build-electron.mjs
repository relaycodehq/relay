import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chmodSync, cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
await build({
  entryPoints: ["electron/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist-electron/main.cjs",
  external: ["electron"],
  // jsonc-parser publishes a UMD main; its ESM build can be bundled completely.
  mainFields: ["module", "main"],
});
await build({
  entryPoints: ["electron/preload.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist-electron/preload.cjs",
  external: ["electron"],
});

await build({
  entryPoints: ["electron/checks/worker.mjs"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist-electron/checks-worker.mjs",
  banner: {
    js: 'import { createRequire as createRuntimeRequire } from "node:module"; const require = createRuntimeRequire(import.meta.url);',
  },
});

// The Claude SDK is ESM. Bundle it separately so import.meta and native imports retain their semantics.
await build({
  entryPoints: ["electron/rooms/claude-sdk.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist-electron/claude-sdk.mjs",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

// The agent host runs detached, as Node on Electron's binary, and keeps
// Claude sessions going while Relay restarts. It carries its own SDK copy.
await build({
  entryPoints: ["electron/agent-host/host.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist-electron/agent-host.mjs",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

// Live checks fall back to TypeScript 5.9 for projects whose compiler has no
// language service API. It has its own install so its tsc bin stays out of
// the root node_modules, and loads its lib.*.d.ts from beside typescript.js.
const fallbackRoot = "packaging/checks-typescript",
  fallback = join(fallbackRoot, "node_modules/typescript"),
  fallbackOut = "dist-electron/typescript-5";
if (!existsSync(fallback))
  execFileSync(
    "npm",
    [
      "ci",
      "--prefix",
      fallbackRoot,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
rmSync(fallbackOut, { recursive: true, force: true });
for (const name of ["package.json", "LICENSE.txt", "ThirdPartyNoticeText.txt"])
  cpSync(join(fallback, name), join(fallbackOut, name));
cpSync(join(fallback, "lib"), join(fallbackOut, "lib"), {
  filter: (path) =>
    path === join(fallback, "lib") ||
    /[\\/](typescript\.js|lib\.[^\\/]*\.d\.ts)$/.test(path),
  recursive: true,
});

// node-pty loads its native binaries from beside its own lib/, so it ships as
// plain files next to main.cjs (unpacked from the asar), not in the bundle.
const pty = "node_modules/node-pty",
  ptyOut = "dist-electron/node-pty";
rmSync(ptyOut, { recursive: true, force: true });
cpSync(join(pty, "package.json"), join(ptyOut, "package.json"));
cpSync(join(pty, "lib"), join(ptyOut, "lib"), {
  recursive: true,
  filter: (path) => !/\.(test\.js|map)$/.test(path),
});
// A source build (Linux) lands in build/Release; macOS and Windows use prebuilds.
const native = existsSync(join(pty, "build/Release/pty.node"))
  ? "build/Release"
  : `prebuilds/${process.platform}-${process.arch}`;
cpSync(join(pty, native), join(ptyOut, native), {
  recursive: true,
  filter: (path) =>
    !/\.(pdb|o|d|mk)$|\/obj(\.target)?(\/|$)|\/\.deps(\/|$)/.test(path),
});
// node-pty 1.1.0 publishes spawn-helper without its executable bit, and
// every shell then fails with "posix_spawnp failed".
const helper = join(ptyOut, native, "spawn-helper");
if (existsSync(helper)) chmodSync(helper, 0o755);
