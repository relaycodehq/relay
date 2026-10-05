// The threads a turn's agent started with Relay's tools, beside the call that
// started them: an icon and how many are done, and on hover a card like the
// subagents one, each thread's task and latest line, a click to open it.
import { createContext, useContext, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, MessagesSquare } from "lucide-react";
import type { AgentActivity, ChatSummary } from "../../../shared/projects";
import { agentName } from "../../../shared/agents";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import "./subagents.css";
import "./started-threads.css";
import "../changes/branch-picker.css";

/** The open thread, its project's threads and how to open one; absent where nothing can open. */
export interface StartedThreadsView {
  lead: string | undefined;
  threads: ChatSummary[];
  open: (chat: ChatSummary) => void;
}
export const StartedThreadsContext = createContext<
  StartedThreadsView | undefined
>(undefined);
export const useStartedThreads = () => useContext(StartedThreadsContext);

/** A call to Relay's start_threads tool. */
export const isStartThreads = (a: AgentActivity) =>
  a.mcp?.server === "relay" && a.mcp.tool === "start_threads";

/** The ids a start_threads call's result names, when it can be read. */
export function startedIds(result: string | undefined) {
  try {
    const parsed = JSON.parse(result ?? "");
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.flatMap((t) =>
      t && typeof t.id === "string" ? [t.id] : [],
    );
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}

/** Still while it works, like a subagent: the turn's own row is what moves. */
function StartedStatus({ chat }: { chat: ChatSummary }) {
  return (
    <span className="subagent-status">
      {chat.waiting ? (
        <span className="started-ask" aria-label="Needs input" />
      ) : chat.running ? (
        <span className="subagent-dot" aria-label="Working" />
      ) : (
        <Check size={13} className="subagent-done" aria-label="Done" />
      )}
    </span>
  );
}

/** The thread pointed at: what it was asked and what it said last. */
function Detail({ chat, onOpen }: { chat: ChatSummary; onOpen: () => void }) {
  const qc = useQueryClient();
  const thread = useQuery({
    queryKey: chatKey(chat.id),
    queryFn: () => fetchChat(qc, chat.id),
  }).data;
  const main = thread?.messages.filter((m) => !m.parentId) ?? [];
  const task = main.find((m) => m.role === "user")?.body;
  const last = [...main].reverse().find((m) => m.role === "assistant");
  const now = chat.waiting
    ? (thread?.requests?.[0]?.title ?? "Needs your input")
    : last?.body.trim()
      ? last.body.trim().split("\n").filter(Boolean).at(-1)
      : chat.running
        ? "Starting…"
        : "No answer yet";
  return (
    <div className="subagents-detail">
      <div className="subagents-title">
        <b>{chat.title}</b>
        <span>
          {[chat.provider && agentName(chat.provider), chat.branch]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {task && <p className="subagents-brief">{task}</p>}
      <p className={`subagents-now ${chat.waiting ? "started-asks" : ""}`}>
        {now}
      </p>
      <div className="subagents-calls" />
      <div className="subagents-actions">
        <button type="button" className="text-button" onClick={onOpen}>
          {chat.waiting ? "Answer it" : "Open thread"}
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Beside a start_threads call, the threads it started; by the composer, with
 * `live`, the lead's threads while any of them works or asks.
 */
export function StartedChip({
  ids,
  live = false,
}: {
  ids: string[] | undefined;
  live?: boolean;
}) {
  const view = useStartedThreads();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string>();
  const started = (view?.threads ?? [])
    .filter(
      (c) => c.startedBy?.chatId === view?.lead && (!ids || ids.includes(c.id)),
    )
    .sort((a, b) => a.created - b.created);
  if (!view || !started.length || (live && !started.some((c) => c.running)))
    return null;
  const done = started.filter((c) => !c.running).length;
  const asking = started.some((c) => c.waiting);
  const pointed =
    started.find((c) => c.id === focus) ??
    started.find((c) => c.waiting) ??
    started.find((c) => c.running) ??
    started[0]!;
  const go = (chat: ChatSummary) => {
    setOpen(false);
    view.open(chat);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className="composer-branch-trigger subagents-chip started-chip"
        aria-label={`${started.length} started threads: ${done} done`}
        // Inside the call's row, which folds open on a click.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <MessagesSquare size={13} />
        <span>
          {done}/{started.length}
        </span>
        {asking && (
          <span className="started-ask" aria-label="One needs input" />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup
            className="subagents-card"
            aria-label="Started threads"
          >
            <div className="subagents-peek">
              <div className="subagents-list">
                <div className="subagents-card-head">
                  <b>Started threads</b>
                  <span>
                    {done} of {started.length} done
                  </span>
                </div>
                {started.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="subagents-item"
                    aria-current={c === pointed}
                    onMouseEnter={() => setFocus(c.id)}
                    onFocus={() => setFocus(c.id)}
                    onClick={() => go(c)}
                  >
                    <StartedStatus chat={c} />
                    <span className="subagents-name">{c.title}</span>
                    {c.provider && (
                      <span className="started-agent">
                        <ProviderIcon provider={c.provider} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <Detail chat={pointed} onOpen={() => go(pointed)} />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
