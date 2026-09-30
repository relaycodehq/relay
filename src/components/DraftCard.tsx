import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, SquarePen } from "lucide-react";
import { loadDraftScope, useDraft, type ActivityDraft } from "../lib/drafts";
import { ProjectBadge } from "./ProjectBadge";
import { rowKeys } from "./ui";
import { sendDraft } from "./draft-send";

export function DraftCard({
  draft,
  selected,
  dirty,
  onOpen,
}: {
  draft: ActivityDraft;
  /** Its thread is the one open. */
  selected: boolean;
  dirty: boolean;
  onOpen: () => void;
}) {
  const qc = useQueryClient();
  const text = useDraft(draft.key).replace(/\s+/g, " ").trim();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const { chat, project } = draft;
  // A review starts from its setup, not from a message.
  const sendable =
    !draft.reply && (!!chat || loadDraftScope(draft.id).kind !== "review");
  const open = () => {
    if (!dirty && !selected) onOpen();
  };
  async function send() {
    // The open draft goes through its composer, exactly as if sent there.
    if (selected) {
      document
        .querySelector<HTMLFormElement>(
          ".project-chat-pane form.project-composer:not(.deep-review-composer)",
        )
        ?.requestSubmit();
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      if (await sendDraft(qc, draft)) return;
      if (dirty)
        setError(
          "Save or close the edited file, then send it from its thread.",
        );
      else onOpen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={dirty}
      aria-current={selected || undefined}
      className={`sb-card draft ${selected ? "selected" : ""}`}
      title={chat ? `Draft in ${chat.title}` : `New thread in ${project.name}`}
      onClick={open}
      onKeyDown={rowKeys(open)}
    >
      <div className="sb-card-top">
        <SquarePen size={14} className="sb-draft-icon" aria-label="Draft" />
        <ProjectBadge id={project.id} name={project.name} />
        <span className="sb-card-name">
          <span className="sb-card-project">{project.name}</span>
        </span>
        {sendable && (
          <div className="sb-card-actions">
            <button
              className="sb-card-action icon"
              aria-label="Send draft"
              title={
                chat ? `Send to ${chat.title}` : `Start it in ${project.name}`
              }
              disabled={sending}
              onClick={(e) => {
                e.stopPropagation();
                void send();
              }}
            >
              <ArrowUp size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="sb-draft-text">{text}</div>
      {error && (
        <div className="sb-draft-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
