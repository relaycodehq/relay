import { createRequire } from "node:module";

// Electron 44 fetches its binary the first time something loads it, not at
// npm ci. Fetch it once here, before the workers start: on a fresh clone two
// test files that load it raced to unpack it into the same folder, and the
// loser failed its whole file. Runs that only use stand-ins skip the download
// with ELECTRON_SKIP_BINARY_DOWNLOAD, as the Windows check does.
export default function fetchElectron() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) return;
  createRequire(import.meta.url)("electron");
}
