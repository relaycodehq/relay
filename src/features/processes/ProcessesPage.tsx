// What Relay and its agents have running, across every project and worktree,
// and what each costs. Read from this computer every few seconds while open.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  ArrowLeft,
  Cog,
  Container,
  Eye,
  FlaskConical,
  GitBranch,
  Globe,
  Hammer,
  PackageOpen,
  Square,
  SquareTerminal,
} from "lucide-react";
import { agentName } from "../../../shared/agents";
import {
  formatCpu,
  formatMemory,
  type ProcessCost,
  type ProcessEntry,
  type ProcessOverview,
} from "../../../shared/processes";
import type { TaskKind } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { useWindowFocused } from "../../lib/window-focus";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import "./processes.css";

export function ProcessesTitle({ onBack }: { onBack: () => void }) {
  return (
    <div className="project-window-title">
      <IconButton label="Back" onClick={onBack}>
        <ArrowLeft size={15} />
      </IconButton>
      <strong>Processes</strong>
    </div>
  );
}

const taskIcons: Record<TaskKind, typeof Globe> = {
  server: Globe,
  watch: Eye,
  test: FlaskConical,
  build: Hammer,
  install: PackageOpen,
  container: Container,
  git: GitBranch,
  script: SquareTerminal,
};

type Order = "mb" | "cpu";

/** The costliest first. Memory moves slowly, so that order stays put between looks. */
function sorted<T extends ProcessCost>(list: readonly T[], order: Order) {
  return [...list].sort((a, b) =>
    order === "mb"
      ? b.mb - a.mb || (b.cpu ?? 0) - (a.cpu ?? 0)
      : (b.cpu ?? 0) - (a.cpu ?? 0) || b.mb - a.mb,
  );
}

const leftBehindText = {
  "starter-gone": "nothing that started it is running",
  settled: "its thread is settled",
} as const;

