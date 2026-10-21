/** Whether a process runs under `pid`, ours or someone else's. */
export function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Someone else's process: alive, only not ours to signal.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
