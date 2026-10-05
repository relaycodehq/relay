import { basename, join, sep } from "node:path";
import type * as NodePty from "node-pty";
import type { TerminalEvent, TerminalOpened } from "../../shared/terminals";
import { inheritedEnv, userShell } from "./env";
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
  /** The shell's own name, to tell its prompt from a command running in it. */
  shell: string;
  lastOutput: number;
  /** The shell asked for pasted text to come wrapped, so newlines in it don't run. */
  bracketedPaste: boolean;
  /** The end of the last output, in case the mode switch was split across two. */
  outputTail: string;
}

/**
 * One shell per thread, keyed by chat id (`draft:<projectId>` before the
 * thread exists). Shells outlive the window's view of them: switching threads
 * or reloading the window leaves them running.
 */
class ThreadTerminals {
  private sessions = new Map<string, Session>();
  private attached = false;
  private send: (event: TerminalEvent) => void = () => {};

  connect(send: (event: TerminalEvent) => void) {
    this.send = send;
  }

  /**
   * Attaches to the key's shell, starting one in `cwd` with `extraEnv` if
   * there's none or `fresh` asks for a new one.
   */
  open(
    key: string,
    cwd: string,
    cols: number,
    rows: number,
    fresh = false,
    extraEnv: Record<string, string> = {},
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
    const [file, args] = userShell();
    const env: Record<string, string> = {
      ...inheritedEnv(),
      ...extraEnv,
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
      shell: basename(file).toLowerCase(),
      lastOutput: Date.now(),
      bracketedPaste: false,
      outputTail: "",
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

  /**
   * Types `text` at the shell's prompt without running it. False when a
   * command holds the shell, which would read the text instead, or when the
   * text has several lines and the shell can't take them as one paste: each
   * newline would run the line before it.
   */
  async prefill(key: string, text: string) {
    const session = this.sessions.get(key);
    if (!session) return false;
    // A shell that just started may still be printing its prompt; typing
    // before it's ready lands ahead of it. Wait for it to go quiet, and for
    // zsh, whose startup can pause longer than that, until its line editor
    // has switched bracketed paste on, which it does at every prompt.
    const deadline = Date.now() + 5000;
    const ready = () =>
      Date.now() - session.lastOutput >= 300 &&
      (session.shell !== "zsh" || session.bracketedPaste);
    while (!ready() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.sessions.get(key) !== session || session.exitCode !== undefined)
      return false;
    // Linux reports the foreground program by its path ("/bin/bash"), macOS
    // by its name; a login shell's starts with "-".
    if (
      process.platform !== "win32" &&
      basename(session.pty.process).replace(/^-/, "").toLowerCase() !==
        session.shell
    )
      return false;
    // Nothing in it may act as a key or end the paste early.
    const typed = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
    if (!typed.trim()) return false;
    if (typed.includes("\n") && !session.bracketedPaste) return false;
    // A paste the way a terminal sends one: Return for newlines, and wrapped
    // so the shell reads it as text rather than keys to act on.
    const input = session.bracketedPaste
      ? `\x1b[200~${typed.replace(/\n/g, "\r")}\x1b[201~`
      : typed.replace(/\t/g, " ");
    // Ctrl+U first clears whatever was half-typed at the prompt.
    session.pty.write(process.platform === "win32" ? input : `\x15${input}`);
    return true;
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

  /** A shell is still open in the folder. */
  openWithin(path: string) {
    return [...this.sessions.values()].some(
      (session) =>
        session.exitCode === undefined &&
        (session.cwd === path || session.cwd.startsWith(path + sep)),
    );
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
    session.lastOutput = Date.now();
    const seen = session.outputTail + data;
    const on = seen.lastIndexOf("\x1b[?2004h"),
      off = seen.lastIndexOf("\x1b[?2004l");
    if (on !== off) session.bracketedPaste = on > off;
    session.outputTail = seen.slice(-7);
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

  /** `notify` tells the window the shell is gone. */
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

const chatOf = (key: string) => (key.startsWith("draft:") ? undefined : key);

export const threadTerminals = new ThreadTerminals();
