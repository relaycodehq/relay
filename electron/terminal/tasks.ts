import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { sep } from "node:path";
import type { AgentProvider } from "../../shared/agents";
import {
  commandKey,
  describeTask,
  shellCommand,
  taskNote,
  lastingTask,
  tidyCommand,
  type ProjectTask,
} from "../../shared/tasks";
import {
  CpuRates,
  processTable,
  type ProcessRow,
} from "../platform/processes";
import { agentName, ignoredOrphans, runnable } from "./command-lines";
import { listeningPorts, workingFolders } from "./process-lookups";

type Proc = ProcessRow;
const windows = process.platform === "win32";

/** A thread's worktree, whose processes list with the project's. */
interface Worktree {
  path: string;
  chatId: string;
}

/** A shell an agent started, followed across reparenting until every process in it exits. */
interface Tracked {
  id: string;
  command: string;
  agent?: AgentProvider;
  origin: ProjectTask["origin"];
  root: number;
  started: number;
  chatId?: string;
  cwd?: string;
  /** The command line to run it again with, when it differs from `command`. */
  rerun?: string;
  /** Restarted from Relay, so it's listed straight away. */
  restarted?: boolean;
  /** Started from this terminal shell in Relay. */
  shell?: number;
  /** Where it runs when the OS can't say (Windows): the folder of the thread or terminal that started it. */
  hint?: string;
  /** A managed process keeps its own launch and lifecycle state when restarted. */
  restart?: (stop: () => Promise<void>) => Promise<void>;
  pids: Map<number, number>;
}

const within = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);

// Skip the agent's quick commands: the list is for things that keep running.
const minimumAge = 3000;

/**
 * Finds the shell commands Claude and Codex leave running, per project.
 * Uses `ps` for the process tree and `lsof` only for processes it hasn't placed yet.
 */
class ProjectTasks {
  private tracked = new Map<string, Tracked>();
  /** The agent hosts' pids: Claude runs there, not under Relay itself. */
  hosts: () => number[] = () => [];
  /** Every pid seen, keyed to its start time, so pid reuse never adopts a stranger. */
  private seen = new Map<number, number>();
  private cwds = new Map<string, string | null>();
  private commands = new Map<
    string,
    { chatId: string; key: string; at: number }[]
  >();
  /** What each agent session last heard about running processes. */
  private notes = new Map<string, ProjectTask[]>();
  /** Project folders Relay has asked about; processes elsewhere aren't followed. */
  private roots = new Set<string>();
  private scanning?: { costed: boolean; done: Promise<Proc[]> };
  private scanned = 0;
  private last: Proc[] = [];
  /** Relay's terminal shells, and the thread each belongs to. */
  private terminals = new Map<number, string | undefined>();
  /** Where each terminal shell started, for Windows, which can't tell. */
  private terminalFolders = new Map<number, string>();
  /** Whether the last scan read what each process costs. */
  private costed = false;
  private rates = new CpuRates();
  /** Shells Relay started to restart a task, adopted on the next scan. */
  private adopting = new Map<
    number,
    Omit<Tracked, "id" | "root" | "started" | "pids">
  >();

  /** An agent's command activity; lets the list say which chat started a process. */
  record(root: string, chatId: string, command: string) {
    this.watch(root);
    const list = this.commands.get(root) ?? [];
    list.push({ chatId, key: commandKey(command), at: Date.now() });
    this.commands.set(root, list.slice(-200));
  }

  /** What runs in this shell counts as the thread's; a draft's has no thread yet. */
  trackTerminal(pid: number, chatId: string | undefined, cwd?: string) {
    this.terminals.set(pid, chatId);
    if (cwd) this.terminalFolders.set(pid, cwd);
  }

  untrackTerminal(pid: number) {
    this.terminals.delete(pid);
    this.terminalFolders.delete(pid);
  }

  /** Dev commands Relay starts directly, outside an agent or terminal shell. */
  trackServer(
    pid: number,
    command: string,
    cwd: string,
    restart: NonNullable<Tracked["restart"]>,
  ) {
    this.adopting.set(pid, {
      command,
      cwd,
      origin: "relay",
      restarted: true,
      restart,
    });
    this.scanned = 0;
  }

