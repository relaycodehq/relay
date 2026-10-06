/** How long an unused pool lives on, so switching files or tabs reuses it. */
export const POOL_GRACE_MS = 10_000;

export interface Disposable {
  terminate(): void;
}

/**
 * One lazily created resource shared by every mounted user. The last release
 * schedules teardown after a grace period; an acquire inside that window
 * cancels it and gets the same instance back.
 */
export function sharedResource<T extends Disposable>(
  create: () => T,
  graceMs = POOL_GRACE_MS,
) {
  let instance: T | undefined;
  let users = 0;
  let teardown: ReturnType<typeof setTimeout> | undefined;

  return {
    acquire(): T {
      if (teardown !== undefined) {
        clearTimeout(teardown);
        teardown = undefined;
      }
      users += 1;
      instance ??= create();
      return instance;
    },
    release(): void {
      if (users === 0) return;
      users -= 1;
      if (users > 0) return;
      teardown = setTimeout(() => {
        teardown = undefined;
        const dead = instance;
        instance = undefined;
        dead?.terminate();
      }, graceMs);
    },
    peek(): T | undefined {
      return instance;
    },
  };
}
