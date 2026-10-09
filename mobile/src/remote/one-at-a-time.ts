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
    running ??= (async () => {
      try {
        while (next) {
          const run = next;
          next = undefined;
          await run();
        }
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
}
