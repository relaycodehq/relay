import type { AgentProvider } from "../agents";
import { isImagePath } from "../answer-images";
import type { TurnModel } from "../turn-model";

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
export interface ChatMessage {
  /** Local marker: this answer compacted the provider session instead of replying. */
  compaction?: boolean;
  /** Local: what a compaction left the agent with, when the provider hands it back readable. */
  compactSummary?: string;
  handoff?: AgentHandoff;
  /** Local marker: the lead's brief for an Ultraplan council, shown inside it. */
  brief?: boolean;
  /** Local marker: the agent started this turn itself, e.g. when a background task ended. */
  unprompted?: boolean;
  context?: ContextUsage;
  /** Local: dollars this answer cost, as its agent priced it. */
  cost?: number;
  /** Local: the model and settings this answer ran on. */
  model?: TurnModel;
  /** Local proposed-plan action; shared chats receive the final text only. */
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
  /** Local: files this turn's agent changed in the checkout, from snapshots before and after it. */
  changes?: TurnFileChange[];
  /** Local: where the agent's session stood after this answer, so a side conversation can fork from it. */
  forkPoint?: ForkPoint;
  /** Local: the turn failed because Claude's login expired or was revoked. */
  signIn?: "claude";
  ended?: number;
  author?: string;
  authorId?: string;
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
  /** The agent call this one ran inside, when a subagent made it. */
  parentId?: string;
  /** A running agent's latest status line, e.g. "Reading auth.ts · 12 tools". */
  progress?: string;
}
/** Private turn events. Sharing serializes only the final answer body. */
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
