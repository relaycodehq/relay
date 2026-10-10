import {
  fixRequest,
  type DeepReviewStart,
  type Finding,
} from "../../../shared/deep-review";
import type {
  ChatSummary,
  LinkedFolder,
  ProjectChat as ProjectChatData,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { saveSentSettings } from "../agents/composer-settings";
import { useNewThread } from "./useNewThread";
import type { ThreadHandle } from "./useThreadHandle";
import { noteUsed } from "../../lib/used";

export type Councils = ReturnType<typeof useCouncils>;

/** A thread's deep review: its state, and what the thread can do with them. */
export function useCouncils({
  handle: { chat, projectId, run, setError, refetch, listChanged },
  data,
  draftLinks,
  onCreated,
  onSent,
}: {
  handle: ThreadHandle;
  data?: ProjectChatData;
  draftLinks?: LinkedFolder[];
  onCreated: (c: ChatSummary) => Promise<void>;
  /** Something went to the agents; the thread follows the answer. */
  onSent: () => void;
}) {
  const review = data?.deepReview;
  // Reviewers work in threads of their own; this one waits for the lead.
  const reviewing = review?.status === "reviewing";
  // A start that failed leaves its thread for the next try. Kept apart from
  // the composer's, so a message sent from this draft instead gets a thread of its own.
  const reviewThread = useNewThread(
    () =>
      api.createProjectChat(
        projectId,
        { kind: "review" },
        undefined,
        undefined,
        draftLinks,
      ),
    onCreated,
  );
  async function startReview(config: DeepReviewStart) {
    return run(async () => {
      await reviewThread(async (thread) => {
        // Messages in the thread go to the lead, with the lead's settings.
        const { lead } = config;
        saveSentSettings(thread.id, lead.provider, {
          ...lead,
          runtimeMode: config.runtimeMode,
          interactionMode: "default",
        });
        await api.startDeepReview(thread.id, config);
        noteUsed("deep-review");
        onSent();
      });
      await listChanged();
    });
  }
  // Straight to the lead; whatever the composer holds stays there.
  async function fixFindings(findings: Finding[]) {
    if (!chat || !review || !findings.length) return;
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
    if (!chat) return;
    void run(async () => {
      await start(chat.id);
      await refetch();
    });
  }
  return {
    review,
    reviewing,
    startReview,
    fixFindings,
    setFindingStatus,
    resumeReview: () => resume((chatId) => api.resumeDeepReview(chatId)),
  };
}
