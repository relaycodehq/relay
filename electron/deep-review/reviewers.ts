// A round's reviewers: a thread for each, listed under the review, and the
// task each is sent there.
import { randomUUID } from "node:crypto";
import type { AgentProvider } from "../../shared/agents";
import {
  reviewerTitle,
  type DeepReviewStart,
  type DeepReviewState,
  type ReviewerTask,
} from "../../shared/deep-review";
import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { councilTurn, startSlots } from "./council";
import { reviewerTask } from "./prompts";

export interface ReviewersHost {
  createReviewer(
    parent: ProjectChat,
    reviewer: { task: ReviewerTask; title: string; by: AgentProvider },
  ): Promise<ProjectChat>;
  discard(chat: ProjectChat): Promise<void>;
  send(chatId: string, input: ProjectChatSend): Promise<void>;
  active(chatId: string): boolean;
  touch(chat: ProjectChat, messageId: string): Promise<void>;
}

/** A thread for each reviewer; those made before one failed are deleted again. */
export async function createReviewers(
  host: ReviewersHost,
  chat: ProjectChat,
  state: DeepReviewState,
  config: DeepReviewStart,
) {
  const created: ProjectChat[] = [];
  try {
    for (const [slot, reviewer] of config.reviewers.entries()) {
      const { codex } = reviewerTask(reviewer, state.scope, state.focus);
      const child = await host.createReviewer(chat, {
        task: {
          parent: chat.id,
          round: state.request,
          slot,
          ...(codex ? { codex } : {}),
        },
        title: reviewerTitle(slot, reviewer),
        by: config.lead.provider,
      });
      created.push(child);
      state.reviewers.push({ ...reviewer, chatId: child.id });
    }
  } catch (error) {
    await Promise.allSettled(created.map((c) => host.discard(c)));
    throw error;
  }
  return created;
}

/** Sends `slots` their tasks; `done` goes on past any that couldn't start. */
export async function sendReviewers(
  host: ReviewersHost,
  chat: ProjectChat,
  state: DeepReviewState,
  slots: number[],
  done: () => Promise<unknown>,
) {
  try {
    await startReviewers(host, chat, state, slots, done);
  } catch (error) {
    // Nothing is running that would ever hand over to the lead, so leave
    // the review where Resume picks it up.
    if (
      state.status === "reviewing" &&
      !state.reviewers.some((r) => host.active(r.chatId))
    ) {
      state.status = "failed";
      await host
        .touch(chat, state.request)
        .catch((e) => console.warn("Could not save the failed review:", e));
    }
    throw error;
  }
}

async function startReviewers(
  host: ReviewersHost,
  chat: ProjectChat,
  state: DeepReviewState,
  slots: number[],
  done: () => Promise<unknown>,
) {
  await startSlots(
    slots,
    async (slot) => {
      const reviewer = state.reviewers[slot]!;
      const { body } = reviewerTask(reviewer, state.scope, state.focus);
      await host.send(reviewer.chatId, {
        id: randomUUID(),
        body,
        to: reviewer.provider,
        provider: reviewer.provider,
        choice: reviewer.choice,
        ...councilTurn,
        // Signed by the review, whose name opens it from the reviewer's thread.
        fromThread: { id: chat.id, name: "Deep review" },
      });
    },
    done,
  );
}
