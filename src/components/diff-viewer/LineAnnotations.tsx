import { Bookmark, X } from "lucide-react";
import type { Side } from "../../../shared/types";
import type { LineNotes } from "../../lib/diff-annotations";
import type { LineComposer } from "../../lib/useLineComposer";
import { IconButton } from "../ui";
import { DiagnosticMessage } from "../ProjectChecks";
import { DraftComment, NewComment, ThreadComment } from "./LineComments";

export interface NoteActions {
  addDraft: (
    path: string,
    line: number,
    side: Side,
    body: string,
    id: string,
  ) => void;
  removeDraft: (id: string) => void;
  onReply: (id: number, body: string) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => Promise<void>;
  onCodex: (t: {
    path: string;
    line: number;
    side: Side;
    body: string;
  }) => void;
  onError: (e: unknown) => void;
  onRemoveMark: (id: string) => void;
}

/** Everything under one line of the diff: problems, marks, comments and drafts. */
export function LineAnnotations({
  notes,
  path,
  composer,
  actions,
}: {
  notes: LineNotes;
  path: string;
  composer: LineComposer;
  actions: NoteActions;
}) {
  const { addDraft, removeDraft, onCodex } = actions;
  return (
    <div className="line-annotations">
      {notes.diagnostics.map((d, i) => (
        <div className={`inline-diagnostic ${d.severity}`} key={i}>
          <DiagnosticMessage diagnostic={d} />
        </div>
      ))}
      {notes.marks.map((m) => (
        <div className="line-bookmark" key={m.id}>
          <Bookmark size={13} />
          <span>
            Marked for later · lines {m.start}–{m.end}
          </span>
          <IconButton
            label="Remove line mark"
            onClick={() => actions.onRemoveMark(m.id)}
          >
            <X size={13} />
          </IconButton>
        </div>
      ))}
      {notes.comments.map((c) => (
        <ThreadComment
          key={c.id}
          comment={c}
          onReply={actions.onReply}
          onResolve={actions.onResolve}
          onCodex={() =>
            onCodex({ path, line: notes.line, side: notes.side, body: c.body })
          }
          onError={actions.onError}
        />
      ))}
      {notes.drafts.map((d) => (
        <DraftComment
          key={d.id}
          draft={d}
          onChange={(body) => addDraft(d.path, d.line, d.side, body, d.id)}
          onRemove={() => removeDraft(d.id)}
          onCodex={() =>
            onCodex({ path: d.path, line: d.line, side: d.side, body: d.body })
          }
        />
      ))}
      {notes.composer && (
        <NewComment
          body={composer.body()}
          onChange={composer.change}
          onSave={composer.save}
          onCancel={composer.cancel}
        />
      )}
    </div>
  );
}
