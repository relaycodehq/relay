import { useEffect, useRef } from "react";

/**
 * Asks whichever component listens to do something once, such as a pane
 * opening a file. Asked before anything listens (the pane only mounts once
 * it's shown), the latest request waits for the first listener.
 */
export type RequestChannel<T> = {
  send: (request: T) => void;
  listen: (handler: (request: T) => void) => () => void;
};

export function requestChannel<T>(): RequestChannel<T> {
  let handler: ((request: T) => void) | undefined;
  let waiting: { request: T } | undefined;
  return {
    send(request) {
      if (handler) handler(request);
      else waiting = { request };
    },
    listen(next) {
      handler = next;
      if (waiting) {
        const { request } = waiting;
        waiting = undefined;
        next(request);
      }
      return () => {
        if (handler === next) handler = undefined;
      };
    },
  };
}

/** Handles `channel`'s requests while mounted. */
export function useRequests<T>(
  channel: RequestChannel<T> | undefined,
  onRequest: (request: T) => void,
) {
  const latest = useRef(onRequest);
  latest.current = onRequest;
  useEffect(
    () => channel?.listen((request) => latest.current(request)),
    [channel],
  );
}
