// Builds the headless Relay into dist-headless/: the `relay` command, the
// Relay it runs in the background, and the agent host, Claude SDK, Cursor
// and speech workers beside them as the desktop has them. It runs on plain
// Node 22+, with nothing native, so one build serves every platform; the
// speech engines are downloaded where they're set up.
//
//   node scripts/build-headless.mjs [version]
import {
  chmodSync,
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
 * The speech engines' npm packages as the lockfile pins them, which a
 * headless Relay downloads when dictation or read aloud is set up.
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
  const sherpa = Object.keys(packages)
    .map(
      (key) =>
        /^node_modules\/sherpa-onnx-((?:darwin|linux|win)-\w+)$/.exec(key)?.[1],
    )
    .filter(Boolean);
  const ort = "node_modules/onnxruntime-node/bin/napi-v6";
  return {
    sherpa: {
      node: pinned("sherpa-onnx-node"),
      platforms: Object.fromEntries(
        sherpa.map((platform) => [platform, pinned(`sherpa-onnx-${platform}`)]),
      ),
    },
    onnxruntime: {
      ...pinned("onnxruntime-node"),
      platforms: readdirSync(ort).flatMap((platform) =>
        readdirSync(`${ort}/${platform}`).map((arch) => `${platform}/${arch}`),
      ),
    },
  };
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
    // Native modules: terminals aren't reached headless, and the speech
    // engines are downloaded when set up (see speech-runtime.json below).
    external: ["node-pty", "onnxruntime-node", "sherpa-onnx-node"],
  });
  // The speech workers, with Electron's parentPort made of Node's IPC.
  for (const name of ["dictation", "read-aloud"])
    await build({
      ...shared,
      entryPoints: [`electron/headless/${name}-worker.ts`],
      format: "cjs",
      outfile: `${headlessOut}/${name}-worker.cjs`,
      external: ["onnxruntime-node", "sherpa-onnx-node"],
    });
  await build(onnxRuntimeBundle(`${headlessOut}/onnxruntime/dist/index.cjs`));
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
