import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ScanSearch, Smartphone, SquarePen } from "lucide-react";
import {
  reviewSetUp,
  useDraftRecord,
  useDraft,
  useDraftImageCount,
  type ActivityDraft,
} from "../composer/drafts";
import { ProjectBadge } from "../projects/ProjectBadge";
import { rowKeys } from "../../ui/ui";
import { sendDraft } from "../composer/draft-send";
import { newThreadAgentQuery } from "../composer/useNewThreadAgent";
import {
  composerProvider,
  loadComposerSettings,
} from "../agents/composer-settings";
import { useAISettings } from "../agents/useAISettings";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { agentName, type AgentProvider } from "../../../shared/agents";
import { useSharedDraft } from "../composer/draft-sync";
import type { KeyCombo } from "../../../shared/shortcuts";
import { CardShortcut } from "./CardShortcut";
import { errorMessage } from "../../../shared/error-message";

/** An unsent new thread: a card like a thread's, with no title or branch yet. */
export function DraftCard({
  draft,
  selected,
  jump,
  index,
  onOpen,
  onSendOpen,
}: {
  draft: ActivityDraft;
  /** It's the one open. */
  selected: boolean;
  jump: KeyCombo | undefined;
  index: number;
  onOpen: () => void;
  /** Sends it from the open composer. */
  onSendOpen: () => void;
}) {
  const send = useDraftSend(draft, selected, onOpen, onSendOpen);
  const { project } = draft;
  const review = useIsReview(draft.id);
  const open = () => {
    if (!selected) onOpen();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      className={`sb-card draft ${selected ? "selected" : ""}`}
      title={`${review ? "Deep review" : "New thread"} in ${project.name}`}
      data-card={draft.key}
      onClick={open}
      onKeyDown={rowKeys(open)}
    >
      <div className="sb-card-top">
        <ProjectBadge project={project} />
        <span className="sb-card-name">
          <span className="sb-card-project">{project.name}</span>
          <CardShortcut binding={jump} index={index} />
        </span>
        {send.sendable && (
          <div className="sb-card-actions">
            <DraftSendButton
              send={send}
              title={`Start it in ${project.name}`}
            />
          </div>
        )}
      </div>
      <div className="sb-card-title untitled">
        {review ? "Deep review" : "New thread"}
      </div>
      <div className="sb-card-meta">
        {review ? (
          <ReviewLine id={draft.id} />
        ) : (
          <>
            <DraftLine draftKey={draft.key} />
            <DraftAgent id={draft.id} />
          </>
        )}
      </div>
      {send.error && (
        <div className="sb-draft-error" role="alert">
          {send.error}
        </div>
      )}
    </div>
  );
}

/** The unsent text, where a card shows its branch; a phone's mark when it was started there. */
export function DraftLine({ draftKey }: { draftKey: string }) {
  const text = useDraft(draftKey).replace(/\s+/g, " ").trim();
  const images = useDraftImageCount(draftKey);
  const phone = useSharedDraft(draftKey)?.origin.startsWith("phone:");
  return (
    <span
      className="sb-card-draft"
      title={phone ? "Started on your phone" : undefined}
    >
      {phone ? (
        <Smartphone size={11} aria-label="Draft started on your phone" />
      ) : (
        <SquarePen size={11} aria-label="Draft" />
      )}
      <span>
        {text || (images === 1 ? "Screenshot" : `${images} screenshots`)}
      </span>
    </span>
  );
}

/**
 * Whether an unsent thread is a deep review rather than a message: a message
 * written before Deep review was opened still reads as itself until a review
 * is set up.
 */
const useIsReview = (id: string) =>
  useDraftRecord(id, (d) => reviewSetUp(id, d));

/** An unsent deep review: its focus note, else how many review it, and their agents. */
function ReviewLine({ id }: { id: string }) {
  const focus = useDraftRecord(id, (d) => d.review?.focus ?? "")
    .replace(/\s+/g, " ")
    .trim();
  // A string, so an unchanged setup reads as the same snapshot.
  const joined = useDraftRecord(id, (d) =>
    (d.review?.setup?.reviewers ?? []).map((r) => r.provider).join(","),
  );
  const reviewers = joined ? (joined.split(",") as AgentProvider[]) : [];
  const agents = [...new Set(reviewers)];
  const count = `${reviewers.length} ${reviewers.length === 1 ? "reviewer" : "reviewers"}`;
  return (
    <>
      <span className="sb-card-draft">
        <ScanSearch size={11} aria-label="Deep review" />
        <span>
          {focus || (reviewers.length ? count : "Set up, not started")}
        </span>
      </span>
      {!!agents.length && (
        <span
          className="sb-card-provider"
          title={`${count}: ${agents.map(agentName).join(", ")}`}
        >
          {agents.map((p) => (
            <ProviderIcon key={p} provider={p} />
          ))}
        </span>
      )}
    </>
  );
}

/** The agent a new thread's draft will go to, as its composer would pick it. */
function DraftAgent({ id }: { id: string }) {
  const lastAgent = useQuery(newThreadAgentQuery).data;
  const ai = useAISettings().data;
  const provider = composerProvider(
    lastAgent || loadComposerSettings(id).provider,
    ai?.threadProvider,
  );
  return (
    <span
      className="sb-card-provider"
      title={provider === "message" ? "Message only" : agentName(provider)}
    >
      <ProviderIcon provider={provider} />
    </span>
  );
}

export type DraftSend = ReturnType<typeof useDraftSend>;

/**
 * Sends a card's draft in the background, or through the open composer
 * when its thread is the one open; opens it when it can't go from here.
 */
export function useDraftSend(
  draft: ActivityDraft | undefined,
  selected: boolean,
  onOpen: () => void,
  onSendOpen?: () => void,
) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  // A review starts from its setup, not from a message.
  const review = useDraftRecord(
    draft?.id ?? "",
    (d) => d.scope?.kind === "review",
  );
  const sendable = !!draft && !draft.reply && (!!draft.chat || !review);
  async function send() {
    if (!draft) return;
    if (selected && onSendOpen) return onSendOpen();
    setSending(true);
    setError(undefined);
    try {
      if (!(await sendDraft(qc, draft))) onOpen();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }
  return { sendable, sending, error, send };
}

export function DraftSendButton({
  send,
  title,
}: {
  send: DraftSend;
  title: string;
}) {
  if (!send.sendable) return null;
  return (
    <button
      className="sb-card-action icon"
      aria-label="Send draft"
      title={title}
      disabled={send.sending}
      onClick={(e) => {
        e.stopPropagation();
        void send.send();
      }}
    >
      <ArrowUp size={14} />
    </button>
  );
}
