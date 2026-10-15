// Turns one reading of every process into the Processes page: each project's
// folders with what runs in them, and Relay's own share. Every process counts
// once, in the entry nearest above it: a task, an agent, or one of Relay's.
import { sep } from "node:path";
import type { AgentProvider } from "../../shared/agents";
import {
  addCosts,
  type ProcessCost,
  type ProcessEntry,
  type ProcessFolder,
  type ProcessOverview,
  type ProjectProcesses,
} from "../../shared/processes";
import { tidyCommand, type ProjectTask } from "../../shared/tasks";
import type { ProcessRow } from "../platform/processes";

export interface OverviewInput {
  rows: readonly ProcessRow[];
  /** Relay's main process and its agent hosts: where everything Relay runs starts. */
  relayPids: readonly number[];
  /** Relay's terminal shells. */
  terminals: ReadonlySet<number>;
  projects: readonly {
    id: string;
    name: string;
    root: string;
    worktrees: readonly { path: string; chatId: string }[];
    tasks: readonly (ProjectTask & { members: readonly number[] })[];
  }[];
  /** Which agent a command line runs, if it's one. */
  agentOf(line: string): AgentProvider | undefined;
  /** Where each agent CLI works, where the OS tells. */
  agentFolders: ReadonlyMap<number, string>;
  /** The thread and folder an agent CLI was seen running commands for. */
  agentWork(pid: number, started: number): { chatId?: string; root?: string } | undefined;
  /** CPU now, per process; undefined until it can tell. */
  cpuOf(row: ProcessRow): number | undefined;
  threads: ReadonlyMap<
    string,
    { title: string; settled: boolean; projectId: string }
  >;
  machine: ProcessOverview["machine"];
  platform: ProcessOverview["platform"];
  now: number;
}

const within = (path: string, root: string) =>
  path === root || path.startsWith(root + sep) || path.startsWith(root + "/");

