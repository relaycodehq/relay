// What the phone holds of each thread a lead started, for the lead's rows:
// its latest answer and what it asks. From the saved copy first, one fetch of
// what changed whenever it starts, stops or asks, and the desktop's message
// events in between, which already reach the phone for every thread.
import { useEffect, useSyncExternalStore } from "react";
import type { ChatMessage } from "../../../shared/projects";
import { remoteHistory, type RemoteChatSummary } from "../../../shared/remote";
import { applyPatch, knownOf, mainMessages, type Thread } from "./chat-state";
import { loadThread, saveThread } from "./offline";
import { useRemote } from "./RemoteProvider";

export interface Peek {
  answer?: ChatMessage;
  /** The open question or approval, as the thread would show it. */
  request?: string;
}

const peeks = new Map<string, Peek>();
/** The started thread's running/waiting state its peek was last fetched at. */
const fetchedAt = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function set(key: string, peek: Peek) {
  peeks.set(key, peek);
  version++;
  for (const l of listeners) l();
}

/** An agent's own answer, not a note Relay writes into the thread. */
const isAnswer = (m: ChatMessage) =>
  m.role === "assistant" && !m.compaction && !m.handoff && !m.reload && !m.worktreeCommand;

function peekOf(thread: Thread): Peek {
  const request = thread.requests?.[0];
  return {
    answer: [...mainMessages(thread.messages)].reverse().find(isAnswer),
    request: request && (request.questions?.[0]?.question ?? request.title),
  };
}

/** Each started thread's peek, kept current while the rows that show them are up. */
export function useStartedPeeks(started: RemoteChatSummary[]) {
  const { status, call, onMessage, active } = useRemote();
  const computer = active ?? "";
  const ids = started.map((c) => c.id).join(" ");
  useEffect(() => {
    const off = ids
      .split(" ")
      .filter(Boolean)
      .map((id) =>
        onMessage(id, ({ message }) => {
          if (message.parentId || !isAnswer(message)) return;
          const key = `${computer}:${id}`;
          const held = peeks.get(key);
          if (held?.answer && held.answer.created > message.created) return;
          if (held?.answer?.id === message.id && held.answer.version > message.version) return;
          set(key, { ...held, answer: message });
        }),
      );
    return () => off.forEach((f) => f());
  }, [ids, computer, onMessage]);
  // Starting, stopping and asking change what the rows say: fetch what changed then.
  const states = started.map((c) => `${c.id}=${!!c.running}:${!!c.waiting}`).join(" ");
  useEffect(() => {
    let live = true;
    for (const pair of states.split(" ").filter(Boolean)) {
      const [id, state] = pair.split("=") as [string, string];
      const key = `${computer}:${id}`;
      if (fetchedAt.get(key) === state) continue;
      void (async () => {
        const saved = await loadThread(id).catch(() => undefined);
        if (saved && !peeks.has(key) && live) set(key, peekOf(saved));
        if (status !== "online" || fetchedAt.get(key) === state) return;
        fetchedAt.set(key, state);
        try {
          const patch = await call("chat", id, knownOf(saved), remoteHistory);
          let thread: Thread;
          try {
            thread = applyPatch(saved, patch);
          } catch {
            thread = applyPatch(undefined, await call("chat", id, undefined, remoteHistory));
          }
          saveThread(id, thread);
          set(key, peekOf(thread));
        } catch {
          // Lost the link or the thread: the next change or visit asks again.
          fetchedAt.delete(key);
        }
      })();
    }
    return () => {
      live = false;
    };
  }, [states, computer, status, call]);
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
  );
  return (id: string): Peek => peeks.get(`${computer}:${id}`) ?? {};
}
