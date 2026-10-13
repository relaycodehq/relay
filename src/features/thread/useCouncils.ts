import type { DeepReviewStart } from "../../../shared/deep-review";
import { fixRequest, type Finding } from "../../../shared/findings";
import type { AgentProvider } from "../../../shared/agents";
import {
  lastComposerSettings,
  type ChatSummary,
  type LinkedFolder,
  type ProjectChat as ProjectChatData,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import {
  loadComposerSettings,
  saveSentSettings,
  withSent,
} from "../agents/composer-settings";
import { modelOf } from "../agents/composer-models";
import { useNewThread } from "./useNewThread";
import type { ThreadHandle } from "./useThreadHandle";
import { noteUsed } from "../../lib/used";

export type Councils = ReturnType<typeof useCouncils>;

/** A thread's deep review and the findings its answers published, and what the thread can do with them. */
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
  /**
   * Straight to the agent that reported them, a review's lead on the lead's
   * settings; whatever the composer holds stays there.
   */
  async function fixFindings(findings: Finding[], reporter: AgentProvider) {
    if (!chat || !findings.length) return;
    const saved = review
      ? undefined
      : withSent(loadComposerSettings(chat.id), lastComposerSettings(data));
    const provider = review?.lead.provider ?? reporter;
    const model = saved && modelOf(saved.models, provider);
    await run(async () => {
      await api.sendProjectChat(chat.id, {
        id: crypto.randomUUID(),
        body: fixRequest(provider, findings),
        to: provider,
        provider,
        choice: review?.lead.choice ?? model!.choice,
        ...(model?.contextWindow ? { contextWindow: model.contextWindow } : {}),
        runtimeMode: review?.runtimeMode ?? saved!.runtimeMode,
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
      .setFinding(chat.id, id, status)
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
    findings: data?.findings,
    reviewing,
    startReview,
    fixFindings,
    setFindingStatus,
    resumeReview: () => resume((chatId) => api.resumeDeepReview(chatId)),
  };
}