export function buildOverview(input: OverviewInput): ProcessOverview {
  const { rows } = input;
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const children = new Map<number, ProcessRow[]>();
  for (const r of rows) {
    // pid 0 is its own parent on Windows.
    if (r.ppid === r.pid) continue;
    const list = children.get(r.ppid);
    if (list) list.push(r);
    else children.set(r.ppid, [r]);
  }
  const cost = (pids: Iterable<number>): ProcessCost =>
    addCosts(
      [...pids].flatMap((pid) => {
        const r = byPid.get(pid);
        if (!r) return [];
        const cpu = input.cpuOf(r);
        return [cpu === undefined ? { mb: r.mb ?? 0 } : { cpu, mb: r.mb ?? 0 }];
      }),
    );
  const thread = (id: string | undefined) => {
    const t = id ? input.threads.get(id) : undefined;
    return id && t ? { id, title: t.title } : undefined;
  };

  // Tasks first: what an agent left running counts as the task, not the agent.
  const claimed = new Set<number>();
  const taskEntries = new Map<string, ProcessEntry[]>();
  for (const project of input.projects)
    for (const task of project.tasks) {
      const members = task.members.filter((p) => byPid.has(p));
      for (const p of members) claimed.add(p);
      const settled = task.chatId
        ? input.threads.get(task.chatId)?.settled
        : false;
      const entry: ProcessEntry = {
        id: task.id,
        kind: "task",
        title: task.title,
        command: task.command,
        taskKind: task.kind,
        ...(task.agent ? { agent: task.agent } : {}),
        ...(thread(task.chatId) ? { thread: thread(task.chatId)! } : {}),
        started: task.started,
        ports: task.ports,
        processes: Math.max(members.length, 1),
        ...cost(members),
        ...(task.origin === "detached"
          ? { leftBehind: "starter-gone" as const }
          : settled
            ? { leftBehind: "settled" as const }
            : {}),
      };
      const key = `${project.id}\n${task.folder ?? project.root}`;
      taskEntries.set(key, [...(taskEntries.get(key) ?? []), entry]);
    }

  // Then everything under Relay, each subtree counted in the nearest agent
  // or, failing one, the child of Relay it hangs from.
  const roots = new Set(input.relayPids);
  const groups = new Map<number, number[]>();
  const queue: { pid: number; group: number }[] = [];
  for (const pid of roots) {
    if (!byPid.has(pid)) continue;
    groups.set(pid, [pid]);
    for (const c of children.get(pid) ?? [])
      if (!roots.has(c.pid)) queue.push({ pid: c.pid, group: c.pid });
  }
  while (queue.length) {
    const { pid, group: inherited } = queue.pop()!;
    if (claimed.has(pid)) continue;
    claimed.add(pid);
    const row = byPid.get(pid)!;
    const group = input.agentOf(row.line) ? pid : inherited;
    groups.set(group, [...(groups.get(group) ?? []), pid]);
    for (const c of children.get(pid) ?? [])
      if (!roots.has(c.pid)) queue.push({ pid: c.pid, group });
  }

  const folders = input.projects.flatMap((p) => [
    { projectId: p.id, path: p.root, chatId: undefined as string | undefined },
    ...p.worktrees.map((w) => ({ projectId: p.id, path: w.path, chatId: w.chatId })),
  ]);
  // The deepest folder wins: a worktree inside the checkout is its own.
  folders.sort((a, b) => b.path.length - a.path.length);
  const folderOf = (path: string | undefined) =>
    path ? folders.find((f) => within(path, f.path)) : undefined;
  /** Where a thread works: its worktree, or its project's checkout. */
  const threadFolder = (chatId: string | undefined) => {
    if (!chatId) return;
    const projectId = input.threads.get(chatId)?.projectId;
    return (
      folders.find((f) => f.chatId === chatId) ??
      folders.find((f) => f.projectId === projectId && !f.chatId)
    );
  };

  const relayEntries: ProcessEntry[] = [];
  const agentEntries = new Map<string, ProcessEntry[]>();
  const appGroups = new Map<string, number[]>();
  const helperGroups = new Map<string, { pids: number[]; line: string; started: number }>();
  for (const [group, pids] of groups) {
    const row = byPid.get(group)!;
    const agent = input.agentOf(row.line);
    if (agent) {
      const work = input.agentWork(row.pid, row.started);
      const named = tokenThread(row.line) ?? work?.chatId;
      const folder =
        folderOf(input.agentFolders.get(row.pid) ?? work?.root) ??
        threadFolder(named);
      const chatId = named ?? folder?.chatId;
      const entry: ProcessEntry = {
        id: `${row.pid}:${row.started}`,
        kind: "agent",
        title: agent,
        agent,
        ...(thread(chatId) ? { thread: thread(chatId)! } : {}),
        started: row.started,
        ports: [],
        processes: pids.length,
        ...cost(pids),
      };
      if (!folder) relayEntries.push(entry);
      else {
        const key = `${folder.projectId}\n${folder.path}`;
        agentEntries.set(key, [...(agentEntries.get(key) ?? []), entry]);
      }
      continue;
    }
    const app = appTitle(row, roots);
    if (app) {
      appGroups.set(app, [...(appGroups.get(app) ?? []), ...pids]);
      continue;
    }
    const title = input.terminals.has(group)
      ? "Terminal shells"
      : helperTitle(row.line);
    const known = helperGroups.get(title);
    if (known) {
      known.pids.push(...pids);
      known.started = Math.min(known.started, row.started);
    } else helperGroups.set(title, { pids: [...pids], line: row.line, started: row.started });
  }
  for (const [title, pids] of appGroups)
    relayEntries.push({
      id: `app:${title}`,
      kind: "app",
      title,
      started: Math.min(...pids.map((p) => byPid.get(p)?.started ?? input.now)),
      ports: [],
      processes: pids.length,
      ...cost(pids),
    });
  for (const [title, h] of helperGroups)
    relayEntries.push({
      id: `helper:${title}`,
      kind: "helper",
      title,
      command: tidyCommand(h.line),
      started: h.started,
      ports: [],
      processes: h.pids.length,
      ...cost(h.pids),
    });

  const projects: ProjectProcesses[] = input.projects.flatMap((p) => {
    const list: ProcessFolder[] = [
      { path: p.root, chatId: undefined as string | undefined },
      ...p.worktrees,
    ].flatMap((f): ProcessFolder[] => {
      const key = `${p.id}\n${f.path}`;
      const entries = byCost([
        ...(agentEntries.get(key) ?? []),
        ...(taskEntries.get(key) ?? []),
      ]);
      if (!entries.length) return [];
      return [
        {
          path: f.path,
          ...(thread(f.chatId) ? { thread: thread(f.chatId)! } : {}),
          entries,
          ...addCosts(entries),
        },
      ];
    });
    if (!list.length) return [];
    // The checkout first, then worktrees by what they cost.
    const checkout = list.filter((f) => f.path === p.root);
    const ordered = [
      ...checkout,
      ...byCost(list.filter((f) => f.path !== p.root)),
    ];
    return [{ projectId: p.id, name: p.name, folders: ordered, ...addCosts(ordered) }];
  });
  const relay = { entries: byCost(relayEntries), ...addCosts(relayEntries) };
  return {
    at: input.now,
    projects: byCost(projects),
    relay,
    total: addCosts([...projects, relay]),
    machine: input.machine,
    platform: input.platform,
  };
}

