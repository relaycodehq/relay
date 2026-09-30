import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { GitAction, WorkingTree } from "../../shared/working-tree";
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
      let next = await api.projectGitAction(where, {
        kind: "commit",
        revision: tree.revision,
        message,
        paths: selected,
      } satisfies GitAction);
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
