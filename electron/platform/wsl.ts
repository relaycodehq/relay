import { readFileSync } from "node:fs";

/**
 * Whether this runs in WSL. /proc/version says so even where WSL's variables
 * are missing, as under systemd.
 */
export const inWsl = (version = procVersion()) => /microsoft/i.test(version);

function procVersion() {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return "";
  }
}
