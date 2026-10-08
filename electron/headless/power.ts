import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Power } from "../app/keep-awake";

/**
 * Keeping a headless computer awake without Electron: macOS takes the same
 * idle-sleep assertion through `caffeinate -i`, Linux asks logind through
 * `systemd-inhibit` and Windows through SetThreadExecutionState, each held by
 * a child that ends with Relay. A server that never sleeps doesn't mind.
 */
export function headlessPower(): Power {
  const held = new Map<number, ChildProcess>();
  let next = 1;
  return {
    hold() {
      const id = next++;
      const child = inhibitor();
      if (child) {
        child.on("error", () => held.delete(id));
        held.set(id, child);
      }
      return id;
    },
    release(id) {
      held.get(id)?.kill();
      held.delete(id);
    },
    onBattery,
    batteryLevel: async () => undefined,
  };
}

/**
 * Windows keeps a computer awake for a thread that asks it to, so a hidden
 * PowerShell asks (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) and waits on Relay's
 * process, holding the request until it ends.
 */
const windowsAwake = (pid: number) =>
  Buffer.from(
    `$t = Add-Type -Name Power -Namespace Relay -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void]$t::SetThreadExecutionState([uint32]2147483649)
Wait-Process -Id ${pid}`,
    "utf16le",
  ).toString("base64");

function inhibitor() {
  const options = { stdio: "ignore" as const, windowsHide: true };
  if (process.platform === "win32")
    return spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        windowsAwake(process.pid),
      ],
      options,
    );
  if (process.platform === "darwin")
    return spawn(
      "/usr/bin/caffeinate",
      ["-i", "-w", String(process.pid)],
      options,
    );
  if (process.platform === "linux" && existsSync("/usr/bin/systemd-inhibit"))
    return spawn(
      "/usr/bin/systemd-inhibit",
      [
        "--what=idle:sleep",
        "--who=Relay",
        "--why=Agents are working",
        "--mode=block",
        "tail",
        `--pid=${process.pid}`,
        "-f",
        "/dev/null",
      ],
      options,
    );
  return undefined;
}

/** Linux says whether mains power is in; elsewhere a headless computer counts as plugged in. */
function onBattery() {
  if (process.platform !== "linux") return false;
  const dir = "/sys/class/power_supply";
  try {
    const supplies = readdirSync(dir).map((name) => join(dir, name));
    const mains = supplies.filter((s) => read(join(s, "type")) === "Mains");
    return (
      mains.length > 0 && mains.every((s) => read(join(s, "online")) === "0")
    );
  } catch {
    return false;
  }
}

const read = (file: string) => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
};
