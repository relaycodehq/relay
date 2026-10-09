/**
 * Runs one job at a time. Asked again while one runs, it runs once more
 * after it, and with the job it was handed last: a rerun reads what the
 * latest caller saw (a longer history, the computer switched to), not what
 * the first one did.
 */
export function oneAtATime() {
  let running: Promise<void> | undefined;
  let next: (() => Promise<void>) | undefined;
  return (job: () => Promise<void>) => {
    next = job;
    // Start in the next microtask, so even a synchronous throw can't leave
    // the rejected promise assigned to running after finally cleared it.
    if (running) return running;
    const first = next;
    next = undefined;
    running = Promise.resolve().then(async () => {
      let failed = false;
      let failure: unknown;
      try {
        let run: (() => Promise<void>) | undefined = first;
        while (run) {
          try {
            await run();
          } catch (e) {
            failed = true;
            failure = e;
          }
          run = next;
          next = undefined;
        }
        if (failed) throw failure;
      } finally {
        running = undefined;
      }
    });
    return running;
  };
}
