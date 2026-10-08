import { spawn } from "node:child_process";

/** What a child process or a host-run stand-in for one offers. */
type Stoppable = {
  pid?: number;
  exitCode: number | null;
  signalCode?: NodeJS.Signals | null;
  stdin?: { end(): unknown } | null;
  kill(signal?: NodeJS.Signals): unknown;
  once(event: "exit", listener: () => void): unknown;
};

/**
 * Asks a child to stop with SIGTERM and kills it if it's still running after
 * `graceMs`. With `group`, the signals go to its whole process group, so
 * whatever it spawned goes too (taskkill on Windows). With `byInput`, closing its
 * input is how it's asked instead, for a child that winds down when it reads
 * the end.
 */
export function terminate(
  child: Stoppable,
  { graceMs = 2000, group = false, byInput = false } = {},
) {
  const exited = () => child.exitCode !== null || !!child.signalCode;
  if (group && child.pid && process.platform === "win32") {
    if (exited()) return;
    // Node kills only the parent on Windows; gh can leave git push running.
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).once("error", () => {
      child.kill();
    });
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try {
      if (group && child.pid && process.platform !== "win32") {
        // Once it has exited, its id may already be someone else's.
        if (!exited()) process.kill(-child.pid, name);
      } else child.kill(name);
    } catch {
      try {
        child.kill(name);
      } catch {}
    }
  };
  if (byInput) child.stdin?.end();
  else signal("SIGTERM");
  const force = setTimeout(() => {
    if (!exited()) signal("SIGKILL");
  }, graceMs);
  force.unref();
  child.once("exit", () => clearTimeout(force));
}

/** Stop a detached command and its descendants before filesystem cleanup. */
export async function stopProcessTree(child: Stoppable): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }
  const signal = (name: NodeJS.Signals | 0) => {
    try {
      process.kill(-pid, name);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  if (!signal("SIGTERM")) return;
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    if (!signal(0)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  signal("SIGKILL");
}
