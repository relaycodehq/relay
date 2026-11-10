import { useRef, useState } from "react";

/**
 * Runs `attach` once the earlier ones have finished. A rejection is reported
 * and the chain goes on, so one failed attachment doesn't skip every later
 * one; `done` runs either way.
 */
export function afterPrevious(
  previous: Promise<void>,
  attach: () => Promise<void>,
  { fail, done }: { fail: (error: unknown) => void; done: () => void },
) {
  return previous.then(attach).catch(fail).finally(done);
}

/**
 * Attachments wait their turn so each batch counts the ones before it, and
 * Send waits until everything pasted has landed in the draft.
 */
export function usePreparationQueue(
  setError: (error: string | undefined) => void,
) {
  const [preparing, setPreparing] = useState(false);
  const [incoming, setIncoming] = useState(0);
  const preparation = useRef<Promise<void>>(Promise.resolve());
  const batches = useRef(0);
  return {
    /** An attachment is being prepared; the message waits for it. */
    preparing,
    /** How many screenshots are queued or being prepared, each shown as a placeholder. */
    incoming,
    /** Also catches a send in the same event turn, before React rerenders. */
    isPreparing: () => batches.current > 0,
    queuePreparation(attach: () => Promise<void>, screenshots = 0) {
      batches.current++;
      setPreparing(true);
      setIncoming((n) => n + screenshots);
      setError(undefined);
      preparation.current = afterPrevious(preparation.current, attach, {
        fail(error) {
          console.error("Could not prepare an attachment", error);
          setError(
            error instanceof Error ? error.message : "Could not attach that.",
          );
        },
        done() {
          setIncoming((n) => n - screenshots);
          if (!--batches.current) setPreparing(false);
        },
      });
    },
  };
}
