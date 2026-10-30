import type { OpenTurn } from "../turns";
import { z } from "zod";
import type { AgentProvider } from "../agents";
import type { AccountProvider } from "../agent-accounts";
import type { ReviewCard, ReviewerTask } from "../deep-review";
import type { ThreadGoal } from "../goal";
import type {
  ChatAbandonedHandoff,
  ChatCameFrom,
  ChatSentTo,
} from "../handoff";
import type { FromTerminal } from "../terminal-sessions";
import type { ImportApp } from "../project-import";
import { refSchema } from "../validation";
import type { LinkedFolder } from "./links";
import type {
  ActiveAgentWorktree,
  AgentWorktree,
  ChatWorktree,
  ReviewFolder,
  WorkspaceMove,
} from "./worktrees";

export const threadTitleSchema = z
  .string()
  .trim()
  .min(1, "Name the thread.")
  .max(120)
  .refine((value) => !/[\x00-\x1f]/.test(value), "Use a plain name.");
export const chatScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("pr"), ref: refSchema }).strict(),
  // What a deep review covers is fixed when it starts; see `reviews`.
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
  /** Provider of the latest answer, or the starting agent's before one comes. */
  provider?: AgentProvider;
  /** The latest answer's model, by its listed name ("Opus 5.5"). */
  model?: string;
  /** Every agent used in the conversation, most recently used first. */
  providers?: AgentProvider[];
  /** The agent holding the main conversation's context; see shared/recipient. */
  contextAgent?: AgentProvider;
  /** The account each agent runs on here, pinned on its first turn; see shared/agent-accounts. */
  accounts?: Partial<Record<AccountProvider, string>>;
  /** No messages yet; absent on summaries saved before this field existed. */
  empty?: boolean;
  /** Settled until a newer update; see shared/chat-activity. */
  settledAt?: number;
  /**
   * Settled by hand while its answer ran: it stays settled through that
   * answer and whatever was queued behind it, and becomes a plain settle once
   * they finish cleanly. A question, a failure or your own message drops it.
   * Without `settledAt` its own agent asked: it stays in Activity until then,
   * and until the user read it.
   */
  settleWhenDone?: number;
  /** Moved back to activity by hand; auto-settle leaves it alone until newer activity. */
  unsettledAt?: number;
  /** Never settled automatically; only the thread's menu turns it back on. */
  autoSettleOff?: true;
  /** Listed first in its project or Scratchpad, and never settled automatically. */
  pinnedAt?: number;
  /** Live: settled by inactivity, a merged PR or a commit, not by hand; never persisted. */
  autoSettled?: true;
  /** When the latest turn that committed ended; see `settleOnCommit`. */
  committedAt?: number;
  snoozedAt?: number;
  snoozedUntil?: number;
  /** The `updated` this thread was last read up to, on the desktop or a phone. */
  seenAt?: number;
  /** Marked unread by hand; reading it again clears this. */
  markedUnread?: true;
  /** Archived threads are hidden from the sidebar. */
  archivedAt?: number;
  /** Branch checked out when the latest message was sent or its answer ended. */
  branch?: string;
  /** The short commit checked out instead, when that checkout was detached. */
  commit?: string;
  /** Set on threads that work in their own worktree; fixed when the thread starts. */
  worktree?: ChatWorktree;
  /** Folders linked to this thread alone, with `/add-dir`; its project's links come on top. */
  links?: LinkedFolder[];
  /** Worktrees the agent made itself with git, still on disk when last checked. */
  agentWorktrees?: AgentWorktree[];
  /** Explicit workspace choice; unset means the project folder, regardless of discovered worktrees. */
  activeAgentWorktree?: ActiveAgentWorktree;
  /** Each time its folder changed after it started, oldest first; see shared/workspace-moves. */
  workspaceMoves?: WorkspaceMove[];
  /** A deep review's own checkout of the reviewed code; its Git, files and agent work there. */
  reviewFolder?: ReviewFolder;
  /** A deep review whose reviewers are at work, the lead waiting for them. */
  reviewing?: true;
  /** What a deep review covers and who reviews it, from its latest round. */
  reviewCard?: ReviewCard;
  /** One-shot wake-ups Relay sends itself; Claude's own copies ended when Relay closed. */
  heldWakeups?: HeldWakeup[];
  /** Work that ended when Relay closed, until picked back up or dismissed. */
  stopped?: { at: number; items: StoppedWork[] };
  /** Handed off to another computer; it continues there. See shared/handoff. */
  sentTo?: ChatSentTo;
  /** Taken over from another computer. */
  cameFrom?: ChatCameFrom;
  /** Handoffs of this thread taken back without the computer that had it. */
  abandonedHandoffs?: ChatAbandonedHandoff[];
  /** When the earliest message scheduled with Send later goes out. */
  nextSend?: number;
  /** Changes whenever its queue or Send later list does, so phones know to fetch them. */
  queueMark?: string;
  /** Changes whenever its notes do, so windows and phones know to fetch them. */
  notesMark?: string;
  /** Changes whenever its setup's state does (`ProjectChat.setup`), so windows know to fetch it. */
  setupMark?: string;
  /** The answer a usage limit stopped, resumed once the limit lifts; see limit-resume. */
  limitResume?: LimitResume;
  /** The main conversation's native `/goal`, as its agent last reported it; see shared/goal. */
  goal?: ThreadGoal;
  /**
   * A deep review's reviewer. It is listed under the review like a started
   * thread (`startedBy`), works in the review's checkout and never edits.
   */
  reviewer?: ReviewerTask;
  /** Started by another thread's agent through Relay's tools; listed under that thread. */
  startedBy?: StartedBy;
  /** The user let this thread's agent start, message, stop and settle any thread, in any project, without asking. */
  drivesThreads?: true;
  /** Continues a Claude Code or Codex session started in a terminal. */
  fromTerminal?: FromTerminal;
  /** Opened to import this app's history with an agent; its agent gets the import tools. */
  importFrom?: ImportApp;
  /** An async question is still open: neither answered nor dismissed. It needs the user even while the agent continues. */
  asking?: true;
  /** Live state added by list(); never persisted. */
  running?: boolean;
  runningSince?: number;
  /** Stopped, while the agent winds down; not running any more. */
  stopping?: true;
  /** The turn holding the thread while it runs; see docs/turn-lifecycle.md. */
  turn?: OpenTurn;
  /** The thread's own agent first, then its reviewers, one per provider. */
  runningAgents?: AgentProvider[];
  /** Needs the user, even if an async question lets the agent continue. */
  waiting?: boolean;
  /** Live: a request blocks the running turn. */
  blocked?: true;
  /** Work Claude left running that will start its next turn by itself. */
  pending?: ChatPending[];
}

