import { build } from "esbuild";
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
