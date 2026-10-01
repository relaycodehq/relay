/**
 * Runs a thread's sends, queue changes and moves one after another, so
 * each sees what the last one left. A job that fails doesn't stop the next.
 * Unlike `keyedQueue` it returns the job itself, not an async wrapper, so a
 * caller sees it settle in the same tick it does.
 */
export function threadControl() {
  const controls = new Map<string, Promise<unknown>>();
  const control = <T>(id: string, action: () => Promise<T>): Promise<T> => {
    const job = (controls.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(action);
    controls.set(id, job);
    void job
      .finally(() => {
        if (controls.get(id) === job) controls.delete(id);
      })
      .catch(() => {});
    return job;
  };
  return Object.assign(control, {
    /** What's still running or waiting, for closing. */
    pending: () => [...controls.values()],
  });
}

export type ThreadControl = ReturnType<typeof threadControl>;
