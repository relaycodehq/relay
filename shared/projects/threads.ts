import { z } from "zod";
import type { AgentProvider } from "../agents";
import type { ReviewerTask } from "../deep-review";
import type { ChatCameFrom, ChatSentTo } from "../handoff";
import type { ThinkerTask } from "../ultraplan";
import { refSchema } from "../validation";
import type { AgentWorktree, ChatWorktree } from "./worktrees";

/** A project's sidebar name, typed in place. */
export const threadTitleSchema = z
  .string()
  .trim()
  .min(1, "Name the thread.")
  .max(120)
  .refine((value) => !/[\x00-\x1f]/.test(value), "Use a plain name.");
export const chatScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("pr"), ref: refSchema }).strict(),
  // What a deep review covers is fixed when it starts; see `deepReview`.
  z.object({ kind: z.literal("review") }).strict(),
]);
export type ChatScope = z.infer<typeof chatScopeSchema>;
/** Where a new thread works: the project's own checkout, or a worktree of its own. */
export const chatWorkspaceSchema = z.enum(["checkout", "worktree"]);
export type ChatWorkspace = z.infer<typeof chatWorkspaceSchema>;
export interface ChatSummary {
  id: string;
  projectId: string;
  title: string;
  /** Named by the user; the prompt excerpt and generated titles never replace it. */
  renamed?: boolean;
  scope: ChatScope;
  created: number;
  updated: number;
  shared?: { roomId: string; server: string; memberId: string };
  /** Provider of the latest answer, for the activity card. */
  provider?: AgentProvider;
  /** The agent holding the main conversation's context; see shared/recipient. */
  contextAgent?: AgentProvider;
  /** No messages yet; absent on summaries saved before this field existed. */
  empty?: boolean;
  /** Settled until a newer update; see shared/chat-activity. */
  settledAt?: number;
  /** Moved back to activity by hand; auto-settle leaves it alone until newer activity. */
  unsettledAt?: number;
  /** Never settled automatically; only the thread's menu turns it back on. */
  autoSettleOff?: true;
  /** Live: settled by inactivity or a merged PR, not by hand; never persisted. */
  autoSettled?: true;
  snoozedAt?: number;
  snoozedUntil?: number;
  /** The `updated` this thread was last read up to, on the desktop or a phone. */
  seenAt?: number;
  /** Marked unread by hand; reading it again clears this. */
  markedUnread?: true;
  /** Archived threads are hidden from the sidebar. */
  archivedAt?: number;
  /** Branch checked out when the latest message was sent. */
  branch?: string;
  /** Set on threads that work in their own worktree; fixed when the thread starts. */
  worktree?: ChatWorktree;
  /** Worktrees the agent made itself with git, still on disk when last checked. */
  agentWorktrees?: AgentWorktree[];
  /** One-shot wake-ups Relay sends itself; Claude's own copies ended when Relay closed. */
  heldWakeups?: HeldWakeup[];
  /** Work that ended when Relay closed, until picked back up or dismissed. */
  stopped?: { at: number; items: StoppedWork[] };
  /** Handed off to another computer; it continues there. See shared/handoff. */
  sentTo?: ChatSentTo;
  /** Taken over from another computer. */
  cameFrom?: ChatCameFrom;
  /** When the earliest message scheduled with Send later goes out. */
  nextSend?: number;
  /** A deep review's reviewer; its thread shows inside the review, never on its own. */
  reviewer?: ReviewerTask;
  /** An Ultraplan's thinker; its thread shows inside the council, never on its own. */
  thinker?: ThinkerTask;
  /** Live state added by list(); never persisted. */
  running?: boolean;
  runningSince?: number;
  /** The thread's own agent first, then its reviewers or thinkers, one per provider. */
  runningAgents?: AgentProvider[];
  waiting?: boolean;
  /** Work Claude left running that will start its next turn by itself. */
  pending?: ChatPending[];
}
export interface HeldWakeup {
  id: string;
  prompt: string;
  at: number;
  /** The reply thread whose Claude session scheduled it. */
  parentId?: string;
}
/** `parentId` is the side conversation whose Claude session ran it. */
export type StoppedWork = ChatPending & { parentId?: string };
export type ChatPending =
  | {
      kind: "task";
      id: string;
      description: string;
      since: number;
      /** A subagent or workflow, which reports back, unlike a dev server. */
      agent?: boolean;
    }
  | {
      kind: "wakeup";
      id: string;
      prompt: string;
      recurring: boolean;
      /** When a one-shot wake-up fires. */
      at?: number;
    };
export const chatTriageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("settle") }).strict(),
  z.object({ kind: z.literal("unsettle") }).strict(),
  z
    .object({
      kind: z.literal("snooze"),
      until: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("wake") }).strict(),
  z.object({ kind: z.literal("archive") }).strict(),
  z.object({ kind: z.literal("unread") }).strict(),
  z.object({ kind: z.literal("auto-settle"), enabled: z.boolean() }).strict(),
]);
export type ChatTriage = z.infer<typeof chatTriageSchema>;
