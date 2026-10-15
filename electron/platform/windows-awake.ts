import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

/**
 * Keeps Windows from idling to sleep until the returned child ends or Relay
 * does: a hidden PowerShell asks SetThreadExecutionState for
 * ES_CONTINUOUS | ES_SYSTEM_REQUIRED and waits on Relay's process. Electron's
 * own blocker only takes an execution request, which Modern Standby laptops
 * sleep through.
 */
export function holdWindowsAwake(pid = process.pid) {
  const script = `$t = Add-Type -Name Power -Namespace Relay -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void]$t::SetThreadExecutionState([uint32]2147483649)
Wait-Process -Id ${pid}`;
  return spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { stdio: "ignore", windowsHide: true },
  );
}

const run = promisify(execFile);

/** The battery's percent left, or undefined on a computer without one. */
export async function windowsBatteryLevel() {
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining",
    ],
    { windowsHide: true },
  );
  const value = Number(stdout.trim());
  return stdout.trim() && Number.isFinite(value) ? value : undefined;
}
