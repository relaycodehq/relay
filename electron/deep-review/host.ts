// What running a deep review needs from the app: its threads, the agents'
// turns in them, and where it may make worktrees.
import type { AgentProvider } from "../../shared/agents";
import type { ReviewerTask } from "../../shared/deep-review";
import type {
  Project,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";

export interface DeepReviewHost {
  load(id: string): Promise<ProjectChat>;
  project(id: string): Project;
  root(projectId: string): Promise<string>;
  /** The folder Relay makes worktrees in; reviews make theirs in a folder of their own there. */
  worktrees: string;
  /** A reviewer's thread, listed under the review as if `by`, its lead, had started it. */
  createReviewer(
    parent: ProjectChat,
    reviewer: { task: ReviewerTask; title: string; by: AgentProvider },
  ): Promise<ProjectChat>;
  send(chatId: string, input: ProjectChatSend): Promise<void>;
  /** Starts the lead's turn in the review thread, its answer `answer`; it runs on after this returns. */
  lead(
    chat: ProjectChat,
    input: ProjectChatSend,
    prompt: string,
    answer: string,
  ): Promise<void>;
  active(chatId: string): boolean;
  /** A turn is at work in the thread, one its agent started beside another included. */
  answering(chatId: string): boolean;
  /** Its agent has subagents at work in the background; they start another turn when they end. */
  waiting(chatId: string): boolean;
  /** Its agent's session still runs, so what it waits for can start a turn. */
  live(chatId: string): boolean;
  /** Waits for a turn that's stopped or finished to give its thread back, and the review step its end takes. */
  finished(chatId: string): Promise<void>;
  /** As `finished`, for a reviewer, and what its end does after: its queue and the review's next step. */
  windDown(chatId: string): Promise<void>;
  /** Stops a reviewer's turn and holds what's queued for it, as its own Stop does. */
  stop(chatId: string): void;
  /** Ends a thread's agent processes; it resumes their sessions if it runs again. */
  close(chatId: string): void;
  /** Saves the thread and tells the renderer this message, and so the review, changed. */
  touch(chat: ProjectChat, messageId: string): Promise<void>;
  /** Deletes a reviewer thread whose review never started. */
  discard(chat: ProjectChat): Promise<void>;
}