export function ProcessesPage({
  onOpenChat,
}: {
  onOpenChat: (projectId: string, chatId: string) => void;
}) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<Order>(
    () => (localStorage.getItem("relay-processes-order") as Order) ?? "mb",
  );
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  // "Nothing that started it" can be a tmux server or a tunnel the user
  // started in the folder, so stopping them all asks first.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const focused = useWindowFocused();
  const query = useQuery({
    queryKey: ["process-overview"],
    queryFn: () => api.processOverview(),
    refetchInterval: focused ? 3000 : 30_000,
  });
  const { refetch } = query;
  useEffect(() => {
    if (focused) void refetch();
  }, [focused, refetch]);
  const overview = query.data;
  const leftBehind = (overview?.projects ?? []).flatMap((p) =>
    p.folders.flatMap((f) =>
      f.entries
        .filter((e) => e.leftBehind && !stopping.has(e.id))
        .map((e) => ({ projectId: p.projectId, entry: e })),
    ),
  );
  const stop = async (items: { projectId: string; entry: ProcessEntry }[]) => {
    setError(undefined);
    setStopping((s) => new Set([...s, ...items.map((i) => i.entry.id)]));
    const failed = (
      await Promise.all(
        items.map(({ projectId, entry }) =>
          api.stopProjectTask(projectId, entry.id).then(
            () => undefined,
            (e: unknown) => ({ id: entry.id, e }),
          ),
        ),
      )
    ).filter((f) => !!f);
    if (failed.length) {
      const first = failed[0]!.e;
      setError(first instanceof Error ? first.message : String(first));
      setStopping((s) => {
        const next = new Set(s);
        for (const f of failed) next.delete(f!.id);
        return next;
      });
    }
    window.setTimeout(
      () => void qc.invalidateQueries({ queryKey: ["process-overview"] }),
      800,
    );
  };
  const changeOrder = (next: Order) => {
    localStorage.setItem("relay-processes-order", next);
    setOrder(next);
  };
  return (
    <div className="pr-page">
      <header className="pr-head">
        <div>
          <h1>Processes</h1>
          <p>{overview ? summaryLine(overview) : "Looking…"}</p>
        </div>
        <div className="pr-tools">
          {leftBehind.length > 0 && !confirming && (
            <button
              type="button"
              className="pr-stop-all"
              title={leftBehind.map((l) => l.entry.title).join("\n")}
              onClick={() => setConfirming(true)}
            >
              Stop {leftBehind.length} left running
            </button>
          )}
          <div className="pr-order" role="radiogroup" aria-label="Order by">
            {(
              [
                ["mb", "Memory"],
                ["cpu", "CPU"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={order === value}
                onClick={() => changeOrder(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      {confirming && leftBehind.length > 0 && (
        <div
          className="pr-confirm"
          role="group"
          aria-label="Stop what's left running"
        >
          <p>Stop these? Each one is ended, its own processes with it.</p>
          <ul>
            {leftBehind.map(({ entry }) => (
              <li key={entry.id}>
                <strong>{entry.title}</strong>
                {entry.leftBehind && (
                  <span className="muted">
                    {" "}
                    · {leftBehindText[entry.leftBehind]}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="pr-confirm-buttons">
            <button type="button" onClick={() => setConfirming(false)}>
              Keep them
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirming(false);
                void stop(leftBehind);
              }}
            >
              Stop {leftBehind.length}
            </button>
          </div>
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {query.error ? (
        <ErrorBox error={query.error} />
      ) : !overview ? (
        <Loading />
      ) : (
        <>
          {overview.projects.length === 0 && (
            <p className="pr-empty">
              No agent or command is running in any project.
            </p>
          )}
          {sorted(overview.projects, order).map((p) => (
            <Group key={p.projectId} title={p.name} cost={p}>
              {sorted(p.folders, order)
                // The checkout leads; worktrees follow by cost.
                .sort((a, b) => Number(!b.checkout) - Number(!a.checkout))
                .map((f) => (
                  <tbody key={f.path}>
                    <tr className="pr-folder">
                      <th colSpan={4} title={f.path}>
                        {f.checkout ? (
                          "Checkout"
                        ) : f.thread ? (
                          <>
                            Worktree ·{" "}
                            <ThreadLink
                              thread={f.thread}
                              onOpen={() =>
                                onOpenChat(p.projectId, f.thread!.id)
                              }
                            />
                          </>
                        ) : (
                          "Worktree"
                        )}
                      </th>
                    </tr>
                    {sorted(f.entries, order).map((e) => (
                      <Row
                        key={e.id}
                        entry={e}
                        folderThread={f.thread?.id}
                        stopping={stopping.has(e.id)}
                        onOpenThread={(id) => onOpenChat(p.projectId, id)}
                        onStop={() =>
                          void stop([{ projectId: p.projectId, entry: e }])
                        }
                      />
                    ))}
                  </tbody>
                ))}
            </Group>
          ))}
          <Group title="Relay itself" cost={overview.relay}>
            <tbody>
              {sorted(overview.relay.entries, order).map((e) => (
                <Row key={e.id} entry={e} stopping={false} />
              ))}
            </tbody>
          </Group>
          <p className="pr-note">{platformNote(overview)}</p>
        </>
      )}
    </div>
  );
}

function summaryLine(o: ProcessOverview) {
  const share = o.total.mb / o.machine.totalMb;
  const cpu = o.total.cpu;
  const machineCpu =
    cpu !== undefined && o.machine.cores > 1
      ? ` (${formatCpu(cpu / o.machine.cores)} of ${o.machine.cores} cores)`
      : "";
  return [
    `${formatCpu(cpu)} CPU${machineCpu}`,
    `${formatMemory(o.total.mb)} of ${formatMemory(o.machine.totalMb)} memory${share >= 0.01 ? ` (${Math.round(share * 100)}%)` : ""}`,
  ].join(" · ");
}

function platformNote(o: ProcessOverview) {
  const cpu = `CPU counts one core as 100%, so ${o.machine.cores} busy cores read ${o.machine.cores * 100}%.`;
  if (o.platform === "win32")
    return `${cpu} Windows doesn't say where a process runs, so an agent shows under its thread once it has run a command, and commands left running outside Relay's threads aren't found.`;
  if (o.platform === "linux")
    return `${cpu} Linux CPU shows from the second reading on.`;
  return cpu;
}

function Group({
  title,
  cost,
  children,
}: {
  title: string;
  cost: ProcessCost;
  children: ReactNode;
}) {
  return (
    <section className="pr-group">
      <table>
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col" className="pr-num">
              {formatCpu(cost.cpu)}
            </th>
            <th scope="col" className="pr-num">
              {formatMemory(cost.mb)}
            </th>
            <th scope="col" className="pr-act" aria-label="Actions" />
          </tr>
        </thead>
        {children}
      </table>
    </section>
  );
}

function ThreadLink({
  thread,
  onOpen,
}: {
  thread: { id: string; title: string };
  onOpen: () => void;
}) {
  return (
    <button type="button" className="pr-thread" onClick={onOpen}>
      {thread.title || "Untitled thread"}
    </button>
  );
}

function Row({
  entry: e,
  folderThread,
  stopping,
  onOpenThread,
  onStop,
}: {
  entry: ProcessEntry;
  /** The thread whose worktree the row sits in, already named above it. */
  folderThread?: string;
  stopping: boolean;
  onOpenThread?: (chatId: string) => void;
  onStop?: () => void;
}) {
  const Icon =
    e.kind === "task" && e.taskKind
      ? taskIcons[e.taskKind]
      : e.kind === "app"
        ? AppWindow
        : Cog;
  const title = e.kind === "agent" && e.agent ? agentName(e.agent) : e.title;
  const detail = [
    e.ports.length > 0 && e.ports.map((p) => `:${p}`).join(" "),
    e.processes > 1 && `${e.processes} processes`,
    e.leftBehind && leftBehindText[e.leftBehind],
  ].filter(Boolean);
  return (
    <tr className={`pr-row${stopping ? " stopping" : ""}`}>
      <td>
        <span className="pr-name" title={e.command}>
          <span className="pr-icon" aria-hidden>
            {e.kind === "agent" && e.agent ? (
              <ProviderIcon provider={e.agent} />
            ) : (
              <Icon size={14} />
            )}
          </span>
          <span className="pr-title">{title}</span>
          {e.thread && onOpenThread && e.thread.id !== folderThread && (
            <ThreadLink
              thread={e.thread}
              onOpen={() => onOpenThread(e.thread!.id)}
            />
          )}
          {detail.length > 0 && (
            <span
              className={`pr-detail${e.leftBehind ? " left-behind" : ""}`}
            >
              {detail.join(" · ")}
            </span>
          )}
        </span>
      </td>
      <td className="pr-num">{formatCpu(e.cpu)}</td>
      <td className="pr-num">{formatMemory(e.mb)}</td>
      <td className="pr-act">
        {e.kind === "task" && onStop && (
          <IconButton
            label={stopping ? "Stopping…" : "Stop"}
            disabled={stopping}
            onClick={onStop}
          >
            <Square size={9} fill="currentColor" />
          </IconButton>
        )}
      </td>
    </tr>
  );
}
