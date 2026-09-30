import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  checkoutChanged,
  type GitAction,
  type WorkingTree,
} from "../../shared/working-tree";
import { api } from "../lib/api";
import { keys } from "../lib/mod-key";
import { workingTreeKey } from "../lib/working-tree-key";
import { CommitFileList } from "./CommitFileList";
import { ErrorBox, IconButton, Modal, Spinner } from "./ui";
import "./commit-sheet.css";

/** Where git's own tools start wrapping or cutting a subject. */
const SUBJECT_LIMIT = 72;

export function CommitSheet({
  where,
  tree,
  push,
  onClose,
}: {
  where: string;
  /** Kept current by the poll, so the commit checks the latest revision. */
  tree: WorkingTree;
  push: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const key = workingTreeKey(where);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const typed = useRef(false);
  const files = tree.changes.filter((c) => !c.conflict);
  const selected = files
    .filter((c) => !excluded.has(c.path))
    .map((c) => c.path);
  // Files this sheet has listed; ones that leave while HEAD moves were
  // committed by someone else (an agent, a terminal) while it was open.
  const openedAt = useRef(tree.head);
  const listed = useRef(new Set<string>());
  for (const c of files) listed.current.add(c.path);
  const live = new Set(files.map((c) => c.path));
  const committed =
    tree.head === openedAt.current
      ? []
      : [...listed.current].filter((p) => !live.has(p));
  const allCommitted = !files.length && committed.length > 0;
  const headSubject = tree.outgoing.find((c) => c.sha === tree.head)?.subject;
  const generation = useRef(0);
  async function write(paths: string[]) {
    if (!paths.length) return;
    const id = ++generation.current;
    setWriting(true);
    setError(undefined);
    try {
      const next = await api.projectCommitMessage(where, paths);
      if (id === generation.current && !typed.current) setMessage(next);
    } catch (e) {
      if (id === generation.current) setError(e);
    } finally {
      if (id === generation.current) setWriting(false);
    }
  }
  useEffect(() => {
    void write(selected);
  }, []);
  // The drafted message still describes the files that left.
  useEffect(() => {
    if (committed.length && selected.length && !typed.current)
      void write(selected);
  }, [committed.length]);
  async function submit() {
    if (
      busy ||
      (writing && !typed.current) ||
      !message.trim() ||
      !selected.length
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      // The poll can be up to 3s old; don't commit files that already left.
      const fresh = await qc.fetchQuery({
        queryKey: key,
        queryFn: () => api.projectWorkingTree(where),
        staleTime: 0,
      });
      const changed = new Set(fresh.changes.map((c) => c.path));
      if (!selected.every((p) => changed.has(p))) {
        if (fresh.head === openedAt.current)
          setError(
            new Error(
              `${checkoutChanged} Review the refreshed changes and try again.`,
            ),
          );
        return;
      }
      let next = await api.projectGitAction(where, {
        kind: "commit",
        revision: fresh.revision,
        message,
        paths: selected,
      } satisfies GitAction);
      // Our own commit; a failed push below shouldn't read as someone else's.
      openedAt.current = next.head;
      qc.setQueryData(key, next);
      if (push) {
        next = await api.projectGitAction(where, {
          kind: "push",
          revision: next.revision,
        });
        qc.setQueryData(key, next);
      }
      onClose();
    } catch (e) {
      setError(e);
      void qc.invalidateQueries({ queryKey: key });
    } finally {
      setBusy(false);
    }
  }
  async function pushOnly() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(
        key,
        await api.projectGitAction(where, {
          kind: "push",
          revision: tree.revision,
        }),
      );
      onClose();
    } catch (e) {
      setError(e);
      void qc.invalidateQueries({ queryKey: key });
    } finally {
      setBusy(false);
    }
  }
  const canPush =
    push && !!tree.pushTarget && (tree.ahead > 0 || !tree.upstream);
  const toggle = (paths: string[]) =>
    setExcluded((s) => {
      const next = new Set(s);
      const allIn = paths.every((p) => !s.has(p));
      for (const p of paths) {
        if (allIn) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  const subject = message.split("\n", 1)[0].trim().length;
  return (
    <Modal
      title={push ? "Commit & push" : "Commit"}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="create-pull-sheet commit-sheet"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <CommitRoute tree={tree} push={push} />
        {committed.length > 0 && (
          <p className="commit-sheet-note" role="status">
            {allCommitted
              ? "Already committed while this was open"
              : `${committed.length === 1 ? "1 file was" : `${committed.length} files were`} committed while this was open`}
            {headSubject && (
              <>
                : <q>{headSubject}</q>
              </>
            )}
          </p>
        )}
        {allCommitted ? (
          <>
            {!!error && <ErrorBox error={error} />}
            <button
              type="button"
              className="primary commit-submit"
              disabled={busy}
              onClick={() => (canPush ? void pushOnly() : onClose())}
            >
              {busy ? "Pushing…" : canPush ? "Push" : "Close"}
            </button>
          </>
        ) : (
          <>
            <fieldset className="commit-files-fieldset" disabled={busy}>
              <CommitFileList
                files={files}
                excluded={excluded}
                onToggle={toggle}
                lines={tree.lines}
              />
            </fieldset>
            <div className="commit-message">
              <span className="commit-message-label">
                <span>Message</span>
                {subject > 0 && (
                  <span
                    className={`commit-subject-length ${subject > SUBJECT_LIMIT ? "long" : ""}`}
                    title="Subject line length"
                  >
                    {subject}/{SUBJECT_LIMIT}
                  </span>
                )}
                <IconButton
                  label="Write the message again"
                  onClick={() => {
                    typed.current = false;
                    void write(selected);
                  }}
                  disabled={writing || busy || !selected.length}
                >
                  {writing ? <Spinner size={13} /> : <RefreshCw size={13} />}
                </IconButton>
              </span>
              <textarea
                aria-label="Commit message"
                value={message}
                onChange={(e) => {
                  typed.current = true;
                  setMessage(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={writing ? "Writing a message…" : "Commit message"}
                rows={5}
                maxLength={16000}
                disabled={busy}
              />
            </div>
            {!!error && <ErrorBox error={error} />}
            <button
              className="primary commit-submit"
              disabled={
                busy ||
                (writing && !typed.current) ||
                !message.trim() ||
                !selected.length
              }
            >
              {busy ? (
                push ? (
                  "Committing and pushing…"
                ) : (
                  "Committing…"
                )
              ) : (
                <>
                  Commit{" "}
                  {selected.length === files.length
                    ? ""
                    : `${selected.length} of ${files.length} files `}
                  {push && "& push"}
                  <kbd>{keys("⌘↵", "Ctrl+↵")}</kbd>
                </>
              )}
            </button>
          </>
        )}
      </form>
    </Modal>
  );
}

/** The branch, and where it pushes: just the remote when the names match. */
function CommitRoute({ tree, push }: { tree: WorkingTree; push: boolean }) {
  const target = push ? tree.pushTarget : null;
  const remote =
    target?.endsWith(`/${tree.branch}`) &&
    target.slice(0, -tree.branch.length - 1);
  return (
    <p
      className="commit-sheet-route"
      title={target ? `${tree.branch} → ${target}` : tree.branch}
    >
      <code>{tree.branch}</code>
      {target && (
        <>
          <ArrowRight size={12} aria-label="then push to" />
          {remote || <code>{target}</code>}
        </>
      )}
    </p>
  );
}
