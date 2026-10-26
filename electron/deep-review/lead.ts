// Handing a round to its lead once the reviewers are done: their reports,
// whether they can go on, and the lead's first turn.
import { randomUUID } from "node:crypto";
import { hasCouncilReport, memberAnswer } from "../../shared/council";
import { passStarted, type DeepReviewState } from "../../shared/deep-review";
import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { halted } from "./council";
import { leadPrompt } from "./prompts";

export interface LeadHost {
  lead(
    chat: ProjectChat,
    input: ProjectChatSend,
    prompt: string,
    answer: string,
  ): Promise<void>;
  touch(chat: ProjectChat, messageId: string): Promise<void>;
}

/** Each reviewer asked so far, numbered as the lead knows them, with its latest answer. */
export function reviewReports(
  state: DeepReviewState,
  members: (ProjectChat | undefined)[],
) {
  return state.reviewers
    .map((reviewer, i) => ({
      number: i + 1,
      reviewer,
      answer: members[i] && memberAnswer(members[i].messages),
    }))
    .filter((r) => passStarted(state, r.reviewer));
}

/**
 * Why the reports can't go on, to the next pass or the lead: a reviewer of
 * the pass that just ended stopped, or none of them reported.
 * `withReportsIn` goes on past a stopped reviewer, as long as one reported.
 */
export function haltedReview(
  state: DeepReviewState,
  reports: ReturnType<typeof reviewReports>,
  withReportsIn: boolean,
) {
  if (withReportsIn)
    return reports.some((r) => hasCouncilReport(r.answer))
      ? undefined
      : "failed";
  // Each pass is checked as it ends, so only this one's reports are new.
  const thisPass = reports.filter(
    (r) => (r.reviewer.pass ?? 0) === (state.pass ?? 0),
  );
  return halted(thisPass.map((r) => r.answer));
}

/** Starts the lead's first turn with the reports; when it can't start, Resume tries again. */
export async function startLead(
  host: LeadHost,
  chat: ProjectChat,
  state: DeepReviewState,
  reports: ReturnType<typeof reviewReports>,
) {
  // Claimed before anything is awaited, so reviewers finishing together start one lead.
  state.status = "leading";
  // Named before it starts: another answer may sit after the request.
  state.leadAnswer = randomUUID();
  try {
    await host.lead(
      chat,
      {
        id: randomUUID(),
        body: `@${state.lead.provider}`,
        to: state.lead.provider,
        provider: state.lead.provider,
        choice: state.lead.choice,
        runtimeMode: state.runtimeMode,
        interactionMode: "default",
      },
      leadPrompt(state, reports, chat),
      state.leadAnswer,
    );
  } catch (e) {
    // The lead never started; Resume tries again.
    state.status = "stopped";
    throw e;
  } finally {
    await host.touch(chat, state.request);
  }
}
