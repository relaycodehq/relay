import { useCallback, useEffect, useRef, useState } from "react";
import { useRemote } from "./RemoteProvider";
import {
  applyMessage,
  applyPatch,
  keepNewer,
  knownOf,
  MissingMessage,
  type Thread,
} from "./chat-state";

/** A thread kept current from the desktop's events, refetched when its state moves. */
export function useThread(id: string) {
  const remote = useRemote();
  const [thread, setThread] = useState<Thread>();
  const [error, setError] = useState<Error>();
  const current = useRef<Thread | undefined>(undefined);
  current.current = thread;
  const loading = useRef<Promise<void> | undefined>(undefined);
  const again = useRef(false);

  const load = useCallback(async () => {
    // One fetch at a time; a request during one runs once more after it.
    if (loading.current) {
      again.current = true;
      return loading.current;
    }
    const run = async () => {
      try {
        const patch = await remote.call("chat", id, knownOf(current.current));
        let next: Thread;
        try {
          next = applyPatch(current.current, patch);
        } catch (e) {
          if (!(e instanceof MissingMessage)) throw e;
          next = applyPatch(undefined, await remote.call("chat", id));
        }
        setThread((held) => keepNewer(next, held));
        setError(undefined);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    };
    loading.current = (async () => {
      do {
        again.current = false;
        await run();
      } while (again.current);
      loading.current = undefined;
    })();
    return loading.current;
  }, [remote.call, id]);

  // Loads on open, and after every reconnect.
  useEffect(() => {
    if (remote.status === "online") void load();
  }, [remote.status, load]);

  useEffect(
    () =>
      remote.onMessage(id, (event) => {
        setThread((t) => t && applyMessage(t, event.message));
        if (event.message.status !== "streaming") void load();
      }),
    [remote.onMessage, id, load],
  );

  // Running, waiting and queue changes arrive as thread summaries.
  const summary = remote.overview?.chats.find((c) => c.id === id);
  const signature = summary
    ? `${summary.running}:${summary.waiting}:${summary.updated}:${summary.title}`
    : "";
  useEffect(() => {
    if (signature && current.current) void load();
  }, [signature, load]);

  return { thread, error, reload: load, summary };
}