  /** Processes in the project's checkout, and in the `worktrees` its threads work in. */
  async list(
    root: string,
    worktrees: Worktree[] = [],
    options: {
      fresh?: boolean;
      includeNewServers?: boolean;
      /** Read each process's CPU and memory too; see `costs`. */
      costed?: boolean;
    } = {},
  ): Promise<ProjectTask[]> {
    this.watch(root);
    for (const w of worktrees) this.watch(w.path);
    if (options.fresh || (options.costed && !this.costed)) this.scanned = 0;
    await this.scan(options.costed);
    const folders: { path: string; chatId?: string }[] = [
      { path: root },
      ...worktrees,
    ].sort((a, b) => b.path.length - a.path.length);
    const folder = (cwd?: string) =>
      cwd ? folders.find((f) => within(cwd, f.path)) : undefined;
    const now = Date.now();
    const tasks = [...this.tracked.values()].filter(
      (t) =>
        !!folder(t.cwd) &&
        (t.restarted ||
          now - t.started >= minimumAge ||
          options.includeNewServers),
    );
    const ports = await listeningPorts(
      tasks.flatMap((t) => [...t.pids.keys()]),
    );
    const cost = options.costed ? this.costs() : undefined;
    // An editor or pager open in a terminal isn't worth listing; servers are.
    return tasks
      .map((t) => {
        const listening = [
          ...new Set([...t.pids.keys()].flatMap((pid) => ports.get(pid) ?? [])),
        ].sort((a, b) => a - b);
        const worktree = folder(t.cwd);
        const chatId =
          t.shell && this.terminals.has(t.shell)
            ? this.terminals.get(t.shell)
            : t.chatId;
        return {
          id: t.id,
          command: t.command,
          ...describeTask(t.command, listening),
          ...(worktree?.chatId ? { worktree: worktree.chatId } : {}),
          ...(worktree ? { folder: worktree.path } : {}),
          ...(t.agent ? { agent: t.agent } : {}),
          origin: t.origin,
          ...(chatId ? { chatId } : {}),
          started: t.started,
          ports: listening,
          pids: t.pids.size,
          ...cost?.(t),
        };
      })
      .filter(
        (t) =>
          (t.origin !== "terminal" || lastingTask(t)) &&
          (now - t.started >= minimumAge ||
            t.ports.length > 0 ||
            this.tracked.get(t.id)?.restarted),
      )
      .sort((a, b) => a.started - b.started);
  }

  /** What a task's live processes cost in the last scan, CPU as a share of the whole computer. */
  private costs() {
    const rows = new Map(this.last.map((p) => [p.pid, p]));
    const cores = cpus().length || 1;
    return (t: Tracked) => {
      let cpu: number | undefined;
      let mb = 0;
      for (const [pid, started] of t.pids) {
        const row = rows.get(pid);
        if (row?.started !== started) continue;
        mb += row.mb ?? 0;
        if (row.cpu !== undefined) cpu = (cpu ?? 0) + row.cpu;
      }
      return {
        ...(cpu === undefined ? {} : { cpu: Math.min(100, cpu / cores) }),
        mb: Math.round(mb),
      };
    };
  }

  /** Stop every process in the task; force the ones still running after 3 seconds. */
  async stop(root: string, id: string, worktrees: Worktree[] = []) {
    void (await this.terminate(root, id, worktrees)).exited;
  }

  /** Stops everything running in a folder about to go away, and waits for it. */
  async stopWithin(path: string) {
    // A server started a moment ago would keep its port in the deleted folder.
    const tasks = await this.runningIn(path).catch(() => []);
    await Promise.all(
      tasks.map(
        async (t) =>
          (await this.terminate(path, t.id).catch(() => null))?.exited,
      ),
    );
  }

