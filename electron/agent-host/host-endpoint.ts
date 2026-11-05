// Where the agent host listens, and the record Relay finds it by.
import { randomBytes } from "node:crypto";
import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostRecord } from "./protocol";

/**
 * A socket in a folder only this user can enter (Linux prefers its per-user
 * runtime dir), or a named pipe on Windows, where `folder` is undefined.
 */
export function hostSocket() {
  if (process.platform === "win32")
    return {
      folder: undefined,
      path: `\\\\.\\pipe\\relay-agent-host-${randomBytes(8).toString("hex")}`,
    };
  const runtime =
    (process.platform === "linux" && process.env.XDG_RUNTIME_DIR) || tmpdir();
  const folder = mkdtempSync(join(runtime, "relay-"));
  return { folder, path: join(folder, "host.sock") };
}

/** Written whole or not at all, so Relay never reads half a record. */
export function writeRecord(file: string, record: HostRecord) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  renameSync(temp, file);
}
