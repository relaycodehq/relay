import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
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
import type { ChatSummary, Project } from "../../shared/projects";
import type { ProjectTask, TaskKind } from "../../shared/tasks";
import { api } from "../lib/api";
import "./running-tasks.css";

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
const agentLabel = { claude: "Claude", codex: "Codex" };

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

/** Shell processes Claude and Codex left running in this project, from any conversation. */
export function RunningTasks({
  project,
  chats,
  onOpenChat,
}: {
  project: Project;
  chats: ChatSummary[];
  onOpenChat: (chat: ChatSummary) => void;
}) {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("relay-tasks-collapsed") === "true",
  );
  const [busy, setBusy] = useState<Map<string, "stop" | "restart">>(new Map());
  const [error, setError] = useState<string>();
  const tasks = useQuery({
    queryKey: ["project-tasks", project.id],
    queryFn: () => api.projectTasks(project.id),
    refetchInterval: 3000,
  });
  const list = tasks.data ?? [];
  if (!list.length) return null;
  const now = Date.now();
  const toggle = () => {
    setCollapsed((v) => {
      localStorage.setItem("relay-tasks-collapsed", String(!v));
      return !v;
    });
  };
  const act = async (task: ProjectTask, action: "stop" | "restart") => {
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
      setError(e instanceof Error ? e.message : String(e));
      setBusy((b) => {
        const next = new Map(b);
        next.delete(task.id);
        return next;
      });
    }
  };
  const seen = new Set<string>();
  return (
    <aside
      className={`running-tasks ${collapsed ? "collapsed" : ""}`}
      aria-label="Running processes"
    >
      <button
        type="button"
        className="running-tasks-header"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span className="running-tasks-heading">Running</span>
        <span className="running-tasks-count">{list.length}</span>
        <span className="spacer" />
        <ChevronDown size={14} className="running-tasks-chevron" />
      </button>
      {!collapsed && (
        <ul className="running-tasks-list">
          {list.map((task) => {
            const Icon = icons[task.kind];
            const chat = task.chatId
              ? chats.find((c) => c.id === task.chatId)
              : undefined;
            const duplicate = seen.has(task.command);
            seen.add(task.command);
            const agent = task.agent ? agentLabel[task.agent] : undefined;
            const source =
              task.origin === "detached"
                ? "In the background"
                : task.origin === "external"
                  ? `${agent} in a terminal`
                  : chat
                    ? null
                    : `${agent} in Relay`;
            const port = task.ports[0];
            const state = busy.get(task.id);
            const worktree = task.worktree
              ? chats.find((c) => c.id === task.worktree)
              : undefined;
            const detail = [
              displayCommand(task.command),
              task.worktree &&
                `Runs in the worktree of ${worktree?.title ?? "a thread"}, not the checkout`,
              task.ports.length > 1 &&
                `Listening on ${task.ports.map((p) => `:${p}`).join(", ")}`,
              chat ? `${agent ? `${agent} · ` : ""}${chat.title}` : source,
              `Started ${new Date(task.started).toLocaleString()}`,
              duplicate && "The same command is already running",
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <li
                key={task.id}
                className={state ? `busy ${state}` : undefined}
                title={detail}
              >
                <Icon size={15} className="running-task-icon" aria-hidden />
                {port ? (
                  <button
                    type="button"
                    className="running-task-title"
                    title={`Open localhost:${port}`}
                    onClick={() =>
                      void api.openExternal(`http://localhost:${port}`)
                    }
                  >
                    <span>{task.title}</span>
                    <ArrowUpRight size={13} aria-hidden />
                  </button>
                ) : chat ? (
                  <button
                    type="button"
                    className="running-task-title"
                    onClick={() => onOpenChat(chat)}
                  >
                    <span>{task.title}</span>
                  </button>
                ) : (
                  <span className="running-task-title">
                    <span>{task.title}</span>
                  </span>
                )}
                {task.worktree && (
                  <small className="running-task-where">worktree</small>
                )}
                <span className="running-task-end">
                  <span className="running-task-time">
                    {elapsed(task.started, now)}
                  </span>
                  <span className="running-task-buttons">
                    <button
                      type="button"
                      title={state === "restart" ? "Restarting…" : "Restart"}
                      aria-label={`Restart ${task.title}`}
                      disabled={!!state}
                      onClick={() => void act(task, "restart")}
                    >
                      <RotateCw size={12} />
                    </button>
                    <button
                      type="button"
                      className="running-task-stop"
                      title={state === "stop" ? "Stopping…" : "Stop"}
                      aria-label={`Stop ${task.title}`}
                      disabled={!!state}
                      onClick={() => void act(task, "stop")}
                    >
                      <Square size={9} fill="currentColor" />
                    </button>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!collapsed && error && <p className="running-tasks-error">{error}</p>}
    </aside>
  );
}
