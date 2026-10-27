import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Container,
  Eye,
  FlaskConical,
  GitBranch,
  Globe,
  Hammer,
  PackageOpen,
  RotateCw,
  Square,
  SquareTerminal,
} from "lucide-react";
import { agentName } from "../../../shared/agents";
import { errorMessage } from "../../../shared/error-message";
import { formatMemory } from "../../../shared/processes";
import type { ChatSummary, Project } from "../../../shared/projects";
import type { ProjectTask, TaskKind } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { formatShare, Sparkline } from "./TaskLoad";

const icons: Record<TaskKind, typeof Globe> = {
  server: Globe,
  watch: Eye,
  test: FlaskConical,
  build: Hammer,
  install: PackageOpen,
  container: Container,
  git: GitBranch,
  script: SquareTerminal,
};

/** A task taking a quarter of the computer. */
const HOT = 25;

type Action = "stop" | "restart";

/** Drop shell plumbing that says nothing about the process, e.g. `2>&1` or a trailing `&`. */
function displayCommand(command: string) {
  return (
    command
      .replace(/\s+(?:[12]?>&[12]|&>\s*\/dev\/null|[12]?>\s*\/dev\/null)/g, "")
      .replace(/\s*&\s*$/, "")
      .trim() || command
  );
}

function elapsed(started: number, now: number) {
  const s = Math.max(0, Math.round((now - started) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400)
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

/** Where a task came from, when no thread of this project started it. */
function sourceOf(task: ProjectTask, agent: string | undefined) {
  if (task.origin === "detached") return "In the background";
  if (task.origin === "external") return `${agent} in a terminal`;
  if (task.origin === "terminal") return "In a Relay terminal";
  return `${agent} in Relay`;
}

/** The row's tooltip: the command, then everything else known about the task. */
function taskDetail({
  task,
  chat,
  worktree,
  duplicate,
  now,
}: {
  task: ProjectTask;
  chat?: ChatSummary;
  worktree?: ChatSummary;
  duplicate: boolean;
  now: number;
}) {
  const agent = task.agent ? agentName(task.agent) : undefined;
  const terminal = task.origin === "terminal";
  return [
    displayCommand(task.command),
    task.worktree &&
      `Runs in the worktree of ${worktree?.title ?? "a thread"}, not the project folder`,
    task.ports.length > 1 &&
      `Listening on ${task.ports.map((p) => `:${p}`).join(", ")}`,
    chat
      ? `${terminal ? "Terminal · " : agent ? `${agent} · ` : ""}${chat.title}`
      : sourceOf(task, agent),
    `Started ${new Date(task.started).toLocaleString()}, ${elapsed(task.started, now)} ago`,
    task.mb !== undefined && `${formatMemory(task.mb)} of memory`,
    duplicate && "The same command is already running",
  ]
    .filter(Boolean)
    .join("\n");
}

function TaskTitle({
  task,
  chat,
  onOpenChat,
}: {
  task: ProjectTask;
  chat?: ChatSummary;
  onOpenChat: (chat: ChatSummary) => void;
}) {
  const port = task.ports[0];
  if (port)
    return (
      <button
        type="button"
        className="running-task-title"
        title={`Open localhost:${port}`}
        onClick={() => void api.openExternal(`http://localhost:${port}`)}
      >
        <span>{task.title}</span>
        <ArrowUpRight size={13} aria-hidden />
      </button>
    );
  if (chat)
    return (
      <button
        type="button"
        className="running-task-title"
        onClick={() => onOpenChat(chat)}
      >
        <span>{task.title}</span>
      </button>
    );
  return (
    <span className="running-task-title">
      <span>{task.title}</span>
    </span>
  );
}

/** What the task costs, in place of how long it has run, while the card is open in front. */
function TaskCost({
  cpu,
  line,
  busiest,
}: {
  cpu: number;
  line: number[];
  busiest: number;
}) {
  return (
    <span className={`running-task-load${cpu >= HOT ? " hot" : ""}`}>
      <Sparkline values={line} max={busiest} />
      <span>{formatShare(cpu)}</span>
    </span>
  );
}

function TaskButtons({
  task,
  state,
  onAct,
}: {
  task: ProjectTask;
  state?: Action;
  onAct: (action: Action) => void;
}) {
  return (
    <span className="running-task-buttons">
      {task.origin !== "terminal" && (
        <button
          type="button"
          title={state === "restart" ? "Restarting…" : "Restart"}
          aria-label={`Restart ${task.title}`}
          disabled={!!state}
          onClick={() => onAct("restart")}
        >
          <RotateCw size={12} />
        </button>
      )}
      <button
        type="button"
        className="running-task-stop"
        title={state === "stop" ? "Stopping…" : "Stop"}
        aria-label={`Stop ${task.title}`}
        disabled={!!state}
        onClick={() => onAct("stop")}
      >
        <Square size={9} fill="currentColor" />
      </button>
    </span>
  );
}

/** Stop and Restart, with which task is mid-way through one, and what last failed. */
function useTaskActions(project: Project) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Map<string, Action>>(new Map());
  const [error, setError] = useState<string>();
  const act = async (task: ProjectTask, action: Action) => {
    setBusy((b) => new Map(b).set(task.id, action));
    setError(undefined);
    try {
      await (action === "stop"
        ? api.stopProjectTask(project.id, task.id)
        : api.restartProjectTask(project.id, task.id));
      window.setTimeout(
        () =>
          void qc.invalidateQueries({
            queryKey: ["project-tasks", project.id],
          }),
        800,
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy((b) => {
        const next = new Map(b);
        next.delete(task.id);
        return next;
      });
    }
  };
  return { busy, error, act };
}

/** The project's running tasks, each with its load or age, and Stop and Restart on hover. */
export function TaskList({
  project,
  tasks,
  chats,
  costed,
  history,
  onOpenChat,
}: {
  project: Project;
  tasks: ProjectTask[];
  chats: ChatSummary[];
  /** The card is open in front, so each task's CPU is known. */
  costed: boolean;
  history: Map<string, number[]>;
  onOpenChat: (chat: ChatSummary) => void;
}) {
  const { busy, error, act } = useTaskActions(project);
  // One scale for every line, so a busy task looks busier than an idle one.
  const busiest = Math.max(10, ...[...history.values()].flat());
  const now = Date.now();
  const seen = new Set<string>();
  return (
    <>
      <ul className="running-tasks-list">
        {tasks.map((task) => {
          const Icon = icons[task.kind];
          const chat = chats.find((c) => c.id === task.chatId);
          const worktree = chats.find((c) => c.id === task.worktree);
          const duplicate = seen.has(task.command);
          seen.add(task.command);
          const state = busy.get(task.id);
          return (
            <li
              key={task.id}
              className={state ? `busy ${state}` : undefined}
              title={taskDetail({ task, chat, worktree, duplicate, now })}
            >
              <Icon size={15} className="running-task-icon" aria-hidden />
              <TaskTitle task={task} chat={chat} onOpenChat={onOpenChat} />
              {task.worktree && (
                <small className="running-task-where">worktree</small>
              )}
              <span className="running-task-end">
                {costed && task.cpu !== undefined ? (
                  <TaskCost
                    cpu={task.cpu}
                    line={history.get(task.id) ?? []}
                    busiest={busiest}
                  />
                ) : (
                  <span className="running-task-time">
                    {elapsed(task.started, now)}
                  </span>
                )}
                <TaskButtons
                  task={task}
                  state={state}
                  onAct={(action) => void act(task, action)}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {error && <p className="running-tasks-error">{error}</p>}
    </>
  );
}
