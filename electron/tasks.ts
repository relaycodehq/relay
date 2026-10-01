import { execFile, spawn } from "node:child_process";
import { readlink } from "node:fs/promises";
import { sep } from "node:path";
import { agentProviders, type AgentProvider } from "../shared/agents";
import {
  commandKey,
  describeTask,
  shellCommand,
  taskNote,
  lastingTask,
  tidyCommand,
  type ProjectTask,
} from "../shared/tasks";

interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  started: number;
  line: string;
}
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
  pids: Map<number, number>;
}

function run(file: string, args: string[]) {
  return new Promise<string>((resolve) => {
    // `lstart` is printed in the user's locale otherwise.
    execFile(
      file,
      args,
      {
        maxBuffer: 16 << 20,
        timeout: 5000,
        env: { ...process.env, LC_ALL: "C" },
      },
      (_e, out) => resolve(out ?? ""),
    );
  });
}
/** Linux marks the working folder of a process whose folder was deleted with a suffix. */
export const liveCwd = (link: string) => link.replace(/ \(deleted\)$/, "");
const within = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);
const agentName = (line: string) => {
  const [bin, arg] = line.split(/\s+/);
  const name = (/[^/]+$/.exec(bin ?? "")?.[0] ?? "").replace(/\.exe$/, "");
  // Each agent's CLI is named after it; Codex may also run as a Node script.
  if (agentProviders.some((p) => p === name)) return name as AgentProvider;
  if (name === "node" && /\/codex(\.js)?$/.test(arg ?? ""))
    return "codex" as const;
};
// Processes that are only incidentally in a project folder: installed apps, system daemons,
// Git's own helpers and other editors' agents.
const ignoredOrphans =
  /^(\/System\/|\/Applications\/|\/Users\/[^/]+\/Applications\/|\/usr\/libexec\/|\/usr\/sbin\/|\/sbin\/|\/Library\/)|\bgit fsmonitor--daemon\b|\bwatchman\b|\bgitstatusd\b|\bcursor-agent\b|--relay-agent-host\b/;
