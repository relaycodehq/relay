import { savedRuntimeMode } from "../../shared/agent-modes";
import { migrateAgentSessions } from "../../shared/projects";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { settleActivities } from "./answer-recorder";
import { ownAgentWorktrees } from "./agent-worktrees";

/** An answer the app closed on, with what it had written so far. */
export function interrupt(m: ChatMessage) {
  m.status = "failed";
  m.error =
    "The app closed before this answer finished. Partial output was kept.";
  m.version++;
  settleActivities(m, "failed");
  m.ended = Date.now();
}

/**
 * Brings a thread read from disk up to date: older save formats, and what
 * an earlier session left running. `streams` keeps an answer streaming
 * whose session a restart left running. Says whether the thread needs
 * saving again, and whether its sidebar summary changed with it.
 */
export function reviveChat(
  chat: ProjectChat,
  streams: (m: ChatMessage) => boolean,
) {
  let interrupted = migrateAgentSessions(chat);
  for (const input of [
    chat.lastInput,
    ...(chat.queue ?? []).map((q) => q.input),
  ]) {
    if (input && !input.runtimeMode) {
      const old = input as typeof input & { mode?: string };
      input.runtimeMode = savedRuntimeMode(old.mode);
      input.interactionMode = "default";
      delete old.mode;
      interrupted = true;
    }
  }
  if (chat.queue?.length) chat.queuePaused = true;
  let summaryChanged = false;
  if (chat.agentWorktrees) {
    const own = ownAgentWorktrees(chat);
    if (own.length !== chat.agentWorktrees.length) {
      if (own.length) chat.agentWorktrees = own;
      else delete chat.agentWorktrees;
      interrupted = summaryChanged = true;
    }
  }
  // A review whose agents ran in an earlier session can only be resumed,
  // and a fix that was running then left its findings open.
  const review = chat.deepReview;
  if (review?.status === "reviewing" || review?.status === "leading") {
    review.status = review.status === "reviewing" ? "stopped" : "failed";
    interrupted = true;
  }
  // A council cut off before the lead's plan waits for Resume; a plan
  // cut off resumes like any answer.
  for (const plan of Object.values(chat.ultraplans ?? {}))
    if (
      plan.status === "briefing" ||
      plan.status === "thinking" ||
      plan.status === "leading"
    ) {
      plan.status =
        plan.status === "leading" && plan.answer ? "done" : "stopped";
      interrupted = true;
    }
  if (review?.fixing) {
    for (const id of Object.values(review.fixing).flat())
      if (review.statuses?.[id] === "fixing") {
        review.statuses[id] = "open";
        interrupted = true;
      }
    delete review.fixing;
  }
  for (const m of chat.messages) {
    // Older saves kept every tool call twice; the trace alone is shown.
    if (m.trace) delete m.activity;
    // Some saves also listed files the agent didn't change; only its own are shown.
    const changes = m.changes?.filter(
      (f) => !(f as { unclaimed?: true }).unclaimed,
    );
    if (changes?.length) m.changes = changes;
    else delete m.changes;
    if (m.status === "streaming" && !streams(m)) {
      interrupt(m);
      interrupted = true;
    }
  }
  return { interrupted, summaryChanged };
}
