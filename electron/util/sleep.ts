/**
 * Waits `ms`. On the global timer rather than node:timers/promises, so tests
 * with fake timers move it along.
 */
export const sleep = (ms: number, { unref = false } = {}) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (unref) timer.unref?.();
  });
