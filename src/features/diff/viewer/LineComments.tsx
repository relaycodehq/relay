import { useState } from "react";
import { MessageSquare, Terminal, Trash2 } from "lucide-react";
import type { Draft, ReviewComment } from "../../../../shared/types";
import { IconButton } from "../../../ui/ui";
import { RichText } from "../../../ui/RichText";

/** The box for a new line comment; its text is already a draft. */
export function NewComment({
  body,
  onChange,
  onSave,
  onCancel,
}: {
  body: string;
  onChange: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="inline-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSave();
      }}
    >
      <div className="comment-heading">
        <strong>New line comment</strong>
        <span>Local draft</span>
      </div>
      <textarea
        autoFocus
        aria-label="Line comment"
        placeholder="What needs a closer look? Markdown supported."
        rows={3}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim()) {
            e.preventDefault();
            onSave();
          }
        }}
      />
      <div className="inline-actions">
        <span>Publish when you finish your review</span>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={!body.trim()}>
          Add draft
        </button>
      </div>
    </form>
  );
}

/** A draft comment waiting for the review to be published. */
export function DraftComment({
  draft,
  onChange,
  onRemove,
  onCodex,
}: {
  draft: Draft;
  onChange: (s: string) => void;
  onRemove: () => void;
  onCodex: () => void;
}) {
  const [edit, setEdit] = useState(false);
  return (
    <article className="inline-comment draft">
      <div className="comment-heading">
        <strong>You</strong>
        <span className="draft-label">Pending review</span>
        <IconButton label="Delete draft comment" onClick={onRemove}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      {edit ? (
        <textarea
          aria-label="Edit draft comment"
          value={draft.body}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <RichText text={draft.body} />
      )}
      <div className="comment-actions">
        <button onClick={() => setEdit((v) => !v)}>
          {edit ? "Done" : "Edit"}
        </button>
        <button onClick={onCodex} disabled={!draft.body.trim()}>
          <Terminal size={13} />
          Fix with Codex
        </button>
      </div>
    </article>
  );
}

/** A published comment, with its reply and resolve. */
export function ThreadComment({
  comment,
  onReply,
  onResolve,
  onCodex,
  onError,
}: {
  comment: ReviewComment;
  onReply: (id: number, body: string) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => Promise<void>;
  onCodex: () => void;
  onError: (e: unknown) => void;
}) {
  const [reply, setReply] = useState(false),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <article className="inline-comment">
      <div className="comment-heading">
        <strong>{comment.user.login}</strong>
        <span>{comment.resolver ? "Resolved" : "Review comment"}</span>
      </div>
      <RichText text={comment.body} />
      <div className="comment-actions">
        <button
          onClick={() =>
            void onResolve(comment.id, !comment.resolver).catch(onError)
          }
        >
          {comment.resolver ? "Reopen" : "Resolve"}
        </button>
        <button onClick={() => setReply((v) => !v)}>
          <MessageSquare size={12} />
          Reply
        </button>
        <button onClick={onCodex}>
          <Terminal size={13} />
          Fix with Codex
        </button>
      </div>
      {reply && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onReply(comment.id, body);
              setBody("");
              setReply(false);
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            aria-label="Reply to line comment"
            placeholder="Reply…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <button className="primary" disabled={!body.trim() || busy}>
            {busy ? "Posting…" : "Post reply"}
          </button>
        </form>
      )}
    </article>
  );
}
