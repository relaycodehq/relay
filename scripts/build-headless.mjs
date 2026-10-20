// Builds the headless Relay into dist-headless/: the `relay` command, the
// Relay it runs in the background, and the agent host, Claude SDK, Cursor
// and speech workers beside them as the desktop has them. It runs on plain
// Node 22+, so one build serves every platform: the only native code in it
// is node-pty's, a binary per platform, and the speech engines are
// downloaded where they're set up.
//
//   node scripts/build-headless.mjs [version]
import {
  chmodSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { bundles, onnxRuntimeBundle } from "./electron-bundles.mjs";
import { resolveVersion, syncVersion } from "./sync-version.mjs";

export const headlessOut = "dist-headless";

/**
 * onnxruntime's npm package as the lockfile pins it, which a headless Relay
 * downloads when dictation or read aloud is set up.
 */
function speechRuntime() {
  const { packages } = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const pinned = (name) => {
    const entry = packages[`node_modules/${name}`];
    if (!entry?.resolved || !entry.integrity)
      throw new Error(`package-lock.json doesn't pin ${name}.`);
    return {
      name,
      version: entry.version,
      url: entry.resolved,
      integrity: entry.integrity,
    };
  };
  const ort = "node_modules/onnxruntime-node/bin/napi-v6";
  return {
    onnxruntime: {
      ...pinned("onnxruntime-node"),
      platforms: readdirSync(ort).flatMap((platform) =>
        readdirSync(`${ort}/${platform}`).map((arch) => `${platform}/${arch}`),
      ),
    },
  };
}

/**
 * node-pty, for the shells a paired computer opens in a project here: its
 * library and a binary per platform. npm ships none for Linux, so those come
 * from `RELAY_PTY_LINUX`, a folder of `linux-<arch>/pty.node` the release
 * builds in its Linux containers, or from this computer's own source build.
 * A Relay without one for its platform has no shells.
 */
function copyPty() {
  const pty = "node_modules/node-pty",
    out = `${headlessOut}/node-pty`;
  cpSync(`${pty}/package.json`, `${out}/package.json`);
  cpSync(`${pty}/lib`, `${out}/lib`, {
    recursive: true,
    filter: (path) => !/\.(test\.js|map)$/.test(path),
  });
  cpSync(`${pty}/prebuilds`, `${out}/prebuilds`, {
    recursive: true,
    filter: (path) => !path.endsWith(".pdb"),
  });
  const built = `${pty}/build/Release/pty.node`;
  if (process.platform === "linux" && existsSync(built))
    cpSync(built, `${out}/prebuilds/linux-${process.arch}/pty.node`);
  if (process.env.RELAY_PTY_LINUX)
    cpSync(process.env.RELAY_PTY_LINUX, `${out}/prebuilds`, {
      recursive: true,
    });
  // npm publishes spawn-helper without its executable bit; see build-electron.mjs.
  for (const arch of ["arm64", "x64"])
    chmodSync(`${out}/prebuilds/darwin-${arch}/spawn-helper`, 0o755);
}

export async function buildHeadless(given) {
  const version =
    given === undefined ? syncVersion() : resolveVersion({ version: given });
  rmSync(headlessOut, { recursive: true, force: true });
  const shared = {
    bundle: true,
    platform: "node",
    target: "node22",
    // The desktop's services import Electron; here they get a stand-in.
    alias: { electron: "./electron/headless/electron-stand-in.ts" },
    define: {
      "process.env.RELAY_HEADLESS_VERSION": JSON.stringify(version),
    },
    logLevel: "warning",
  };
  await build({
    ...shared,
    entryPoints: ["electron/headless/cli.ts"],
    format: "cjs",
    outfile: `${headlessOut}/relay.cjs`,
    banner: { js: "#!/usr/bin/env node" },
  });
  chmodSync(`${headlessOut}/relay.cjs`, 0o755);
  await build({
    ...shared,
    entryPoints: ["electron/headless/install-command.ts"],
    format: "cjs",
    outfile: `${headlessOut}/install-files.cjs`,
  });
  await build({
    ...shared,
    entryPoints: ["electron/headless/daemon.ts"],
    format: "cjs",
    outfile: `${headlessOut}/relay-daemon.cjs`,
    // jsonc-parser publishes a UMD main; its ESM build can be bundled completely.
    mainFields: ["module", "main"],
    // Native modules: node-pty sits beside it (copyPty), and the speech
    // engines are downloaded when set up (see speech-runtime.json below).
    external: [
      "node-pty",
      "onnxruntime-node",
      "@resvg/resvg-wasm/index_bg.wasm",
    ],
  });
  // The speech workers, with Electron's parentPort made of Node's IPC.
  for (const name of ["dictation", "read-aloud"])
    await build({
      ...shared,
      entryPoints: [`electron/headless/${name}-worker.ts`],
      format: "cjs",
      outfile: `${headlessOut}/${name}-worker.cjs`,
      external: ["onnxruntime-node"],
    });
  await build(onnxRuntimeBundle(`${headlessOut}/onnxruntime/dist/index.cjs`));
  cpSync(
    "node_modules/@resvg/resvg-wasm/index_bg.wasm",
    `${headlessOut}/resvg.wasm`,
  );
  copyPty();
  writeFileSync(
    `${headlessOut}/speech-runtime.json`,
    JSON.stringify(speechRuntime(), null, 2) + "\n",
  );
  for (const name of [
    "agent host",
    "Claude SDK",
    "Cursor worker",
    "checks worker",
  ]) {
    const { options } = bundles.find((b) => b.name === name);
    await build({
      ...options,
      ...shared,
      banner: options.banner,
      format: options.format,
      outfile: options.outfile.replace(/^dist-electron\//, `${headlessOut}/`),
    });
  }
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = await buildHeadless(process.argv[2]);
  console.log(`${headlessOut}/ → Relay ${version}, headless`);
}
