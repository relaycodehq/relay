import type { AgentProvider } from "../agents";
import { isImagePath } from "../answer-images";
import type { TurnModel } from "../turn-model";
import type { WatchNote } from "../watch";

/** How full the provider session's context window was after this answer. */
export interface ContextUsage {
  usedTokens: number;
  maxTokens?: number;
  /** Tokens processed across the whole session, when the provider reports it. */
  totalTokens?: number;
  /** When the newest request last touched the provider's prompt cache. */
  cache?: PromptCache;
}
/** Each cache hit restarts the entry's lifetime, so it goes cold `ttlMs` after `at`. */
export interface PromptCache {
  at: number;
  ttlMs: number;
}
/** Local marker: the outgoing agent wrote this note for the one taking over. */
interface AgentHandoff {
  from: AgentProvider;
  to: AgentProvider;
  /** The note is for another computer, where `to` carries on. */
  computer?: string;
}
/** What a reloaded session's agent loaded that its old process hadn't, and what it no longer has. */
export interface NameChanges {
  added: string[];
  removed: string[];
}
/** Local marker: the agent's process was restarted on the same session. Each list is left out when the agent couldn't say. */
export interface SessionReload {
  skills?: NameChanges;
  agents?: NameChanges;
}
/** Local marker: a project's worktree command ran in the thread's worktree. */
export interface WorktreeCommandRun {
  /** Setup runs before a new worktree's first turn; teardown before Relay removes it. */
  kind: "setup" | "teardown";
  command: string;
  /** The tail of what it printed, stdout and stderr together. */
  output: string;
  /** Ignored files `.worktreeinclude` copied in, for setup. */
  copied?: string[];
  exitCode?: number;
  /** It ended without exiting by itself. */
  stopped?: "timeout" | "cancelled";
}
export interface ChatMessage {
  /** Local marker: this answer compacted the provider session instead of replying. */
  compaction?: boolean;
  /** Local: what a compaction left the agent with, when the provider hands it back readable. */
  compactSummary?: string;
  handoff?: AgentHandoff;
  reload?: SessionReload;
  worktreeCommand?: WorktreeCommandRun;
  /** Local marker: the lead's brief for an Ultraplan council, shown inside it. */
  brief?: boolean;
  /** Local marker: the agent started this turn itself, e.g. when a background task ended. */
  unprompted?: boolean;
  context?: ContextUsage;
  /** Local: dollars this answer cost, as its agent priced it. */
  cost?: number;
  /** Local: the model and settings this answer ran on. */
  model?: TurnModel;
  /** Local proposed-plan action. */
  proposedPlan?: boolean;
  /** Local marker: the saved Codex session already received this steering prompt. */
  steered?: boolean;
  /** Local: a steer sent into the running answer that the agent hasn't picked up yet. */
  unread?: boolean;
  /**
   * Local marker: a `/btw` question, asked beside the main conversation. It
   * roots a side thread its agent answers without changing anything, and the
   * main session never hears it.
   */
  side?: boolean;
  images?: ChatImage[];
  activity?: AgentActivity[];
  trace?: AgentTrace[];
  /** Local: what the side check flagged during this turn; see shared/watch. */
  notes?: WatchNote[];
  /** Local: files this turn's agent changed in the checkout, from snapshots before and after it. */
  changes?: TurnFileChange[];
  /** Local: where the agent's session stood after this answer, so a side conversation can fork from it. */
  forkPoint?: ForkPoint;
  /** Local: the turn failed because this agent's login is missing, expired or was revoked. */
  signIn?: AgentProvider;
  ended?: number;
  author?: string;
  authorId?: string;
  /** Local: the thread whose agent sent this message, through Relay's tools; `author` names it. */
  fromThread?: string;
  seq?: number;
  parentId?: string | null;
  pending?: boolean;
  id: string;
  role: "user" | "assistant";
  body: string;
  status: "complete" | "streaming" | "failed" | "cancelled";
  created: number;
  provider: AgentProvider;
  error?: string;
  version: number;
}
/** A provider session and the point in it (a turn, entry or message) to continue from. */
export interface ForkPoint {
  thread: string;
  at: string;
}
export interface TurnFileChange {
  path: string;
  additions: number;
  deletions: number;
  binary?: boolean;
  /** Local: rolled back by this snapshot, which redo restores from. */
  revertedBy?: string;
}
export interface ChatImage {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
}
export interface AgentActivity {
  id: string;
  kind: "command" | "file" | "read" | "search" | "web" | "agent" | "tool";
  label: string;
  status: "running" | "complete" | "failed";
  detail?: string;
  /** Phones only: how many characters the desktop left out of `detail`; `activityDetail` has them all. */
  detailCut?: number;
  /** The agent call this one ran inside, when a subagent made it. */
  parentId?: string;
  /** A running agent's latest status line, e.g. "Reading auth.ts · 12 tools". */
  progress?: string;
  /** An MCP tool call: which server's tool it was. */
  mcp?: { server: string; tool: string };
}
/** Private turn events. */
export type AgentTrace =
  | { kind: "commentary"; id: string; text: string }
  | { kind: "activity"; id: string; activity: AgentActivity };
/** Images the agent looked at during a turn, subagents included, by path in first-read order. */
export function turnImages(message: ChatMessage): string[] {
  const calls = message.trace
    ? message.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
    : (message.activity ?? []);
  return [
    ...new Set(
      calls
        .filter(
          (a) =>
            a.kind === "read" &&
            a.status === "complete" &&
            isImagePath(a.label),
        )
        .map((a) => a.label),
    ),
  ];
}
/** Sequenced messages in the thread's order, then ones not yet sequenced by when they were made. */
export const threadOrder = (a: ChatMessage, b: ChatMessage) =>
  a.seq && b.seq
    ? a.seq - b.seq
    : a.seq
      ? -1
      : b.seq
        ? 1
        : a.created - b.created;
export function replyRoot(messages: ChatMessage[], id: string): ChatMessage {
  const seen = new Set<string>();
  let current = messages.find((m) => m.id === id);
  while (current?.parentId) {
    if (seen.has(current.id)) throw new Error("Invalid reply chain.");
    seen.add(current.id);
    current = messages.find((m) => m.id === current!.parentId);
  }
  if (!current)
    throw new Error("Reply target is missing from this conversation.");
  return current;
}

/** The main conversation: everything but replies. A reply whose parent is gone
 * (the phone only holds the latest messages) shows here rather than nowhere. */
export function mainConversation(messages: ChatMessage[]) {
  const ids = new Set(messages.map((m) => m.id));
  return messages.filter((m) => !m.parentId || !ids.has(m.parentId));
}

/** The message a reply chain starts from. Unlike replyRoot, a missing parent
 * or a loop ends the chain where it breaks instead of throwing. */
export function chainRoot(
  byId: Map<string, ChatMessage>,
  message: ChatMessage,
): ChatMessage {
  const seen = new Set<string>();
  let current = message;
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** `chainRoot` for a message among `messages`. */
export const rootOf = (messages: ChatMessage[], message: ChatMessage) =>
  chainRoot(new Map(messages.map((m) => [m.id, m])), message);

/** Each reply's side conversation, by the message it starts from. A chain whose
 * start is gone begins at its first message that is left, which stays in the
 * main conversation and so has no entry itself. */
export function replyRoots(messages: ChatMessage[]) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const roots = new Map<string, string>();
  for (const m of messages) {
    if (!m.parentId) continue;
    const root = chainRoot(byId, m);
    if (root !== m) roots.set(m.id, root.id);
  }
  return roots;
}
