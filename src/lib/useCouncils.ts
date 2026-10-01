import { useMemo, useRef } from "react";
import {
  fixRequest,
  type DeepReviewStart,
  type Finding,
} from "../../shared/deep-review";
import type {
  ChatSummary,
  ProjectChat as ProjectChatData,
} from "../../shared/projects";
import { councilWorking } from "../../shared/ultraplan";
import { findingCode } from "../components/DeepReview";
import { api } from "./api";
import { saveSentSettings } from "./composer-settings";
import type { ThreadHandle } from "./useThreadHandle";

export type Councils = ReturnType<typeof useCouncils>;

/** A thread's deep review and ultraplans: their state, and what the thread can do with them. */
export function useCouncils({
  handle: { chat, projectId, busy, run, setError, refetch, listChanged },
  data,
  onCreated,
  onSent,
}: {
  handle: ThreadHandle;
  data?: ProjectChatData;
  onCreated: (c: ChatSummary) => Promise<void>;
  /** Something went to the agents; the thread follows the answer. */
  onSent: () => void;
}) {
  const review = data?.deepReview;
  // Reviewers work in threads of their own; this one waits for the lead.
  const reviewing = review?.status === "reviewing";
  const plans = data?.ultraplans;
  // Thinkers work in threads of their own; messages wait for the lead's plan.
  const planning = councilWorking(Object.values(plans ?? {}));
  // Keyed on the report alone: a new renderer redraws the whole summary, and
  // the review changes with every finding dismissed or fixed.
  const reviewCode = useMemo(
    () =>
      chat && review?.report
        ? findingCode(chat.id, review.report.findings)
        : undefined,
    [chat?.id, review?.report],
  );
  // A start that failed leaves its thread for the next try. Kept apart from
  // `created`, so a message sent from this draft instead gets a thread of its own.
  const reviewThread = useRef<ChatSummary | undefined>(undefined);
  async function startReview(config: DeepReviewStart) {
    if (busy) return false;
    return run(async () => {
      const target =
        reviewThread.current ??
        (await api.createProjectChat(projectId, { kind: "review" }));
      reviewThread.current = target;
      // Messages in the thread go to the lead, with the lead's settings.
      const { lead } = config;
      saveSentSettings(target.id, lead.provider, {
        ...lead,
        runtimeMode: config.runtimeMode,
        interactionMode: "default",
      });
      await api.startDeepReview(target.id, config);
      onSent();
      await onCreated(target);
      await listChanged();
    });
  }
  // Straight to the lead; whatever the composer holds stays there.
  async function fixFindings(findings: Finding[]) {
    if (!chat || !review || !findings.length || busy) return;
    await run(async () => {
      await api.sendProjectChat(chat.id, {
        id: crypto.randomUUID(),
        body: fixRequest(review.lead.provider, findings),
        to: review.lead.provider,
        provider: review.lead.provider,
        choice: review.lead.choice,
        runtimeMode: review.runtimeMode,
        interactionMode: "default",
        fixes: findings.map((f) => f.id),
      });
      onSent();
      await refetch();
    });
  }
  function setFindingStatus(id: string, status: "open" | "dismissed") {
    if (!chat) return;
    void api
      .setDeepReviewFinding(chat.id, id, status)
      .then(() => refetch())
      .catch(setError);
  }
  function resume(start: (chatId: string) => Promise<unknown>) {
    if (!chat || busy) return;
    void run(async () => {
      await start(chat.id);
      await refetch();
    });
  }
  return {
    review,
    reviewing,
    plans,
    planning,
    reviewCode,
    startReview,
    fixFindings,
    setFindingStatus,
    resumeReview: () => resume((chatId) => api.resumeDeepReview(chatId)),
    resumeUltraplan: (request: string) =>
      resume((chatId) => api.resumeUltraplan(chatId, request)),
  };
}
