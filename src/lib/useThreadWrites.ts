import { useState } from "react";

export type ThreadWrites = ReturnType<typeof useThreadWrites>;

/**
 * What changes a thread goes one at a time: a message, a queue edit, a review
 * or council starting. While one is out `busy` holds the others off, and one
 * that fails shows as the thread's `error`, where other failures show too.
 */
export function useThreadWrites() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  /** Resolves to whether `work` went through. Callers check `busy` first. */
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
