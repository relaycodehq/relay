import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Upload } from "lucide-react";
import type { Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import type { CreatedPullRequest } from "../../shared/pull-request-create";
import { api } from "../lib/api";
import { ErrorBox, Loading, Modal } from "./ui";
/** With `chatId`, a PR of that thread's worktree: its changes as one commit on the checkout's. */
export function CreatePullSheet({
  project,
  chatId,
  onClose,
  onReview,
  onChanges,
}: {
  project: Project;
  chatId?: string;
  onClose: () => void;
  onReview: (ref: PullRef) => void;
  onChanges?: () => void;
}) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["create-pull-preview", project.id, chatId],
    queryFn: () => api.projectPreparePull(project.id, chatId),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [base, setBase] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<CreatedPullRequest>();
  const initialized = useRef(false);
  useEffect(() => {
    if (preview.data && !initialized.current) {
      initialized.current = true;
      setBase(preview.data.base);
      setTitle(preview.data.title);
    }
  }, [preview.data]);
  const p = preview.data;
  const duplicate = p?.existing.find((pr) => pr.base === base);
  async function submit() {
    if (!p || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.projectCreatePull(
        project.id,
        {
          planId: p.id,
          base,
          title,
          body,
          draft,
          push: p.needsPush,
        },
        chatId,
      );
      if (chatId)
        await qc.invalidateQueries({ queryKey: ["worktree", chatId] });
      setResult(created);
      await qc.invalidateQueries({ queryKey: ["branch-pulls", project.id] });
      await qc.invalidateQueries({
        queryKey: ["working-tree", "project", project.id],
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        result
          ? `PR #${result.pull.ref.number} is ready`
          : "Create pull request"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      className="create-pull-sheet"
    >
      {result ? (
        <>
          <p>{result.pull.title}</p>
          {result.warning && <p role="alert">{result.warning}</p>}
          <button className="primary" onClick={() => onReview(result.pull.ref)}>
            Review this PR
          </button>
        </>
      ) : (
        <>
          {preview.isPending && <Loading text="Checking this branch…" />}
          {!!preview.error && (
            <>
              <ErrorBox error={preview.error} />
              <button onClick={() => void preview.refetch()}>Retry</button>
            </>
          )}
          {p && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="pr-branch-route">
                <code>{p.branch}</code>
                <ArrowRight size={16} />
                <label>
                  Target branch
                  <select
                    aria-label="PR target branch"
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Choose target branch
                    </option>
                    {p.bases.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Title
                <input
                  aria-label="PR title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={250}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Description
                <textarea
                  aria-label="PR description"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={64000}
                  rows={7}
                  disabled={busy}
                  placeholder="What changed, and how did you test it?"
                />
              </label>
              <label className="pr-draft">
                <input
                  type="checkbox"
                  checked={draft}
                  onChange={(e) => setDraft(e.target.checked)}
                  disabled={busy}
                />
                Draft PR <span className="muted">(WIP:)</span>
              </label>
              {!!p.dirtyFiles &&
                (chatId ? (
                  <p className="pr-local-note">
                    {p.dirtyFiles} {p.dirtyFiles === 1 ? "file" : "files"}{" "}
                    uncommitted in the checkout when this worktree started{" "}
                    {p.dirtyFiles === 1 ? "is" : "are"} left out.
                  </p>
                ) : (
                  <p className="pr-local-note">
                    {p.dirtyFiles} uncommitted{" "}
                    {p.dirtyFiles === 1 ? "file is" : "files are"} excluded.{" "}
                    <button type="button" onClick={onChanges} disabled={busy}>
                      Review local changes
                    </button>
                  </p>
                ))}
              {p.needsPush && (
                <div className="pr-push-preview">
                  <p>
                    <Upload size={14} /> Push <strong>{p.branch}</strong> to{" "}
                    {p.destination}
                    {p.remote ? ` (${p.remote})` : ""}
                  </p>
                  <small>Commit {p.head.slice(0, 12)} · no force push</small>
                  {!!p.commits.length && (
                    <details>
                      <summary>
                        {p.commits.length === 100
                          ? "Latest 100"
                          : p.commits.length}{" "}
                        commits to publish
                      </summary>
                      <ul>
                        {p.commits.map((c) => (
                          <li key={c.sha}>
                            <code>{c.sha.slice(0, 7)}</code> {c.subject}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {!p.remote && (
                    <p role="alert">
                      No push remote matches this Gitea repository. Configure a
                      matching remote first.
                    </p>
                  )}
                </div>
              )}
              {!!error && <ErrorBox error={error} />}
              {duplicate ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => onReview(duplicate.ref)}
                >
                  Review existing PR #{duplicate.ref.number}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !title.trim() ||
                    !p.bases.includes(base) ||
                    (p.needsPush && !p.remote)
                  }
                >
                  {busy
                    ? "Creating…"
                    : p.needsPush
                      ? "Push & create PR"
                      : "Create PR"}
                </button>
              )}
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
