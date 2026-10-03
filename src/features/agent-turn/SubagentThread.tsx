// An agent's run as a side thread over the conversation, read-only: the brief
// Claude gave it, its text and calls drawn as a turn, and what it reported.
// The conversation stays laid out underneath, so it keeps its place.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot } from "lucide-react";
import { api } from "../../lib/api";
import type { ChatMessage } from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { plural } from "../../../shared/activity-labels";
import {
  batchOf,
  modelName,
  type SubagentDetail,
  type SubagentRun,
} from "../../../shared/subagents";
import { AgentTurn } from "./AgentTurn";
import { RichText } from "../../ui/ui";
import { SubagentStatus, agentKind } from "./Subagents";
import { POPUPS } from "../../lib/shortcuts";

export function SubagentThread({
  chatId,
  runs,
  openId,
  projectRoot,
  onSelect,
  onClose,
  onOpenFile,
  onChanges,
}: {
  chatId: string;
  runs: SubagentRun[];
  openId: string;
  projectRoot: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
}) {
  const qc = useQueryClient();
  const self = useRef<HTMLDivElement>(null);
  const detail = useQuery({
    queryKey: ["project-chat-agent", chatId, openId],
    queryFn: () => api.projectChatAgent(chatId, openId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 1000 : false,
  });
  const run = detail.data;
  const tabs = batchOf(runs, openId);
  // Stays pressed until the run reports it stopped, which takes the button away.
  const [stopping, setStopping] = useState<string>();
  const [error, setError] = useState<string>();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Handled here, the composer underneath doesn't take it as a first
    // Escape toward stopping the turn.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape then belongs to a popup open over the run, like an image preview.
      const popups = [...document.querySelectorAll(POPUPS)];
      if (popups.some((popup) => popup !== self.current)) return;
      event.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const stop = async () => {
    setStopping(openId);
    setError(undefined);
    try {
      await api.stopProjectChatAgent(chatId, openId);
      // Its tab and the indicator's count change with it.
      await Promise.all([
        qc.invalidateQueries({
          queryKey: ["project-chat-agent", chatId, openId],
        }),
        qc.invalidateQueries({ queryKey: ["project-chat-agents", chatId] }),
      ]);
    } catch (e) {
      setStopping(undefined);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div
      ref={self}
      className="subagent-thread"
      role="dialog"
      aria-label={run ? `${agentKind(run)}: ${run.description}` : "Agent run"}
    >
      <div className="thread-subheader">
        <button
          type="button"
          className="text-button"
          autoFocus
          onClick={onClose}
        >
          <ArrowLeft size={14} />
          Back to conversation
        </button>
      </div>
      {tabs.length > 1 && (
        <nav className="subagent-tabs" aria-label="Agents started together">
          {tabs.map((r) => (
            <button
              key={r.id}
              type="button"
              className="subagent-tab"
              aria-current={r.id === openId}
              title={r.description}
              onClick={() => onSelect(r.id)}
            >
              <SubagentStatus run={r} />
              <span>{r.description}</span>
            </button>
          ))}
        </nav>
      )}
      <Follow key={openId}>
        {run ? (
          <Run
            run={run}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
            onChanges={onChanges}
          />
        ) : (
          <p className="subagent-note">
            {detail.isPending
              ? "Opening…"
              : "This agent's run is gone: the session that ran it ended."}
          </p>
        )}
      </Follow>
      <div className="subagent-foot">
        <span>
          Read-only. Agents take instructions from Claude, not from you.
        </span>
        {error && <span role="alert">{error}</span>}
        {run?.status === "running" && (
          <button
            type="button"
            disabled={stopping === openId}
            onClick={() => void stop()}
          >
            {stopping === openId ? "Stopping…" : "Stop agent"}
          </button>
        )}
      </div>
    </div>
  );
}

function Run({
  run,
  projectRoot,
  onOpenFile,
  onChanges,
}: {
  run: SubagentDetail;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
}) {
  const [whole, setWhole] = useState(false);
  const live = run.status === "running";
  const message: ChatMessage = {
    id: `agent:${run.id}`,
    role: "assistant",
    provider: "claude",
    status: live
      ? "streaming"
      : run.status === "stopped"
        ? "cancelled"
        : run.status === "failed"
          ? "failed"
          : "complete",
    body: run.report ?? "",
    created: run.started,
    ...(run.ended ? { ended: run.ended } : {}),
    trace: run.trace,
    version: 1,
  };
  return (
    <div className="thread-message-column">
      <header className="subagent-head">
        <h2>{run.description}</h2>
        {/* How long it took is on its turn's heading. */}
        <p>
          {[
            agentKind(run),
            run.model && modelName(run.model),
            plural(run.calls, "call"),
            run.status === "failed" && "failed",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>
      {run.brief && (
        <section className="subagent-brief" aria-label="Claude's brief">
          <header>Claude's brief</header>
          <p className={whole ? undefined : "clamped"}>{run.brief}</p>
          {!whole && run.brief.length > 220 && (
            <button
              type="button"
              className="text-button"
              onClick={() => setWhole(true)}
            >
              Show all
            </button>
          )}
        </section>
      )}
      <article className="project-message assistant subagent-message">
        <header>
          <strong>
            <Bot size={14} />
            {agentKind(run)}
          </strong>
        </header>
        <AgentTurn
          message={message}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onChanges={onChanges}
          open
        />
        {!live && run.report && (
          <>
            <p className="subagent-label">Reported to Claude</p>
            <RichText
              text={run.report}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
            />
          </>
        )}
        {run.status === "stopped" && (
          <p className="subagent-note">
            Stopped. Claude hears it was and carries on without it.
          </p>
        )}
      </article>
    </div>
  );
}

/** Stays pinned to the end while the run grows, unless you scrolled up. */
function Follow({ children }: { children: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const el = scroll.current;
      if (el && follow.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={scroll}
      className="subagent-scroll"
      onScroll={() => {
        const el = scroll.current!;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div ref={column}>{children}</div>
    </div>
  );
}
