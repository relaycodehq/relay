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
