// A subagent's run, read-only: the brief Claude gave it, its calls drawn by
// the app's own turn view, and what it reported back.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, Bot, X } from "lucide-react";
import { AgentTurn } from "../../src/features/agent-turn/AgentTurn";
import { RichText } from "../../src/ui/RichText";
import { plural } from "../../shared/activity-labels";
import { agentMessage, projectRoot, type AgentState } from "./subagents-data";
import { StatusIcon, took } from "./subagents-hover";

export type OpenAs = "panel" | "thread";

export function AgentRun({
  agents,
  open,
  as,
  onSelect,
  onClose,
  onStop,
  onToast,
}: {
  agents: AgentState[];
  open: AgentState;
  as: OpenAs;
  onSelect: (id: string) => void;
  onClose: () => void;
  onStop: (id: string) => void;
  onToast: (text: string) => void;
}) {
  const tabList = useRef<HTMLDivElement>(null);
  // An agent opened from the card may be past the panel's edge; bring its tab in.
  useEffect(() => {
    tabList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open.script.id, as]);
  const tabs = (
    <div
      ref={tabList}
      className="agents-tabs"
      role="tablist"
      aria-label="Subagents"
    >
      {agents
        .filter((a) => a.status !== "waiting")
        .map((a) => (
          <button
            key={a.script.id}
            type="button"
            role="tab"
            aria-selected={a === open}
            className="agents-tab"
            title={a.script.description}
            onClick={() => onSelect(a.script.id)}
          >
            <StatusIcon a={a} size={12} />
            <span>{a.script.description}</span>
          </button>
        ))}
    </div>
  );
  const run = <Run key={open.script.id} a={open} onToast={onToast} />;
  const foot = <ReadOnlyFoot a={open} onStop={onStop} />;
  if (as === "panel")
    return (
      <aside className="agents-panel" aria-label="Subagent run">
        <div className="agents-panel-bar">
          <Bot size={14} />
          <span>Subagents</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        {tabs}
        <Follow className="agents-panel-scroll">{run}</Follow>
        {foot}
      </aside>
    );
  return (
    <section className="project-chat agents-thread">
      <div className="thread-subheader">
        <button type="button" className="text-button" onClick={onClose}>
          <ArrowLeft size={14} />
          Back to conversation
        </button>
      </div>
      <div className="agents-thread-tabs">{tabs}</div>
      <Follow className="project-messages">
        <div className="thread-message-column">{run}</div>
      </Follow>
      <div className="agents-thread-foot">{foot}</div>
    </section>
  );
}

function Run({
  a,
  onToast,
}: {
  a: AgentState;
  onToast: (text: string) => void;
}) {
  const [whole, setWhole] = useState(false);
  const message = agentMessage(a, Date.now());
  const openFile = () => onToast("Opens the file, as in the app");
  const state =
    a.status === "running"
      ? `working for ${took(a.elapsed)}`
      : a.status === "stopped"
        ? `stopped after ${took(a.elapsed)}`
        : `done in ${took(a.elapsed)}`;
  return (
    <div className="agents-run">
      <header className="agents-run-head">
        <h2>{a.script.description}</h2>
        <p>
          {a.script.type} agent · {a.script.model} ·{" "}
          {plural(a.calls.length, "call")} · {state}
        </p>
      </header>
      <section className="agents-brief" aria-label="Claude's brief">
        <header>Claude's brief</header>
        <p className={whole ? undefined : "clamped"}>{a.script.brief}</p>
        {!whole && (
          <button
            type="button"
            className="text-button"
            onClick={() => setWhole(true)}
          >
            Show all
          </button>
        )}
      </section>
      <article className="project-message assistant agents-run-message">
        <header>
          <strong>
            <Bot size={14} />
            {a.script.type === "general-purpose"
              ? "Agent"
              : `${a.script.type} agent`}
          </strong>
        </header>
        <AgentTurn
          message={message}
          projectRoot={projectRoot}
          onOpenFile={openFile}
          onChanges={() => {}}
        />
        {message.body && (
          <>
            <p className="agents-run-label">Reported to Claude</p>
            <RichText
              text={message.body}
              projectRoot={projectRoot}
              onOpenFile={openFile}
            />
          </>
        )}
        {a.status === "stopped" && (
          <p className="agents-run-note">
            Stopped from Relay. Claude is told and carries on without it.
          </p>
        )}
      </article>
    </div>
  );
}

/** Where the composer would be: the agent takes nothing from you, but can be stopped. */
function ReadOnlyFoot({
  a,
  onStop,
}: {
  a: AgentState;
  onStop: (id: string) => void;
}) {
  return (
    <div className="agents-run-foot">
      <span>
        Read-only. Agents take instructions from Claude, not from you.
      </span>
      {a.status === "running" && (
        <button type="button" onClick={() => onStop(a.script.id)}>
          Stop agent
        </button>
      )}
    </div>
  );
}

/** Stays pinned to the end while the run grows, unless you scrolled up. */
function Follow({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
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
      className={className}
      onScroll={() => {
        const el = scroll.current!;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div ref={column}>{children}</div>
    </div>
  );
}
