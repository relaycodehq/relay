import { savedRuntimeMode } from "../../shared/agent-modes";
import { reviewThreadTitle } from "../../shared/deep-review";
import { migrateAgentSessions } from "../../shared/projects";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { settleActivities } from "./answer-recorder";
import { ownAgentWorktrees } from "./agent-worktrees";
import { migrateFindings, reopenFixes } from "../findings";

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
 * whose session a restart left running. A thread this session held before
 * (`earlierSession` false) left nothing running behind it. Says whether the
 * thread needs saving again.
 */
export function reviveChat(
  chat: ProjectChat,
  streams: (m: ChatMessage) => boolean,
  earlierSession = true,
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
  if (chat.agentWorktrees) {
    const own = ownAgentWorktrees(chat);
    if (own.length !== chat.agentWorktrees.length) {
      if (own.length) chat.agentWorktrees = own;
      else delete chat.agentWorktrees;
      interrupted = true;
    }
  }
  const review = chat.deepReview;
  if (
    review &&
    !chat.renamed &&
    chat.title === `Deep review · ${review.scope.label}`
  ) {
    const title = reviewThreadTitle(review.scope);
    if (title !== chat.title) {
      chat.title = title;
      interrupted = true;
    }
  }
  if (
    earlierSession &&
    (review?.status === "reviewing" || review?.status === "leading")
  ) {
    // The lead's answer the app closed on is where resuming the lead goes on.
    const lead =
      review.status === "leading" &&
      [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant" && !m.parentId);
    // A review whose agents ran in an earlier session can only be resumed,
    // unless its lead's session carries on in the turn; that turn's end settles it.
    if (!(lead && lead.status === "streaming" && streams(lead))) {
      if (lead) review.leadStopped = lead.id;
      review.status = review.status === "reviewing" ? "stopped" : "failed";
      interrupted = true;
    }
  }
  // Ultraplan councils were retired; their state is dead weight now.
  if ("ultraplans" in chat) {
    delete (chat as { ultraplans?: unknown }).ultraplans;
    interrupted = true;
  }
  if (migrateFindings(chat)) interrupted = true;
  if (earlierSession && reopenFixes(chat.findings)) interrupted = true;
  for (const m of chat.messages) {
    // Older saves kept every tool call twice; the trace alone is shown.
    if (m.trace) delete m.activity;
    // Some saves also listed files the agent didn't change; only its own are shown.
    const changes = m.changes?.filter(
      (f) => !(f as { unclaimed?: true }).unclaimed,
    );
    if (changes?.length) m.changes = changes;
    else delete m.changes;
    if (!earlierSession) continue;
    if (m.status === "streaming" && m.worktreeCommand) {
      // Its process went with the app; the row offers to run it again.
      m.status = "cancelled";
      m.worktreeCommand.stopped = "cancelled";
      m.ended = Date.now();
      m.version++;
      interrupted = true;
    } else if (m.status === "streaming" && !streams(m)) {
      interrupt(m);
      interrupted = true;
    }
  }
  // Nothing sends the queue on its own now, unless an answer it waits for carries on.
  if (
    earlierSession &&
    chat.queue?.length &&
    !chat.messages.some((m) => m.status === "streaming")
  )
    chat.queuePaused = true;
  return interrupted;
}
