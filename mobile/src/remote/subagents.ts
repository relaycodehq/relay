import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { subagentsBridge } from "../../../shared/remote";
import type { SubagentDetail, SubagentRun } from "../../../shared/subagents";
import { useForeground } from "../ui/motion";
import { pollSubagents } from "./subagent-poll";
import { useRemote } from "./RemoteProvider";

/** Conditional reads, serialized even across focus/state changes and manual refreshes. */
function useAsking(
  ask: (current: () => boolean) => Promise<boolean>,
  again: boolean,
  enabled: boolean,
  nudge = "",
) {
  const foreground = useForeground();
  const { status } = useRemote();
  const pending = useRef<Promise<boolean>>(undefined);
  const [failure, setFailure] = useState<{ ask: typeof ask; error: string }>();
  const request = useCallback(
    async (current: () => boolean = () => true) => {
      // An effect can be replaced while its bridge call is still in flight.
      while (pending.current) await pending.current.catch(() => {});
      if (!current()) return false;
      const next = ask(current);
      pending.current = next;
      try {
        const changed = await next;
        if (current()) setFailure(undefined);
        return changed;
      } catch (e) {
        if (current())
          setFailure({
            ask,
            error: e instanceof Error ? e.message : String(e),
          });
        throw e;
      } finally {
        if (pending.current === next) pending.current = undefined;
      }
    },
    [ask],
  );
  const refresh = useCallback(() => request().catch(() => false), [request]);
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !foreground || status !== "online") return;
      return pollSubagents(request, again);
      // A turn/pending transition nudges a read even if `again` stays true.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, foreground, status, again, request, nudge]),
  );
  return { error: failure?.ask === ask ? failure.error : undefined, refresh };
}

/** Older computers never receive these calls or expose a stale strip. */
export function useSubagentsSupported() {
  return (useRemote().overview?.bridge ?? 1) >= subagentsBridge;
}

/**
 * Chat events don't cover the SDK's background task frames between turns.
 * Conditional reads send nothing unchanged, start at 5s, and back off to 20s
 * (60s after failures). Only the focused screen in the foreground asks.
 */
export function useSubagents(
  chatId: string,
  {
    enabled,
    running,
    pending,
  }: { enabled: boolean; running: boolean; pending: number },
) {
  const { call, desktop } = useRemote();
  const supported = useSubagentsSupported();
  const cache = useMemo(() => ({ call, chatId }), [call, chatId]);
  const signature = useRef<{ cache: typeof cache; value: string }>(undefined);
  const [held, setHeld] = useState<{
    cache: typeof cache;
    runs: SubagentRun[];
  }>();
  const runs = supported && held?.cache === cache ? held.runs : [];
  const ask = useCallback(
    async (current: () => boolean) => {
      const next = await call(
        "subagents",
        chatId,
        signature.current?.cache === cache
          ? signature.current.value
          : undefined,
      );
      if (!current() || !next) return false;
      signature.current = { cache, value: next.signature };
      setHeld({ cache, runs: next.runs });
      return true;
    },
    [call, chatId, cache],
  );
  const out = runs.some((r) => r.status === "running");
  // Look again as a turn starts and ends, even when it finishes between reads.
  const { error, refresh } = useAsking(
    ask,
    running || pending > 0 || out,
    enabled && supported,
    `${running}:${pending}`,
  );
  const stop = useCallback(
    async (agentId: string) => {
      try {
        await desktop("stopProjectChatAgent", chatId, agentId);
      } finally {
        await refresh();
      }
    },
    [desktop, chatId, refresh],
  );
  return { runs, stop, error: supported ? error : undefined, refresh };
}

/** A run kept current while it works; null when the session is gone. */
export function useSubagentRun(chatId: string, agentId: string) {
  const { call, desktop } = useRemote();
  const supported = useSubagentsSupported();
  const cache = useMemo(
    () => ({ call, chatId, agentId }),
    [call, chatId, agentId],
  );
  const signature = useRef<{ cache: typeof cache; value: string }>(undefined);
  const [held, setHeld] = useState<{
    cache: typeof cache;
    run: SubagentDetail | null;
  }>();
  const run = supported && held?.cache === cache ? held.run : undefined;
  const ask = useCallback(
    async (current: () => boolean) => {
      const next = await call(
        "subagentRun",
        chatId,
        agentId,
        signature.current?.cache === cache
          ? signature.current.value
          : undefined,
      );
      if (!current() || !next) return false;
      signature.current = { cache, value: next.signature };
      setHeld({ cache, run: next.run });
      return true;
    },
    [call, chatId, agentId, cache],
  );
  const { error, refresh } = useAsking(
    ask,
    run === undefined || run?.status === "running",
    supported,
  );
  const stop = useCallback(async () => {
    try {
      await desktop("stopProjectChatAgent", chatId, agentId);
    } finally {
      await refresh();
    }
  }, [desktop, chatId, agentId, refresh]);
  return { run, error, supported, stop, refresh };
}