// Skip the agent's quick commands: the list is for things that keep running.
const minimumAge = 3000;
/** A process's command line as something a shell can run: `ps` loses the quoting of an executable path with spaces. */
const runnable = (line: string) =>
  shellCommand(line) ??
  line.replace(/^(\/.*?)(?= -| \/|$)/, (path) =>
    path.includes(" ") ? `'${path.replaceAll("'", `'\\''`)}'` : path,
  );

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
  private scanning?: Promise<Proc[]>;
  private scanned = 0;
  private last: Proc[] = [];
  /** Relay's terminal shells, and the thread each belongs to. */
  private terminals = new Map<number, string | undefined>();
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
  trackTerminal(pid: number, chatId: string | undefined) {
    this.terminals.set(pid, chatId);
  }
  untrackTerminal(pid: number) {
    this.terminals.delete(pid);
  }

  /** Processes in the project's checkout, and in the `worktrees` its threads work in. */
  async list(root: string, worktrees: Worktree[] = []): Promise<ProjectTask[]> {
    if (process.platform === "win32") return [];
    this.watch(root);
    for (const w of worktrees) this.watch(w.path);
    await this.scan();
    const folders: { path: string; chatId?: string }[] = [
      { path: root },
      ...worktrees,
    ];
    const folder = (cwd?: string) =>
      cwd ? folders.find((f) => within(cwd, f.path)) : undefined;
    const now = Date.now();
    const tasks = [...this.tracked.values()].filter(
      (t) => !!folder(t.cwd) && (t.restarted || now - t.started >= minimumAge),
    );
    const ports = await this.ports(tasks.flatMap((t) => [...t.pids.keys()]));
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
          ...(t.agent ? { agent: t.agent } : {}),
          origin: t.origin,
          ...(chatId ? { chatId } : {}),
          started: t.started,
          ports: listening,
          pids: t.pids.size,
        };
      })
      .filter((t) => t.origin !== "terminal" || lastingTask(t))
      .sort((a, b) => a.started - b.started);
  }

  /** Stop every process in the task; force the ones still running after 3 seconds. */
  async stop(root: string, id: string, worktrees: Worktree[] = []) {
    void (await this.terminate(root, id, worktrees)).exited;
  }
  /** Stops everything running in a folder about to go away, and waits for it. */
  async stopWithin(path: string) {
    const tasks = await this.list(path).catch(() => []);
    await Promise.all(
      tasks.map(
        async (t) =>
          (await this.terminate(path, t.id).catch(() => null))?.exited,
      ),
    );
  }

  /** Stop the task, wait for it to exit so its ports are free, then run its command again in the same folder. */
  async restart(root: string, id: string, worktrees: Worktree[] = []) {
    if (this.tracked.get(id)?.origin === "terminal")
      throw new Error("Restart it from its terminal.");
    const { task, exited } = await this.terminate(root, id, worktrees);
    await exited;
    const child = spawn(
      process.env.SHELL || "/bin/sh",
      ["-lc", task.rerun ?? task.command],
      {
        cwd: task.cwd ?? root,
        detached: true,
        stdio: "ignore",
      },
    );
    // A folder deleted meanwhile fails the spawn asynchronously.
    child.on("error", () => {});
    child.unref();
    if (!child.pid) throw new Error("The process couldn't be started again.");
    this.adopting.set(child.pid, {
      command: task.command,
      ...(task.agent ? { agent: task.agent } : {}),
      origin: "detached",
      ...(task.chatId ? { chatId: task.chatId } : {}),
      cwd: task.cwd ?? root,
      ...(task.rerun ? { rerun: task.rerun } : {}),
      restarted: true,
    });
    this.scanned = 0;
  }

  private async terminate(
    root: string,
    id: string,
    worktrees: Worktree[] = [],
  ) {
    const tasks = await this.list(root, worktrees);
    const task = this.tracked.get(id);
    if (!task || !tasks.some((t) => t.id === id))
      throw new Error("This process is no longer running.");
    const alive = new Map(this.last.map((p) => [p.pid, p]));
    const members = [...task.pids].filter(
      ([pid, started]) => alive.get(pid)?.started === started,
    );
    const signal = (name: NodeJS.Signals) => {
      // A group led by one of the task's own processes also catches children the scan hasn't seen yet.
      for (const [pid] of members) {
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
      const now = new Map((await this.scan()).map((p) => [p.pid, p]));
      return members.some(
        ([pid, started]) => now.get(pid)?.started === started,
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

  private scan() {
    if (Date.now() - this.scanned < 1500) return Promise.resolve(this.last);
    this.scanning ??= this.read().finally(() => {
      this.scanning = undefined;
      this.scanned = Date.now();
    });
    return this.scanning;
  }

  private async read() {
    const out = await run("ps", [
      "-axww",
      "-o",
      "pid=,ppid=,pgid=,lstart=,command=",
    ]);
    const procs: Proc[] = [];
    for (const row of out.split("\n")) {
      const m =
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$/.exec(
          row,
        );
      if (m)
        procs.push({
          pid: +m[1],
          ppid: +m[2],
          pgid: +m[3],
          started: Date.parse(m[4]) || 0,
          line: m[5],
        });
    }
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
          ...(match ? { chatId: match } : {}),
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
        this.tracked.set(id, {
          id,
          command: tidyCommand(child.line),
          origin: "terminal",
          root: child.pid,
          started: child.started,
          shell,
          ...(chatId ? { chatId } : {}),
          pids: new Map(),
        });
        fresh.push(child.pid);
      }
    }
    // Follow every task's descendants so a detached server stays in its task.
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
    for (const [pid, task] of this.adopting) {
      const p = byPid.get(pid);
      if (!p) continue;
      this.adopting.delete(pid);
      firstSight(p);
      const id = `${p.pid}:${p.started}`;
      this.tracked.set(id, {
        ...task,
        id,
        root: p.pid,
        started: p.started,
        pids: new Map([[p.pid, p.started]]),
      });
    }
    // `nohup … &` and `(cmd &)` leave launchd as the parent before any scan sees them.
    for (const p of procs) {
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
      const cwd = this.cwds.get(`${task.root}:${task.started}`);
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

  private findChat(key: string, started: number) {
    let best: { chatId: string; at: number } | undefined;
    for (const list of this.commands.values())
      for (const c of list)
        if (
          (c.key === key || c.key.includes(key) || key.includes(c.key)) &&
          Math.abs(c.at - started) < 120000 &&
          (!best || Math.abs(c.at - started) < Math.abs(best.at - started))
        )
          best = c;
    return best?.chatId;
  }

  /** Working folders decide the project. One `lsof` call for everything not placed yet. */
  private async placeFolders(pids: number[]) {
    const pending = pids.filter((pid) => {
      const started = this.seen.get(pid);
      return !this.cwds.has(`${pid}:${started}`);
    });
    if (!pending.length) return;
    if (process.platform === "linux") {
      await Promise.all(
        pending.map(async (pid) =>
          this.cwds.set(
            `${pid}:${this.seen.get(pid)}`,
            await readlink(`/proc/${pid}/cwd`).then(liveCwd, () => null),
          ),
        ),
      );
      return;
    }
    const out = await run("lsof", [
      "-a",
      "-d",
      "cwd",
      "-Fn",
      "-p",
      pending.join(","),
    ]);
    const found = new Map<number, string>();
    let pid = 0;
    for (const line of out.split("\n"))
      if (line[0] === "p") pid = +line.slice(1);
      else if (line[0] === "n" && pid) found.set(pid, line.slice(1));
    for (const pid of pending)
      this.cwds.set(`${pid}:${this.seen.get(pid)}`, found.get(pid) ?? null);
  }

  private async ports(pids: number[]) {
    const ports = new Map<number, number[]>();
    if (!pids.length) return ports;
    const out = await run("lsof", [
      "-nP",
      "-a",
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fn",
      "-p",
      pids.join(","),
    ]);
    let pid = 0;
    for (const line of out.split("\n"))
      if (line[0] === "p") pid = +line.slice(1);
      else if (line[0] === "n" && pid) {
        const port = Number(/:(\d+)$/.exec(line)?.[1]);
        if (port) ports.set(pid, [...(ports.get(pid) ?? []), port]);
      }
    return ports;
  }
}

export const projectTasks = new ProjectTasks();
