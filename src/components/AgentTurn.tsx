// Adapted from T3 Code's MessagesTimeline turn fold and activity group behavior.
import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  FileCode2,
  LoaderCircle,
  Terminal,
  X,
} from "lucide-react";
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
} from "../../shared/projects";
import type { ProjectFileLink } from "../lib/project-file-links";
import { RichText } from "./ui";

function duration(ms: number) {
  const seconds = Math.max(0, ms / 1000);
  return seconds < 10
    ? `${seconds.toFixed(1)}s`
    : seconds < 60
      ? `${Math.floor(seconds)}s`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function WorkingTimer({ started }: { started: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{duration(now - started)}</>;
}

function ToolStep({
  activity: a,
  onChanges,
}: {
  activity: AgentActivity;
  onChanges: () => void;
}) {
  return (
    <details className={`agent-step ${a.status}`}>
      <summary>
        {a.kind === "command" ? (
          <Terminal size={14} />
        ) : (
          <FileCode2 size={14} />
        )}
        <span>{a.label}</span>
        {a.status === "running" ? (
          <LoaderCircle size={12} className="spin" />
        ) : a.status === "complete" ? (
          <Check size={12} />
        ) : (
          <X size={12} />
        )}
      </summary>
      {a.detail && <pre>{a.detail}</pre>}
      {a.kind === "file" && (
        <button onClick={onChanges}>Open working changes</button>
      )}
    </details>
  );
}

export function AgentTurn({
  message,
  projectRoot,
  onOpenFile,
  onChanges,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onChanges: () => void;
}) {
  const live = message.status === "streaming";
  const [expanded, setExpanded] = useState(live);
  useEffect(() => setExpanded(live), [live]);
  const entries: AgentTrace[] =
    message.trace ??
    (message.activity ?? []).map((activity) => ({
      kind: "activity" as const,
      id: activity.id,
      activity,
    }));
  if (!live && !entries.length) return null;
  const ended = message.ended ?? message.created;
  return (
    <details
      className="agent-activity"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="agent-run-heading">
        <span>
          {live ? (
            <>
              Working for <WorkingTimer started={message.created} />
            </>
          ) : message.ended ? (
            <>
              {message.status === "cancelled" ? "Stopped after" : "Worked for"}{" "}
              {duration(ended - message.created)}
            </>
          ) : (
            <>Worked in the project</>
          )}
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="agent-trace" aria-label="Local agent activity">
        {entries.length === 0 && (
          <div className="agent-thinking">
            <Brain size={15} /> Thinking
          </div>
        )}
        {entries.map((entry, index) => {
          if (entry.kind === "commentary")
            return (
              <div className="agent-commentary" key={entry.id}>
                <RichText
                  text={entry.text}
                  projectRoot={projectRoot}
                  onOpenFile={onOpenFile}
                />
              </div>
            );
          if (entry.activity.kind !== "command")
            return (
              <ToolStep
                key={entry.id}
                activity={entry.activity}
                onChanges={onChanges}
              />
            );
          const previous = entries[index - 1];
          if (
            previous?.kind === "activity" &&
            previous.activity.kind === "command"
          )
            return null;
          const commands: AgentActivity[] = [];
          for (let i = index; i < entries.length; i++) {
            const next = entries[i];
            if (next.kind !== "activity" || next.activity.kind !== "command")
              break;
            commands.push(next.activity);
          }
          return (
            <details className="agent-command-group" key={entry.id}>
              <summary>
                <Terminal size={15} /> Ran {commands.length}{" "}
                {commands.length === 1 ? "command" : "commands"}
              </summary>
              {commands.map((a) => (
                <ToolStep key={a.id} activity={a} onChanges={onChanges} />
              ))}
            </details>
          );
        })}
        {live &&
          entries.length > 0 &&
          !message.body &&
          (() => {
            const last = entries.at(-1);
            return last?.kind === "activity" &&
              last.activity.status !== "running" ? (
              <div className="agent-thinking">
                <Brain size={15} /> Thinking
              </div>
            ) : null;
          })()}
      </div>
    </details>
  );
}
