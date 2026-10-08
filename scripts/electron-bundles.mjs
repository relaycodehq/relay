import { readFileSync } from "node:fs";

/**
 * The main process's bundles: scripts/build-electron.mjs builds them, and
 * scripts/dev.mjs rebuilds them in memory to tell when a running Relay is
 * behind its sources. `name` is what the restart button calls each one.
 */
export const bundles = [
  {
    name: "main",
    options: {
      entryPoints: ["electron/main.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "dist-electron/main.cjs",
      external: ["electron"],
      // jsonc-parser publishes a UMD main; its ESM build can be bundled completely.
      mainFields: ["module", "main"],
    },
  },
  {
    name: "preload",
    options: {
      entryPoints: ["electron/preload.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "dist-electron/preload.cjs",
      external: ["electron"],
    },
  },
  // Dictation's speech engine runs in its own utility process.
  {
    name: "dictation worker",
    options: {
      entryPoints: ["electron/dictation/worker.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "dist-electron/dictation-worker.cjs",
      external: ["electron"],
    },
  },
  // So do read aloud's voice engines.
  {
    name: "read aloud worker",
    options: {
      entryPoints: ["electron/read-aloud/worker.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: "dist-electron/read-aloud-worker.cjs",
      external: ["electron"],
    },
  },
  {
    name: "checks worker",
    options: {
      entryPoints: ["electron/checks/worker.mjs"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outfile: "dist-electron/checks-worker.mjs",
      banner: {
        js: 'import { createRequire as createRuntimeRequire } from "node:module"; const require = createRuntimeRequire(import.meta.url);',
      },
    },
  },
  // The Claude SDK is ESM. Bundle it separately so import.meta and native imports retain their semantics.
  {
    name: "Claude SDK",
    options: {
      entryPoints: ["electron/agents/claude/claude-sdk.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outfile: "dist-electron/claude-sdk.mjs",
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
    },
  },
  // The agent host runs detached, as Node on Electron's binary, and keeps
  // Claude sessions going while Relay restarts. It carries its own SDK copy.
  {
    name: "agent host",
    options: {
      entryPoints: ["electron/agent-host/host.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outfile: "dist-electron/agent-host.mjs",
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
    },
  },
  // Cursor's SDK runs in a worker of its own. The SDK isn't bundled: Relay
  // downloads it on first use and the worker imports it from where it landed.
  {
    name: "Cursor worker",
    options: {
      entryPoints: ["electron/agents/cursor/worker.ts"],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outfile: "dist-electron/cursor-worker.mjs",
    },
  },
];

/**
 * onnxruntime-node's JavaScript, which read aloud's worker loads, bundled to
 * `outfile` with its addon looked up from a bin/ folder beside it.
 */
export const onnxRuntimeBundle = (outfile) => ({
  entryPoints: ["node_modules/onnxruntime-node/dist/index.js"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile,
  plugins: [
    {
      name: "onnxruntime-binding",
      setup(build) {
        build.onLoad(
          { filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ },
          ({ path }) => {
            const source = readFileSync(path, "utf8");
            const contents = source.replace(
              /require\(`\.\.\/bin\/([^`]*onnxruntime_binding\.node)`\)/,
              "require(require('node:path').join(__dirname, `../bin/$1`))",
            );
            if (contents === source)
              throw new Error("onnxruntime-node's binding.js changed shape.");
            return { contents, loader: "js" };
          },
        );
      },
    },
  ],
});
