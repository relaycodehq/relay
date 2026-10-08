import { useCallback, useEffect, useState } from "react";
import { subagentsBridge } from "../../../shared/remote";
import type { SubagentDetail, SubagentRun } from "../../../shared/subagents";
import { useForeground } from "../ui/motion";
import { useRemote } from "./RemoteProvider";

/**
 * Asks now, then `ms` after each answer while `again`, never two at once.
 * Only while the screen is up, the app in front and the computer there.
 * `nudge` changing asks at once.
 */
function useAsking(
  ask: () => Promise<void>,
  ms: number,
  again: boolean,
  enabled: boolean,
  nudge = "",
) {
  const foreground = useForeground();
  const { status } = useRemote();
  const on = enabled && foreground && status === "online";
  useEffect(() => {
    if (!on) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const go = async () => {
      await ask().catch(() => {});
      if (live && again) timer = setTimeout(go, ms);
    };
    void go();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [on, again, ask, ms, nudge]);
}

/** Whether the computer lists and stops subagents for phones. */
export function useSubagentsSupported() {
  return (useRemote().overview?.bridge ?? 1) >= subagentsBridge;
}

/**
 * The subagents Claude started in a thread. The desktop has no push for
 * them, so the thread asks every two seconds while its turn runs, its
 * background work waits or an agent is still out; the desktop's own window
 * asks every 1.5.
 */
export function useSubagents(
  chatId: string,
  { enabled, running, pending }: { enabled: boolean; running: boolean; pending: number },
) {
  const { desktop } = useRemote();
  const supported = useSubagentsSupported();
  const [held, setHeld] = useState<{ chatId: string; runs: SubagentRun[] }>();
  const runs = held?.chatId === chatId ? held.runs : [];
  const ask = useCallback(
    async () =>
      setHeld({ chatId, runs: await desktop("projectChatAgents", chatId) }),
    [desktop, chatId],
  );
  const out = runs.some((r) => r.status === "running");
  // A turn can send agents off and end between two asks: look again as it starts and ends.
  useAsking(ask, 2000, running || pending > 0 || out, enabled && supported, `${running}:${pending}`);
  const stop = useCallback(
    async (agentId: string) => {
      try {
        await desktop("stopProjectChatAgent", chatId, agentId);
      } finally {
        await ask().catch(() => {});
      }
    },
    [desktop, chatId, ask],
  );
  return { runs, stop };
}

/** One agent's whole run, kept current while it works; null once the session that ran it is gone. */
export function useSubagentRun(chatId: string, agentId: string) {
  const { desktop } = useRemote();
  const supported = useSubagentsSupported();
  const [run, setRun] = useState<SubagentDetail | null>();
  const [error, setError] = useState<string>();
  const ask = useCallback(async () => {
    try {
      setRun(await desktop("projectChatAgent", chatId, agentId));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [desktop, chatId, agentId]);
  useAsking(ask, 1500, run === undefined || run?.status === "running", supported);
  const stop = useCallback(async () => {
    try {
      await desktop("stopProjectChatAgent", chatId, agentId);
    } finally {
      await ask();
    }
  }, [desktop, chatId, agentId, ask]);
  return { run, error, supported, stop };
}