export interface StartedBy {
  chatId: string;
  /** The agent that started it. */
  agent: AgentProvider;
  /** The user let the lead message it, in another project than the lead's. Saved before drivesThreads; still honoured. */
  sendsApproved?: true;
  /** The user asked it for a second opinion on this answer of the lead's, by message id. */
  secondOpinionOn?: string;
}

export interface HeldWakeup {
  id: string;
  prompt: string;
  at: number;
  /** The reply thread whose Claude session scheduled it. */
  parentId?: string;
}

export interface LimitResume {
  messageId: string;
  provider: AgentProvider;
  /** When the limit lifts; Relay resumes shortly after. */
  at: number;
  /** Turned off for this answer; the thread still offers to turn it back on. */
  off?: true;
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
      /** The ports its command listens on: a server, which never ends by itself. */
      ports?: number[];
    }
  | {
      kind: "wakeup";
      id: string;
      prompt: string;
      recurring: boolean;
      /** When a one-shot wake-up fires. */
      at?: number;
    };
const triageTime = z.number().int().positive().optional();
/** A thread's settle, snooze and archive marks, the ones triage sets. */
export const chatTriageStateSchema = z
  .object({
    settledAt: triageTime,
    settleWhenDone: triageTime,
    unsettledAt: triageTime,
    snoozedAt: triageTime,
    snoozedUntil: triageTime,
    archivedAt: triageTime,
  })
  .strict();
export type ChatTriageState = z.infer<typeof chatTriageStateSchema>;

export const chatTriageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("settle") }).strict(),
  z.object({ kind: z.literal("settle-when-done") }).strict(),
  z.object({ kind: z.literal("unsettle") }).strict(),
  z
    .object({
      kind: z.literal("snooze"),
      until: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("wake") }).strict(),
  z
    .object({
      kind: z.literal("archive"),
      /** Its worktree's folder goes too, its branch kept for an unarchive. */
      dropWorktree: z.literal(true).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("unread") }).strict(),
  z.object({ kind: z.literal("auto-settle"), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("pin"), pinned: z.boolean() }).strict(),
  // Undo: puts `to` back only while the thread still holds `from`, what the
  // undone action left, so it can't reverse anything done to it since.
  z
    .object({
      kind: z.literal("restore"),
      from: chatTriageStateSchema,
      to: chatTriageStateSchema,
    })
    .strict(),
]);

export type ChatTriage = z.infer<typeof chatTriageSchema>;
