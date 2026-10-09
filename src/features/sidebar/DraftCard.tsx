import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, SquarePen } from "lucide-react";
import {
  loadDraftScope,
  useDraft,
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
import { agentName } from "../../../shared/agents";

/** An unsent new thread: a card like a thread's, with no title or branch yet. */
export function DraftCard({
  draft,
  selected,
  onOpen,
  onSendOpen,
}: {
  draft: ActivityDraft;
  /** It's the one open. */
  selected: boolean;
  onOpen: () => void;
  /** Sends it from the open composer. */
  onSendOpen: () => void;
}) {
  const send = useDraftSend(draft, selected, onOpen, onSendOpen);
  const { project } = draft;
  const open = () => {
    if (!selected) onOpen();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      className={`sb-card draft ${selected ? "selected" : ""}`}
      title={`New thread in ${project.name}`}
      data-card={draft.key}
      onClick={open}
      onKeyDown={rowKeys(open)}
    >
      <div className="sb-card-top">
        <ProjectBadge id={project.id} name={project.name} />
        <span className="sb-card-name">
          <span className="sb-card-project">{project.name}</span>
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
      <div className="sb-card-title untitled">New thread</div>
      <div className="sb-card-meta">
        <DraftLine draftKey={draft.key} />
        <DraftAgent id={draft.id} />
      </div>
      {send.error && (
        <div className="sb-draft-error" role="alert">
          {send.error}
        </div>
      )}
    </div>
  );
}

/** The unsent text, where a card shows its branch. */
export function DraftLine({ draftKey }: { draftKey: string }) {
  const text = useDraft(draftKey).replace(/\s+/g, " ").trim();
  return (
    <span className="sb-card-draft">
      <SquarePen size={11} aria-label="Draft" />
      <span>{text}</span>
    </span>
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
  const sendable =
    !!draft &&
    !draft.reply &&
    (!!draft.chat || loadDraftScope(draft.id).kind !== "review");
  async function send() {
    if (!draft) return;
    if (selected && onSendOpen) return onSendOpen();
    setSending(true);
    setError(undefined);
    try {
      if (!(await sendDraft(qc, draft))) onOpen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
