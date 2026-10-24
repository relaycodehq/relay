// The composer's chip for the threads the open thread started, while any
// works or asks: beside the subagents chip and drawn like it, with the same
// two-sided card, each thread's task and latest line on the right.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, MessagesSquare } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import { agentName } from "../../../shared/agents";
import { inputBlocksThread } from "../../../shared/thread-state";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useStarted, useStartedThreads } from "./StartedThreads";
import "./subagents.css";
import "./started-threads.css";
import "../changes/branch-picker.css";

/** Still while it works, like a subagent: the turn's own row is what moves. */
function StartedStatus({ chat }: { chat: ChatSummary }) {
  return (
    <span className="subagent-status">
      {inputBlocksThread(chat) ? (
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

export function StartedChip() {
  const view = useStartedThreads();
  const started = useStarted(undefined, true);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string>();
  if (!view || !started.length) return null;
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
            data-shortcut-passive
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
