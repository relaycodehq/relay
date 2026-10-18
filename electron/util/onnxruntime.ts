import { existsSync } from "node:fs";
import { join } from "node:path";

// onnxruntime-node runs dictation and read aloud. Native files can't load
// from inside the asar, so it ships unpacked beside it (see build-electron.mjs).
let dir = join(__dirname, "onnxruntime").replace(
  /app\.asar([\\/])/,
  "app.asar.unpacked$1",
);

/** Where a headless Relay downloaded onnxruntime to, instead of beside the bundle. */
export function setOnnxRuntimeDir(path: string) {
  dir = path;
}

/** Whether this platform's binaries are there to load. */
export const onnxRuntimeInstalled = () =>
  existsSync(join(dir, "bin", "napi-v6", process.platform, process.arch));

/** What a worker requires to get onnxruntime-node. */
export const onnxRuntimeEntry = () => join(dir, "dist", "index.cjs");
