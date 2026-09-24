import { join, sep } from "node:path";
import type * as NodePty from "node-pty";
import type { TerminalEvent, TerminalOpened } from "../shared/terminals";
import { projectTasks } from "./tasks";

// node-pty ships native binaries, so it's copied next to main.cjs instead of
// being bundled (see scripts/build-electron.mjs).
let pty: typeof NodePty | undefined;
const loadPty = (): typeof NodePty =>
  (pty ??= require(join(__dirname, "node-pty")));

/** Output kept per shell, replayed when a reloaded window attaches again. */
const backlogLimit = 512 * 1024;
/** Output the window hasn't drawn yet; above `pauseAt` the shell waits for it. */
const pauseAt = 1024 * 1024,
  resumeAt = 256 * 1024;

interface Session {
  key: string;
  cwd: string;
  pty: NodePty.IPty;
  backlog: string[];
  backlogSize: number;
  trimmed: boolean;
  pending: string;
  flush?: NodeJS.Timeout;
  unacked: number;
  paused: boolean;
  exitCode?: number;
}

function shell(): [string, string[]] {
  if (process.platform === "win32") return ["powershell.exe", ["-NoLogo"]];
  const fallback = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  // A login shell reads the profile that sets PATH; apps started from the
  // Dock or a launcher get a bare one.
  return [process.env.SHELL || fallback, ["-l"]];
}

/**
 * One shell per thread, keyed by chat id (`draft:<projectId>` before the
 * thread exists). Shells outlive the window's view of them: switching threads
 * or reloading the window leaves them running.
 */
export class ThreadTerminals {
  private sessions = new Map<string, Session>();
  private attached = false;
  private send: (event: TerminalEvent) => void = () => {};

  connect(send: (event: TerminalEvent) => void) {
    this.send = send;
  }

  /** Attaches to the key's shell, starting one in `cwd` if there's none or `fresh` asks for a new one. */
  open(
    key: string,
    cwd: string,
    cols: number,
    rows: number,
    fresh = false,
  ): TerminalOpened {
    this.attached = true;
    let session = this.sessions.get(key);
    if (session && (fresh || session.cwd !== cwd)) {
      this.kill(session);
      session = undefined;
    }
    if (session) {
      // The backlog already holds what was waiting to be sent.
      clearTimeout(session.flush);
      session.flush = undefined;
      session.pending = "";
      session.unacked = 0;
      this.resume(session);
      if (session.exitCode === undefined) session.pty.resize(cols, rows);
      const backlog = session.backlog.join("");
      return {
        cwd: session.cwd,
        // Trimmed output may start mid-sequence; start at a line instead.
        backlog: session.trimmed
          ? backlog.slice(backlog.indexOf("\n") + 1)
          : backlog,
        ...(session.exitCode !== undefined
          ? { exitCode: session.exitCode }
          : {}),
      };
    }
    const [file, args] = shell();
    const env: Record<string, string> = {
      ...inherited(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "Relay",
    };
    // Apps started from Finder have no locale; shells then mangle UTF-8.
    if (process.platform !== "win32" && !env.LANG) env.LANG = "en_US.UTF-8";
    const proc = loadPty().spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });
    const created: Session = {
      key,
      cwd,
      pty: proc,
      backlog: [],
      backlogSize: 0,
      trimmed: false,
      pending: "",
      unacked: 0,
      paused: false,
    };
    this.sessions.set(key, created);
    projectTasks.trackTerminal(proc.pid, chatOf(key));
    proc.onData((data) => this.output(created, data));
    proc.onExit(({ exitCode }) => {
      projectTasks.untrackTerminal(proc.pid);
      if (this.sessions.get(created.key) !== created) return;
      this.drain(created);
      created.exitCode = exitCode;
      this.send({ key: created.key, exitCode });
    });
    return { cwd, backlog: "" };
  }

  write(key: string, data: string) {
    const session = this.sessions.get(key);
    if (session && session.exitCode === undefined) session.pty.write(data);
  }

  resize(key: string, cols: number, rows: number) {
    const session = this.sessions.get(key);
    if (session && session.exitCode === undefined)
      session.pty.resize(cols, rows);
  }

  /** The window drew `bytes` of output. */
  ack(key: string, bytes: number) {
    const session = this.sessions.get(key);
    if (!session) return;
    session.unacked = Math.max(0, session.unacked - bytes);
    if (session.paused && session.unacked < resumeAt) this.resume(session);
  }

  close(key: string) {
    const session = this.sessions.get(key);
    if (session) this.kill(session);
  }

  /** A draft's shell carries over to the thread its first message started. */
  adopt(from: string, to: string) {
    const session = this.sessions.get(from);
    if (!session || this.sessions.has(to)) return;
    this.sessions.delete(from);
    session.key = to;
    this.sessions.set(to, session);
    if (session.exitCode === undefined)
      projectTasks.trackTerminal(session.pty.pid, chatOf(to));
  }

  /** Ends the shells working in a folder about to go away. */
  closeWithin(path: string) {
    for (const session of this.sessions.values())
      if (session.cwd === path || session.cwd.startsWith(path + sep))
        this.kill(session, true);
  }

  /** The window reloaded: nothing draws output until it opens a terminal again. */
  detach() {
    this.attached = false;
    for (const session of this.sessions.values()) {
      session.unacked = 0;
      this.resume(session);
    }
  }

  closeAll() {
    for (const session of this.sessions.values()) this.kill(session);
  }

  private output(session: Session, data: string) {
    session.backlog.push(data);
    session.backlogSize += data.length;
    while (session.backlogSize > backlogLimit && session.backlog.length > 1) {
      session.backlogSize -= session.backlog.shift()!.length;
      session.trimmed = true;
    }
    if (!this.attached) return;
    // A busy shell writes in small pieces; one message per few milliseconds is plenty.
    session.pending += data;
    session.flush ??= setTimeout(() => this.drain(session), 4);
  }

  private drain(session: Session) {
    clearTimeout(session.flush);
    session.flush = undefined;
    if (!session.pending) return;
    const data = session.pending;
    session.pending = "";
    session.unacked += data.length;
    this.send({ key: session.key, data });
    if (!session.paused && session.unacked > pauseAt) {
      session.paused = true;
      session.pty.pause();
    }
  }

  private resume(session: Session) {
    if (!session.paused) return;
    session.paused = false;
    session.pty.resume();
  }

  /** `notify` tells the window, which otherwise closed the shell itself. */
  private kill(session: Session, notify = false) {
    clearTimeout(session.flush);
    this.sessions.delete(session.key);
    if (session.exitCode !== undefined) return;
    projectTasks.untrackTerminal(session.pty.pid);
    try {
      session.pty.kill();
    } catch {}
    if (notify) this.send({ key: session.key, exitCode: -1 });
  }
}

/**
 * Relay's own environment minus what only concerns Relay: started through
 * `npm run`, it carries npm's settings (nvm refuses to load with them) and
 * RELAY_DEV_URL, which would point a Relay run from the terminal at this
 * window's renderer.
 */
function inherited() {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (
      value !== undefined &&
      !/^(npm_|RELAY_|ELECTRON_)/i.test(name) &&
      name !== "INIT_CWD"
    )
      env[name] = value;
  return env;
}

const chatOf = (key: string) => (key.startsWith("draft:") ? undefined : key);

export const threadTerminals = new ThreadTerminals();
