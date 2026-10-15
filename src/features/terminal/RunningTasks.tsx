import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useStoredFlag } from "../../lib/useStoredFlag";
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
import { agentName } from "../../../shared/agents";
import type { ChatSummary, Project } from "../../../shared/projects";
import type { ProjectTask, TaskKind } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { useChatWidth } from "../../lib/chat-width";
import { useWindowFocused } from "../../lib/window-focus";
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

/** The open card's width and inset from the pane's edge (running-tasks.css), and the gap it keeps from the text. */
const CARD = 280 + 14 + 8;

/** Whether the open card fits beside the thread's column, which centres in
 * the pane at --thread-width, instead of over its text. */
function useRoomBeside(card: HTMLElement | null) {
  const column = useChatWidth();
  const [pane, setPane] = useState(0);
  // Measured before paint, so the card doesn't open for a frame and fold.
  useLayoutEffect(() => {
    const parent = card?.parentElement;
    if (!parent) return;
    setPane(parent.clientWidth);
    const observer = new ResizeObserver(() => setPane(parent.clientWidth));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [card]);
  return pane - column >= 2 * CARD;
}

/** Runs `change` as a morph between the card's two shapes (running-tasks.css). */
function morph(way: "open" | "close", change: () => void) {
  if (
    !document.startViewTransition ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return change();
  document.startViewTransition({
    update: () => flushSync(change),
    types: [`running-tasks-${way}`],
  });
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
  const [folded, setFolded] = useStoredFlag("relay-tasks-collapsed");
  const [card, setCard] = useState<HTMLElement | null>(null);
  const roomy = useRoomBeside(card);
  // Without room it stays folded, and opens only until it's closed or the
  // room comes back; the choice saved for a roomy pane stays as it was.
  const [peeking, setPeeking] = useState(false);
  if (roomy && peeking) setPeeking(false);
  const collapsed = roomy ? folded : !peeking;
  const [busy, setBusy] = useState<Map<string, "stop" | "restart">>(new Map());
  const [error, setError] = useState<string>();
  // Each look reads the system's whole process list: on Windows, through WMI,
  // a look every 3 s costs ~4% of a core. Behind other windows a task can
  // show up to 30 s later; back in front, within 3 s.
  const focused = useWindowFocused();
  const tasks = useQuery({
    queryKey: ["project-tasks", project.id],
    queryFn: () => api.projectTasks(project.id),
    refetchInterval: focused ? 3000 : 30_000,
  });
  const list = tasks.data ?? [];
  if (!list.length) return null;
  const now = Date.now();
  const toggle = () =>
    morph(collapsed ? "open" : "close", () =>
      roomy ? setFolded(!folded) : setPeeking(!peeking),
    );
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
      ref={setCard}
      className={`running-tasks${collapsed ? " collapsed" : ""}`}
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
            const agent = task.agent ? agentName(task.agent) : undefined;
            const terminal = task.origin === "terminal";
            const source =
              task.origin === "detached"
                ? "In the background"
                : task.origin === "external"
                  ? `${agent} in a terminal`
                  : chat
                    ? null
                    : terminal
                      ? "In a Relay terminal"
                      : `${agent} in Relay`;
            const port = task.ports[0];
            const state = busy.get(task.id);
            const worktree = task.worktree
              ? chats.find((c) => c.id === task.worktree)
              : undefined;
            const detail = [
              displayCommand(task.command),
              task.worktree &&
                `Runs in the worktree of ${worktree?.title ?? "a thread"}, not the project folder`,
              task.ports.length > 1 &&
                `Listening on ${task.ports.map((p) => `:${p}`).join(", ")}`,
              chat
                ? `${terminal ? "Terminal · " : agent ? `${agent} · ` : ""}${chat.title}`
                : source,
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
                    {!terminal && (
                      <button
                        type="button"
                        title={state === "restart" ? "Restarting…" : "Restart"}
                        aria-label={`Restart ${task.title}`}
                        disabled={!!state}
                        onClick={() => void act(task, "restart")}
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