  /** Stop the task, wait for it to exit so its ports are free, then run its command again in the same folder. */
  async restart(root: string, id: string, worktrees: Worktree[] = []) {
    const current = await this.findTask(root, id, worktrees);
    if (current.origin === "terminal")
      throw new Error("Restart it from its terminal.");
    if (current.restart)
      return current.restart(async () => {
        const { exited } = await this.terminate(root, id, worktrees);
        await exited;
        if (this.tracked.has(id))
          throw new Error(
            "The dev server is still stopping. Try again shortly.",
          );
      });
    const { task, exited } = await this.terminate(root, id, worktrees);
    await exited;
    const options = {
      cwd: task.cwd ?? root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    } as const;
    // On Windows `rerun` is the shell's own command line, Git Bash's or
    // PowerShell's, which cmd starts as it is.
    const child = windows
      ? spawn(task.rerun ?? task.command, { ...options, shell: true })
      : spawn(
          process.env.SHELL || "/bin/sh",
          ["-lc", task.rerun ?? task.command],
          options,
        );
    // A folder deleted meanwhile fails the spawn asynchronously.
    child.on("error", () => {});
    child.unref();
    if (!child.pid) throw new Error("The process couldn't be started again.");
    // It still belongs to whoever started it: the Processes page would
    // otherwise offer to sweep it away with the tasks whose starter is gone.
    this.adopting.set(child.pid, {
      command: task.command,
      ...(task.agent ? { agent: task.agent } : {}),
      origin: task.origin,
      ...(task.chatId ? { chatId: task.chatId } : {}),
      cwd: task.cwd ?? root,
      ...(task.rerun ? { rerun: task.rerun } : {}),
      restarted: true,
    });
    this.scanned = 0;
  }

  private async findTask(root: string, id: string, worktrees: Worktree[]) {
    const tasks = await this.runningIn(root, worktrees);
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("This process is no longer running.");
    return task;
  }

  /**
   * Every task a fresh scan finds in `root` and the `worktrees`, without the
   * ones `list` leaves out for being too young or a terminal's passing job.
   */
  private async runningIn(root: string, worktrees: Worktree[] = []) {
    this.watch(root);
    for (const w of worktrees) this.watch(w.path);
    this.scanned = 0;
    await this.scan();
    const folders = [root, ...worktrees.map((w) => w.path)];
    return [...this.tracked.values()].filter((t) => {
      const cwd = t.cwd;
      return !!cwd && folders.some((folder) => within(cwd, folder));
    });
  }

  private async terminate(
    root: string,
    id: string,
    worktrees: Worktree[] = [],
  ) {
    const task = await this.findTask(root, id, worktrees);
    let alive = new Map(this.last.map((p) => [p.pid, p]));
    const members = [...task.pids].filter(
      ([pid, started]) => alive.get(pid)?.started === started,
    );
    const signal = (name: NodeJS.Signals) => {
      // A group led by one of the task's own processes also catches children the scan hasn't seen yet.
      for (const [pid, started] of members) {
        if (alive.get(pid)?.started !== started) continue;
        if (alive.get(pid)?.pgid === pid)
          try {
            process.kill(-pid, name);
          } catch {}
        try {
          process.kill(pid, name);
        } catch {}
      }
    };
    const running = async () => {
      this.scanned = 0;
      alive = new Map((await this.scan()).map((p) => [p.pid, p]));
      return members.some(
        ([pid, started]) => alive.get(pid)?.started === started,
      );
    };
    signal("SIGTERM");
    const exited = (async () => {
      for (let waited = 0; waited < 6000; waited += 500) {
        await new Promise((r) => setTimeout(r, 500));
        if (!(await running())) return;
        if (waited === 2500) signal("SIGKILL");
      }
    })();
    return { task, exited };
  }

  /**
   * A note for this session's next turn: the full list the first time, then
   * only changes. An agent in a worktree (`root`) first hears that it is one,
   * and what runs in the project's `checkout` instead.
   */
  async note(root: string, session: string, chatId: string, checkout?: string) {
    const tasks = await this.list(root).catch(() => null);
    if (!tasks) return;
    const lasting = tasks.filter(lastingTask);
    const heard = this.notes.get(session);
    this.notes.set(session, lasting);
    const worktree =
      checkout && !heard
        ? {
            path: root,
            checkout,
            running: (await this.list(checkout).catch(() => [])).filter(
              lastingTask,
            ),
          }
        : undefined;
    return taskNote(lasting, chatId, heard, worktree);
  }

