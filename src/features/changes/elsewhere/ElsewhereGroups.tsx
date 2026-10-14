import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type {
  ElsewhereAuthor,
  ElsewhereFile,
  ElsewhereGroup,
} from "../../../../shared/elsewhere";
import { api } from "../../../lib/api";
import { errorMessage } from "../../../lib/error-message";
import { FileEntryIcon } from "../../../ui/FileEntryIcon";
import { MiddleTruncate } from "../../../ui/MiddleTruncate";
import { elsewhereKey, type ElsewherePick } from "./useElsewhere";
import "./elsewhere.css";

/** Who changed a file, under its name: the threads it started, by title. */
export function ChangedBy({
  by,
  own,
  onOpenThread,
}: {
  by: ElsewhereAuthor[];
  own?: boolean;
  onOpenThread?: (chatId: string) => void;
}) {
  if (!by.length) return null;
  return (
    <span
      className="change-by"
      title={`Changed by ${own ? "this thread and " : ""}${by.map((a) => a.title).join(", ")}`}
    >
      {own && "this thread + "}
      {by.map((a, i) => (
        <span key={a.chatId}>
          {i > 0 && ", "}
          {onOpenThread ? (
            <button
              type="button"
              title="Open this thread"
              onClick={() => onOpenThread(a.chatId)}
            >
              {a.title}
            </button>
          ) : (
            a.title
          )}
        </span>
      ))}
    </span>
  );
}

const kindOf = (f: ElsewhereFile) =>
  f.deleted ? "deleted" : f.added ? "added" : "modified";

/** Other repositories the thread's agents changed, each under its name with its own commit. */
export function ElsewhereGroups({
  chatId,
  groups,
  selected,
  onPick,
  onOpenThread,
}: {
  chatId: string;
  groups: ElsewhereGroup[];
  selected: ElsewherePick | null;
  onPick: (pick: ElsewherePick) => void;
  onOpenThread?: (chatId: string) => void;
}) {
  return groups.map((g) => (
    <Group
      key={g.root}
      chatId={chatId}
      group={g}
      selected={selected}
      onPick={onPick}
      onOpenThread={onOpenThread}
    />
  ));
}

function Group({
  chatId,
  group: g,
  selected,
  onPick,
  onOpenThread,
}: {
  chatId: string;
  group: ElsewhereGroup;
  selected: ElsewherePick | null;
  onPick: (pick: ElsewherePick) => void;
  onOpenThread?: (chatId: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true),
    [message, setMessage] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const additions = g.files.reduce((n, f) => n + f.additions, 0),
    deletions = g.files.reduce((n, f) => n + f.deletions, 0);
  async function commit() {
    if (!message?.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.threadElsewhereCommit(
        chatId,
        g.root,
        g.revision,
        message,
      );
      qc.setQueryData(elsewhereKey(chatId), next);
      setMessage(null);
    } catch (e) {
      setError(errorMessage(e));
      void qc.invalidateQueries({ queryKey: elsewhereKey(chatId) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="elsewhere-group" aria-label={g.name}>
      <header>
        <button
          className="change-section-toggle"
          aria-label={g.name}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={13} />
        </button>
        <strong title={g.root}>{g.name}</strong>
        <span className="elsewhere-branch">{g.branch}</span>
        <span className="elsewhere-lines">
          <span className="added">+{additions}</span>{" "}
          <span className="deleted">−{deletions}</span>
        </span>
        {message === null && (
          <button
            className="elsewhere-commit-open"
            title={`Commit these ${g.files.length === 1 ? "file" : `${g.files.length} files`} in ${g.root}`}
            onClick={() => setMessage("")}
          >
            Commit
          </button>
        )}
      </header>
      {message !== null && (
        <form
          className="elsewhere-commit"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <input
            autoFocus
            aria-label={`Commit message for ${g.name}`}
            placeholder="Commit message"
            value={message}
            maxLength={16000}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setMessage(null);
            }}
          />
          <button className="primary" disabled={busy || !message.trim()}>
            {busy ? "Committing…" : "Commit"}
          </button>
        </form>
      )}
      {error && (
        <p className="elsewhere-error" role="alert">
          {error}
        </p>
      )}
      {open &&
        g.files.map((f) => {
          const slash = f.path.lastIndexOf("/"),
            kind = kindOf(f),
            picked = selected?.root === g.root && selected.path === f.path;
          return (
            <div
              key={f.path}
              className={`working-file elsewhere-file ${picked ? "selected" : ""}`}
            >
              <button
                className="change-select"
                aria-label={`${f.path} in ${g.name}`}
                title={`${g.root}/${f.path}`}
                onClick={() => onPick({ root: g.root, path: f.path })}
              >
                <FileEntryIcon path={f.path} directory={false} />
                <span className={`change-name ${kind}`}>
                  <MiddleTruncate
                    text={f.path.slice(slash + 1)}
                    kind="path"
                    title={null}
                  />
                </span>
                {slash > 0 && (
                  <span className="change-dir">{f.path.slice(0, slash)}</span>
                )}
                <span className="elsewhere-lines">
                  <span className="added">+{f.additions}</span>{" "}
                  <span className="deleted">−{f.deletions}</span>
                </span>
              </button>
              <ChangedBy by={f.by} own={f.own} onOpenThread={onOpenThread} />
            </div>
          );
        })}
    </section>
  );
}
