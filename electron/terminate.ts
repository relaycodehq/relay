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
 * whatever it spawned goes too (POSIX only). With `byInput`, closing its
 * input is how it's asked instead, for a child that winds down when it reads
 * the end.
 */
export function terminate(
  child: Stoppable,
  { graceMs = 2000, group = false, byInput = false } = {},
) {
  const exited = () => child.exitCode !== null || !!child.signalCode;
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