  /** A new agent session knows nothing yet: it hears the whole list again. */
  forgetNote(session: string) {
    this.notes.delete(session);
  }

  private watch(root: string) {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    // Look at leftover processes again: some may belong to the new folder.
    for (const [pid, started] of this.seen)
      if (![...this.tracked.values()].some((t) => t.pids.get(pid) === started))
        this.seen.delete(pid);
    this.cwds.clear();
    this.scanned = 0;
  }

  private scan(asked = false): Promise<Proc[]> {
    // macOS's `ps` says what each process costs in every look.
    const costed = asked || process.platform === "darwin";
    if (Date.now() - this.scanned < 1500) return Promise.resolve(this.last);
    const under = this.scanning;
    if (under && (under.costed || !costed)) return under.done;
    // A plain scan under way can't say what each process costs: a costed
    // one follows it.
    const scanning = {
      costed,
      done: (under?.done.catch(() => {}) ?? Promise.resolve())
        .then(() => this.read(costed))
        .finally(() => {
          if (this.scanning === scanning) this.scanning = undefined;
          this.scanned = Date.now();
        }),
    };
    this.scanning = scanning;
    return scanning.done;
  }

  private async read(costed: boolean) {
    // One not in a table read after it was handed over is gone; its pid may be a stranger's next.
    const handedOver = new Map(this.adopting);
    const procs = await processTable({ usage: costed });
    if (costed) this.rates.fill(procs);
    this.costed = costed;
    this.last = procs;
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    const children = new Map<number, Proc[]>();
    for (const p of procs) {
      const list = children.get(p.ppid);
      if (list) list.push(p);
      else children.set(p.ppid, [p]);
    }
    const hosts = new Set(this.hosts());
    // An agent run from Relay's terminal is as external as one in any other.
    const ours = (p: Proc) => {
      for (
        let c: Proc | undefined = p, n = 0;
        c && n < 64;
        c = byPid.get(c.ppid), n++
      ) {
        if (this.terminals.has(c.pid)) return false;
        if (c.pid === process.pid || hosts.has(c.pid)) return true;
      }
      return false;
    };
    const fresh: number[] = [];
    const firstSight = (p: Proc) => {
      const known = this.seen.get(p.pid) === p.started;
      this.seen.set(p.pid, p.started);
      return !known;
    };
    // Agents' shells: a direct child of Claude or Codex that runs a command.
    for (const agent of procs) {
      const name = agentName(agent.line);
      if (!name) continue;
      for (const child of children.get(agent.pid) ?? []) {
        const id = `${child.pid}:${child.started}`;
        if (this.tracked.has(id) || agentName(child.line)) continue;
        const command = shellCommand(child.line);
        if (!command) continue;
        firstSight(child);
        const relay = ours(agent);
        const key = commandKey(command);
        const match = relay ? this.findChat(key, child.started) : undefined;
        this.tracked.set(id, {
          id,
          command,
          agent: name,
          origin: relay ? "relay" : "external",
          root: child.pid,
          started: child.started,
          ...(match ? { chatId: match.chatId, hint: match.root } : {}),
          // Run again as the agent's shell ran it.
          ...(windows ? { rerun: child.line } : {}),
          pids: new Map(),
        });
        fresh.push(child.pid);
      }
    }
    // What the user runs in a Relay terminal: each job the shell starts.
    for (const [shell, chatId] of this.terminals) {
      for (const child of children.get(shell) ?? []) {
        const id = `${child.pid}:${child.started}`;
        if (this.tracked.has(id) || agentName(child.line)) continue;
        firstSight(child);
        const hint = this.terminalFolders.get(shell);
        this.tracked.set(id, {
          id,
          command: tidyCommand(child.line),
          origin: "terminal",
          root: child.pid,
          started: child.started,
          shell,
          ...(chatId ? { chatId } : {}),
          ...(hint ? { hint } : {}),
          pids: new Map(),
        });
        fresh.push(child.pid);
      }
    }
    for (const [pid, task] of handedOver) {
      const p = byPid.get(pid);
      if (this.adopting.get(pid) === task) this.adopting.delete(pid);
      if (!p) continue;
      firstSight(p);
      fresh.push(p.pid);
      const id = `${p.pid}:${p.started}`;
      this.tracked.set(id, {
        ...task,
        id,
        root: p.pid,
        started: p.started,
        pids: new Map([[p.pid, p.started]]),
      });
    }
    const owner = this.followDescendants(byPid, children);
    // `nohup … &` and `(cmd &)` leave launchd as the parent before any scan
    // sees them. Windows doesn't hand orphans on, and can't say where one runs.
    for (const p of windows ? [] : procs) {
      if (p.ppid !== 1 || owner.has(p.pid) || !firstSight(p)) continue;
      if (ignoredOrphans.test(p.line) || agentName(p.line)) continue;
      const id = `${p.pid}:${p.started}`;
      this.tracked.set(id, {
        id,
        command: tidyCommand(p.line),
        rerun: runnable(p.line),
        origin: "detached",
        root: p.pid,
        started: p.started,
        pids: new Map([[p.pid, p.started]]),
      });
      fresh.push(p.pid);
    }
    await this.placeFolders(fresh);
    for (const task of this.tracked.values()) {
      const cwd = windows
        ? (task.cwd ?? task.hint)
        : this.cwds.get(`${task.root}:${task.started}`);
      if (
        cwd &&
        (task.origin === "relay" ||
          task.origin === "terminal" ||
          [...this.roots].some((r) => within(cwd, r)))
      )
        task.cwd = cwd;
      else if (cwd !== undefined) this.tracked.delete(task.id);
    }
    for (const [pid, started] of this.seen)
      if (byPid.get(pid)?.started !== started) this.seen.delete(pid);
    for (const key of this.cwds.keys())
      if (!this.seen.has(+key.split(":")[0])) this.cwds.delete(key);
    return procs;
  }

