// The agent host keeps Claude sessions running while Relay itself restarts.
// It speaks newline-delimited JSON over a local socket, one client at a time.
import type { Socket } from "node:net";

/**
 * Bumped when either side can no longer read what the other sends. Additions
 * that an older host ignores (process sessions, turn labels) don't bump it.
 */
export const protocolVersion = 1;

/** Where a host can be found; written by the host once it listens. */
export interface HostRecord {
  pid: number;
  socket: string;
  token: string;
  /** Hash of the host's own code: new sessions go to a host of the current one. */
  version: string;
  protocol: number;
  started: number;
}

/** What a session's log holds, in the order the host saw it. */
export type LogEntry =
  | { kind: "frame"; message: unknown }
  | { kind: "hook"; event: string; input: unknown }
  /** A process session's output line, and what Relay wrote to it. */
  | { kind: "line"; text: string }
  | { kind: "input"; text: string }
  /**
   * Turn boundaries the client marks; `at` is the first seq of the turn, or
   * the first after it. `turn` names one of several turns a shared process
   * runs; unnamed, the turn is the session's own.
   */
  | { kind: "mark"; mark: "start" | "end"; at: number; turn?: string }
  | { kind: "end"; failure?: string };
export type Entry = LogEntry & { seq: number };

/** How the host answers a hook: record it in the log, or ask the client within `timeout`. */
export type HookMode = "record" | { ask: true; timeout: number };

export interface SessionInfo {
  id: string;
  key: string;
  /** Missing from hosts that only ran Claude. */
  kind?: "claude" | "process";
  /** Whatever the client stored when it opened the session. */
  meta: unknown;
  threadId?: string;
  /** Entries before `split` only restore state; from it on they're a turn still to show. */
  split: number;
  /** A turn the client marked as started and never as ended. */
  open: boolean;
  /** Its process or query is gone; the log is all that's left of it. */
  ended?: boolean;
  /** Named turns started and never ended, with where each began. */
  turns?: Record<string, number>;
}

/** A command the host runs for Relay, e.g. an agent's app server. */
export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Its own process group, so stopping it stops what it started. */
  group: boolean;
  /** Closing its input is how it's asked to stop, not SIGTERM; it may wind down first. */
  stopByInput?: boolean;
}

export type ClientMessage =
  | { t: "hello"; token: string; protocol: number }
  | {
      t: "open";
      session: string;
      key: string;
      meta: unknown;
      options: Record<string, unknown>;
      hooks: Record<string, HookMode>;
      /** Ask the client before every tool use. */
      canUseTool: boolean;
      /** Run this instead of Claude: its lines are the log, pushes its input. */
      process?: ProcessSpec;
    }
  | { t: "attach"; session: string }
  | { t: "push"; session: string; message: unknown }
  | {
      t: "mark";
      session: string;
      mark: "start" | "end";
      at?: number;
      turn?: string;
    }
  /** Replaces what the session keeps for the next Relay to read. */
  | { t: "meta"; session: string; meta: unknown }
  | { t: "call"; id: number; session: string; method: string; args: unknown[] }
  | { t: "answer"; id: number; value?: unknown; error?: string }
  | { t: "abort"; session: string }
  | { t: "close"; session: string }
  /** Take no new sessions; exit once the last one closes. */
  | { t: "drain" };

export type HostMessage =
  | { t: "welcome"; version: string; pid: number; sessions: SessionInfo[] }
  | { t: "entry"; session: string; entry: Entry }
  /** Everything logged so far was sent; what follows is live. */
  | { t: "attached"; session: string }
  | { t: "return"; id: number; value?: unknown; error?: string }
  | {
      t: "ask";
      id: number;
      session: string;
      name: "canUseTool" | "hook";
      args: unknown[];
    }
  | { t: "cancel"; id: number }
  | { t: "refused"; error: string };

/** Frames the log also carries, typed as SDK messages so the session reads them in order. */
export type HookFrame = { type: "relay_hook"; event: string; input: unknown };

/** Calls the host passes on to the running query; anything else is refused. */
export const queryMethods = [
  "interrupt",
  "setModel",
  "setPermissionMode",
  "applyFlagSettings",
  "getSettings",
  "getContextUsage",
  "accountInfo",
  "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET",
  "askSideQuestion",
  "stopTask",
  "supportedCommands",
  "supportedModels",
  "supportedAgents",
] as const;

/** Reads newline-delimited JSON off a socket; a line that doesn't parse ends the connection. */
export function readLines(socket: Socket, onMessage: (message: any) => void) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      onMessage(message);
    }
  });
}

export function writeLine(socket: Socket, message: unknown) {
  if (!socket.destroyed) socket.write(JSON.stringify(message) + "\n");
}
