import { useSyncExternalStore } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  draftTerminalKey,
  type TerminalEvent,
} from "../../../shared/terminals";
import type { AgentProvider } from "../../../shared/agents";
import { api } from "../../lib/api";
import { matches } from "../../lib/shortcuts";

export type TerminalStatus = "idle" | "starting" | "running" | "exited";

/**
 * A thread's terminal in this window. The xterm instance outlives the drawer:
 * switching threads detaches its element and keeps the screen as it was.
 */
export class ThreadTerminal {
  readonly term: Terminal;
  readonly element = document.createElement("div");
  status: TerminalStatus = "idle";
  cwd?: string;
  error?: string;
  /** Focus the terminal when the drawer next shows it. */
  focusOnShow = false;
  private fit = new FitAddon();
  private opened = false;
  /** Output that arrived while the shell was still being opened. */
  private early: string[] = [];
  private drawn = 0;
  private ackTimer?: number;
  private fitFrame?: number;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    public key: string,
    private projectId: string,
    public chatId: string | null,
  ) {
    this.element.className = "thread-terminal";
    this.term = new Terminal({
      fontFamily: currentFont.family || monoFont(),
      fontSize: currentFont.size,
      lineHeight: 1.2,
      scrollback: 5000,
      cursorBlink: true,
      allowProposedApi: false,
      theme: currentTheme,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(
      new WebLinksAddon((_event, uri) => void api.openExternal(uri)),
    );
    // The drawer's own shortcut toggles it rather than reaching the shell.
    this.term.attachCustomKeyEventHandler(
      (e) => !(e.type === "keydown" && matches("terminal", e)),
    );
    this.term.onData((data) => {
      if (this.status === "running")
        void api.writeTerminal(this.key, data).catch(() => {});
      else if (this.status === "exited" && data.includes("\r")) {
        this.term.write("\r\n");
        void this.start(true);
      }
    });
    this.term.onResize(({ cols, rows }) => {
      if (this.status === "running")
        void api.resizeTerminal(this.key, cols, rows).catch(() => {});
    });
  }

  /** Called once the element is in the drawer: draws, sizes, and starts the shell the first time. */
  show() {
    if (!this.opened) {
      this.term.open(this.element);
      this.opened = true;
    }
    this.fitNow();
    if (this.status === "idle" && !this.error) void this.start();
    if (this.focusOnShow) {
      this.focusOnShow = false;
      this.term.focus();
    }
  }

  /** Called when the drawer lets go of the element. */
  hide() {
    // Coming back lands where it left off. This also covers StrictMode, which
    // detaches right after the first show and would otherwise drop its focus.
    if (this.element.contains(document.activeElement)) this.focusOnShow = true;
    this.element.remove();
  }

  fitSoon() {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = undefined;
      this.fitNow();
    });
  }

  async start(fresh = false) {
    if (this.status === "starting") return;
    this.status = "starting";
    this.error = undefined;
    this.emit();
    try {
      const opened = await api.openTerminal(
        this.projectId,
        this.chatId,
        { cols: this.term.cols, rows: this.term.rows },
        fresh,
      );
      this.cwd = opened.cwd;
      if (opened.backlog) this.term.write(opened.backlog);
      this.status = "running";
      for (const data of this.early.splice(0)) this.output(data);
      if (opened.exitCode !== undefined) this.exited(opened.exitCode);
    } catch (e) {
      this.status = "idle";
      this.early = [];
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  /** Ends the shell and starts a new one in the same folder. */
  restart() {
    this.term.reset();
    void this.start(true);
  }

  receive(event: TerminalEvent) {
    if (event.data !== undefined) {
      if (this.status === "starting") this.early.push(event.data);
      else this.output(event.data);
    } else {
      this.exited(event.exitCode);
      this.emit();
    }
  }

  /** Settles once the shell runs: false if it failed to start or took too long. */
  running() {
    return new Promise<boolean>((resolve) => {
      const check = () => {
        if (this.status === "running") done(true);
        else if (this.error) done(false);
      };
      const done = (value: boolean) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const timer = window.setTimeout(() => done(false), 10_000);
      const unsubscribe = this.subscribe(check);
      check();
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.version;

  private output(data: string) {
    this.term.write(data, () => {
      // Tell the shell what's drawn in batches; it waits once too much isn't.
      this.drawn += data.length;
      this.ackTimer ??= window.setTimeout(() => {
        this.ackTimer = undefined;
        const bytes = this.drawn;
        this.drawn = 0;
        void api.ackTerminal(this.key, bytes).catch(() => {});
      }, 50);
    });
  }

  private exited(code: number) {
    if (this.status === "exited") return;
    this.status = "exited";
    const why =
      code === -1
        ? "Relay closed this shell"
        : code
          ? `Shell exited with code ${code}`
          : "Shell exited";
    this.term.write(
      `\r\n\x1b[2m[${why}. Press Enter to start a new one.]\x1b[0m\r\n`,
    );
  }

  setFont(family: string, size: number) {
    this.term.options.fontFamily = family;
    this.term.options.fontSize = size;
    this.fitNow();
  }

  private fitNow() {
    if (!this.opened || !this.element.isConnected) return;
    // A collapsed drawer measures zero; keep the last size instead.
    if (!this.element.clientWidth || !this.element.clientHeight) return;
    this.fit.fit();
  }

  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

const terminals = new Map<string, ThreadTerminal>();
const openKeys = new Set<string>();
const openListeners = new Set<() => void>();
let currentTheme: ITheme | undefined;
/** Set from the typography settings; an empty family reads --font-mono. */
let currentFont = { family: "", size: 12 };

api.onTerminal((event) => {
  const terminal = terminals.get(event.key);
  if (terminal) terminal.receive(event);
  // Nothing here draws it, so nothing should hold the shell back.
  else if (event.data !== undefined)
    void api.ackTerminal(event.key, event.data.length).catch(() => {});
});

export const terminalKey = (projectId: string, chatId: string | null) =>
  chatId ?? draftTerminalKey(projectId);

export function terminalFor(projectId: string, chatId: string | null) {
  const key = terminalKey(projectId, chatId);
  let terminal = terminals.get(key);
  if (!terminal) {
    terminal = new ThreadTerminal(key, projectId, chatId);
    terminals.set(key, terminal);
  }
  return terminal;
}

/**
 * Opens the thread's terminal with the agent's sign-in command typed at the
 * prompt, for the user to run. False when a command holds the shell.
 */
export function prefillSignIn(
  projectId: string,
  chatId: string,
  provider: AgentProvider,
) {
  return typeAtPrompt(projectId, chatId, (key) =>
    api.prefillSignIn(key, provider),
  );
}

/**
 * Opens the thread's terminal with `command` typed at the prompt, for the
 * user to look over and run. False when a command holds the shell, or the
 * shell can't take a command of several lines without running each.
 */
export function prefillCommand(
  projectId: string,
  chatId: string,
  command: string,
) {
  return typeAtPrompt(projectId, chatId, (key) =>
    api.prefillTerminal(key, command),
  );
}

async function typeAtPrompt(
  projectId: string,
  chatId: string,
  type: (key: string) => Promise<boolean>,
) {
  const terminal = terminalFor(projectId, chatId);
  terminal.focusOnShow = true;
  setTerminalOpen(terminal.key, true);
  if (!(await terminal.running())) return false;
  const typed = await type(terminal.key).catch(() => false);
  terminal.term.focus();
  return typed;
}

/** The draft's terminal becomes the new thread's, open or not. */
export function adoptDraftTerminal(projectId: string, chatId: string) {
  const from = draftTerminalKey(projectId);
  const terminal = terminals.get(from);
  if (!terminal || terminals.has(chatId)) return;
  terminals.delete(from);
  terminal.key = chatId;
  terminal.chatId = chatId;
  terminals.set(chatId, terminal);
  if (openKeys.delete(from)) openKeys.add(chatId);
  emitOpen();
  void api.adoptTerminal(projectId, chatId).catch(() => {});
}

export function setTerminalOpen(key: string, open: boolean) {
  if (open === openKeys.has(key)) return;
  if (open) openKeys.add(key);
  else openKeys.delete(key);
  emitOpen();
}

/** Whether the thread's terminal drawer is open; each thread remembers its own. */
export function useTerminalOpen(key: string) {
  return useSyncExternalStore(
    (listener) => {
      openListeners.add(listener);
      return () => void openListeners.delete(listener);
    },
    () => openKeys.has(key),
  );
}

function emitOpen() {
  for (const listener of openListeners) listener();
}

export function setTerminalFont(family: string, size: number) {
  currentFont = { family, size };
  for (const terminal of terminals.values()) terminal.setFont(family, size);
}

export function setTerminalTheme(theme: ITheme) {
  currentTheme = theme;
  for (const terminal of terminals.values())
    terminal.term.options.theme = theme;
}

function monoFont() {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono")
      .trim() || "Menlo, monospace"
  );
}
