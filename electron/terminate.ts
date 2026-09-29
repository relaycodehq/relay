/** What a child process or a host-run stand-in for one offers. */
type Stoppable = {
  pid?: number;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): unknown;
  once(event: "exit", listener: () => void): unknown;
};

/**
 * Asks a child to stop with SIGTERM and kills it if it's still running after
 * `graceMs`. With `group`, the signals go to its whole process group, so
 * whatever it spawned goes too (POSIX only).
 */
export function terminate(
  child: Stoppable,
  { graceMs = 2000, group = false } = {},
) {
  const signal = (name: NodeJS.Signals) => {
    try {
      if (group && child.pid && process.platform !== "win32")
        process.kill(-child.pid, name);
      else child.kill(name);
    } catch {
      try {
        child.kill(name);
      } catch {}
    }
  };
  signal("SIGTERM");
  const force = setTimeout(() => {
    if (child.exitCode === null) signal("SIGKILL");
  }, graceMs);
  force.unref();
  child.once("exit", () => clearTimeout(force));
}