/** The costliest first: CPU, then memory. */
function byCost<T extends ProcessCost>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => (b.cpu ?? 0) - (a.cpu ?? 0) || b.mb - a.mb,
  );
}

const utilities: [RegExp, string][] = [
  [/network/i, "Network service"],
  [/audio/i, "Audio service"],
  [/storage/i, "Storage service"],
  [/video_capture|video-capture/i, "Camera service"],
  [/node\.mojom/i, "Workers"],
];

/** Relay's own Electron processes, named for what Chromium runs in them. */
function appTitle(row: ProcessRow, roots: ReadonlySet<number>) {
  if (/--relay-agent-host\b/.test(row.line)) return "Agent hosts";
  const type = /--type=([\w-]+)/.exec(row.line)?.[1];
  if (!type) return roots.has(row.pid) ? "Relay" : undefined;
  if (type === "renderer") return "Windows and pages";
  if (type === "gpu-process") return "GPU";
  if (type === "utility") {
    const sub = /--utility-sub-type=(\S+)/.exec(row.line)?.[1] ?? "";
    return utilities.find(([re]) => re.test(sub))?.[1] ?? "Utility processes";
  }
  if (type === "crashpad-handler") return "Crash reporter";
  return "Other Relay processes";
}

/**
 * The thread a hosted Claude works for: Relay's MCP token on its command
 * line starts with the thread's id (see relay-mcp's `relayToken`).
 */
function tokenThread(line: string) {
  return /"Bearer ([\w-]+)\.[\w-]+"/.exec(line)?.[1];
}

/** "Checks", "node server.js", "zsh": what a helper is, from its command line. */
function helperTitle(line: string) {
  if (/[/\\]relay-checks-[^/\\]+[/\\]worker\.mjs\b/.test(line)) return "Checks";
  // The PowerShell that reads the process table on Windows (platform/processes).
  if (/\bpowershell(?:\.exe)?"?\s.*-EncodedCommand\b/i.test(line))
    return "Process monitor";
  const [program, ...args] = tidyCommand(line).split(/\s+/);
  const subject = args.find((a) => !a.startsWith("-"));
  return [program, subject && /[/\\]/.test(subject) ? subject.split(/[/\\]/).pop() : subject]
    .filter(Boolean)
    .join(" ");
}