  /** Follows every task's descendants so a detached server stays in its task; the task each pid belongs to. */
  private followDescendants(
    byPid: Map<number, Proc>,
    children: Map<number, Proc[]>,
  ) {
    const owner = new Map<number, Tracked>();
    for (const task of this.tracked.values()) {
      for (const [pid, started] of task.pids)
        if (byPid.get(pid)?.started !== started) task.pids.delete(pid);
      const root = byPid.get(task.root);
      if (root?.started === task.started) task.pids.set(root.pid, root.started);
      const queue = [...task.pids.keys()];
      while (queue.length) {
        const pid = queue.pop()!;
        owner.set(pid, task);
        for (const child of children.get(pid) ?? [])
          if (!task.pids.has(child.pid) && !agentName(child.line)) {
            task.pids.set(child.pid, child.started);
            this.seen.set(child.pid, child.started);
            queue.push(child.pid);
          }
      }
      if (!task.pids.size) this.tracked.delete(task.id);
      else if (!task.pids.has(task.root) && task.origin !== "external")
        task.origin = "detached";
    }
    return owner;
  }

  private findChat(key: string, started: number) {
    let best: { chatId: string; at: number; root: string } | undefined;
    for (const [root, list] of this.commands)
      for (const c of list)
        if (
          (c.key === key || c.key.includes(key) || key.includes(c.key)) &&
          Math.abs(c.at - started) < 120000 &&
          (!best || Math.abs(c.at - started) < Math.abs(best.at - started))
        )
          best = { ...c, root };
    return best && { chatId: best.chatId, root: best.root };
  }

  /** Working folders decide the project. One look for everything not placed yet. */
  private async placeFolders(pids: number[]) {
    // Windows keeps a process's folder where only a debugger reads it; tasks
    // go by the thread that started them instead.
    if (windows) return;
    const pending = pids.filter((pid) => {
      const started = this.seen.get(pid);
      return !this.cwds.has(`${pid}:${started}`);
    });
    if (!pending.length) return;
    for (const [pid, folder] of await workingFolders(pending))
      this.cwds.set(`${pid}:${this.seen.get(pid)}`, folder);
  }
}

export const projectTasks = new ProjectTasks();
