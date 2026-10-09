import { useCallback, useEffect, useRef, useState } from "react";
import { maxRemoteHistory, remoteHistory } from "../../../shared/remote";
import { useRemote } from "./RemoteProvider";
import { loadThread, saveThread } from "./offline";
import { oneAtATime } from "./one-at-a-time";
import { stamp } from "./outbox-state";
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
  // One fetch at a time; a request during one runs once more after it.
  const [oneFetch] = useState(oneAtATime);
  // When the fetch the thread last came from started, against the outbox's sends.
  const [fetched, setFetched] = useState(0);
  // How many of the latest messages to hold; "Load earlier" asks for a page more.
  const [history, setHistory] = useState(remoteHistory);

  // The copy from the last visit, readable before (or without) the computer.
  const cacheRead = useRef<Promise<void>>(undefined);
  useEffect(() => {
    let live = true;
    cacheRead.current = loadThread(id).then(
      (cached) => {
        if (!live || !cached) return;
        // Set before the render, so the first fetch asks only for what changed since.
        current.current ??= cached;
        setThread((t) => t ?? cached);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id]);

  const load = useCallback(
    () =>
      oneFetch(async () => {
        try {
          await cacheRead.current;
          const started = stamp();
          const patch = await remote.call(
            "chat",
            id,
            knownOf(current.current),
            history,
          );
          let next: Thread;
          try {
            next = applyPatch(current.current, patch);
          } catch (e) {
            if (!(e instanceof MissingMessage)) throw e;
            next = applyPatch(
              undefined,
              await remote.call("chat", id, undefined, history),
            );
          }
          setThread((held) => keepNewer(next, held));
          setFetched(started);
          saveThread(id, next);
          setError(undefined);
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      }),
    [oneFetch, remote.call, id, history],
  );

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
    ? `${summary.running}:${summary.waiting}:${summary.updated}:${summary.title}:${summary.queueMark}`
    : "";
  useEffect(() => {
    if (signature && current.current) void load();
  }, [signature, load]);

  const loadEarlier = useCallback(
    () => setHistory((h) => Math.min(maxRemoteHistory, h + remoteHistory)),
    [],
  );

  return {
    thread,
    fetched,
    error,
    reload: load,
    summary,
    loadEarlier: history < maxRemoteHistory ? loadEarlier : undefined,
  };
}
