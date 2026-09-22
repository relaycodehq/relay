import { LiveSyncControls } from "./LiveSyncControls";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, GitBranch, Plus, Minus, RefreshCw } from "lucide-react";
import type { Pull } from "../../shared/types";
import type { ChangeArea, GitAction } from "../../shared/working-tree";
import { api } from "../lib/api";
import { ErrorBox, IconButton, Loading, Modal } from "./ui";
import { WorkingDiff } from "./WorkingDiff";
import "./working-tree.css";
export function LocalChanges({
  pull,
  projectId,
  onSelection,
}: {
  pull?: Pull;
  projectId?: string;
  onSelection?: (path: string | null) => void;
}) {
  const qc = useQueryClient(),
    key = projectId
      ? ["working-tree", "project", projectId]
      : ["working-tree", pull!.owner, pull!.name];
  const storageKey = projectId ? "relay-project-changes:" + projectId : null;
  const [saved] = useState(() => {
    try {
      return storageKey
        ? JSON.parse(localStorage.getItem(storageKey) || "null")
        : null;
    } catch {
      return null;
    }
  });
  const [selected, setSelected] = useState<{
      path: string;
      area: ChangeArea;
    } | null>(() =>
      typeof saved?.selected?.path === "string" &&
      ["staged", "unstaged"].includes(saved.selected.area)
        ? saved.selected
        : null,
    ),
    [message, setMessage] = useState(
      typeof saved?.message === "string" ? saved.message : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(""),
    [push, setPush] = useState(false);
  useEffect(() => {
    if (storageKey)
      localStorage.setItem(storageKey, JSON.stringify({ selected, message }));
  }, [storageKey, selected, message]);
  useEffect(() => {
    onSelection?.(selected?.path ?? null);
  }, [selected?.path]);
  const state = useQuery({
    queryKey: key,
    queryFn: () =>
      projectId ? api.projectWorkingTree(projectId) : api.workingTree(pull!),
    refetchInterval: busy ? false : 3000,
  });
  const tree = state.data;
  const diff = useQuery({
    queryKey: [...key, "diff", selected?.path, selected?.area, tree?.revision],
    queryFn: () =>
      projectId
        ? api.projectWorkingDiff(projectId, selected!.path, selected!.area)
        : api.workingDiff(pull!, selected!.path, selected!.area),
    enabled: !!selected && !!tree,
    gcTime: 0,
  });
  useEffect(() => {
    if (!selected || !tree) return;
    const change = tree.changes.find((c) => c.path === selected.path);
    if (!change) {
      setSelected(null);
      return;
    }
    if (
      selected.area === "unstaged" &&
      change.worktree === " " &&
      !change.conflict
    )
      setSelected({ ...selected, area: "staged" });
    if (
      selected.area === "staged" &&
      (change.index === " " || change.index === "?")
    )
      setSelected({ ...selected, area: "unstaged" });
  }, [tree, selected]);
  async function act(action: GitAction) {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const next = await (projectId
        ? api.projectGitAction(projectId, action)
        : api.gitAction(pull!, action));
      qc.setQueryData(key, next);
      if (action.kind === "commit") {
        setMessage("");
        setNotice(
          "Committed locally. Push when you’re ready to share the commit.",
        );
      }
      if (action.kind === "push") {
        setPush(false);
        setNotice("Pushed successfully.");
      }
    } catch (e) {
      setError(e);
      await state.refetch();
    } finally {
      setBusy(false);
    }
  }
  const sections = tree
    ? [
        {
          area: "staged" as const,
          title: "Staged changes",
          files: tree.changes.filter((c) => c.index !== " " && c.index !== "?"),
          kind: "unstage" as const,
        },
        {
          area: "unstaged" as const,
          title: "Working changes",
          files: tree.changes.filter((c) => c.worktree !== " " || c.conflict),
          kind: "stage" as const,
        },
      ]
    : [];
  return (
    <section className="local-changes" aria-label="Local changes">
      <header className="working-toolbar">
        <GitBranch size={15} />
        <strong>{tree?.branch || "Local checkout"}</strong>
        {tree?.upstream && (
          <span className="muted">
            {tree.ahead} ahead · {tree.behind} behind
          </span>
        )}
        <span className="spacer" />
        {pull && <LiveSyncControls pull={pull} />}
        <IconButton
          label="Refresh local changes"
          disabled={busy}
          onClick={() => void state.refetch()}
        >
          <RefreshCw size={15} />
        </IconButton>
        <button
          disabled={
            busy || !tree?.pushTarget || !!tree.operation || !tree.branch
          }
          onClick={() => setPush(true)}
        >
          <ArrowUp size={15} />
          Push…
        </button>
      </header>
      {state.error && (
        <>
          <ErrorBox error={state.error} />
          {pull && (
            <button
              onClick={() =>
                void api
                  .linkFolder(pull)
                  .then(() => state.refetch())
                  .catch(setError)
              }
            >
              Link local folder
            </button>
          )}
        </>
      )}
      {!!error && <ErrorBox error={error} />}
      {notice && (
        <p className="working-notice" role="status">
          {notice}
        </p>
      )}
      {tree?.operation && (
        <p role="status" className="working-notice">
          Git operation in progress: {tree.operation}. Finish it in your
          terminal before committing here.
        </p>
      )}
      {state.isPending ? (
        <Loading text="Reading local changes…" />
      ) : (
        tree && (
          <div className="working-content">
            <aside className="working-sidebar">
              <div className="working-file-list">
                {sections.map((s) => (
                  <section key={s.area}>
                    <header>
                      <strong>
                        {s.title} <span>{s.files.length}</span>
                      </strong>
                      <button
                        disabled={busy || !s.files.length}
                        onClick={() =>
                          void act({
                            kind: s.kind,
                            revision: tree.revision,
                            paths: s.files.map((c) => c.path),
                          })
                        }
                      >
                        {s.kind === "stage" ? "Stage all" : "Unstage all"}
                      </button>
                    </header>
                    {s.files.map((c) => (
                      <div
                        className={`working-file ${selected?.path === c.path && selected.area === s.area ? "selected" : ""}`}
                        key={c.path}
                      >
                        <button
                          className="working-select"
                          title={c.path}
                          onClick={() =>
                            setSelected({ path: c.path, area: s.area })
                          }
                        >
                          <span className={c.conflict ? "deletions" : "muted"}>
                            {c.conflict
                              ? "!"
                              : s.area === "staged"
                                ? c.index
                                : c.worktree}
                          </span>
                          <span>{c.path}</span>
                        </button>
                        <IconButton
                          label={`${s.kind === "stage" ? "Stage" : "Unstage"} ${c.path}`}
                          disabled={busy}
                          onClick={() =>
                            void act({
                              kind: s.kind,
                              revision: tree.revision,
                              paths: [c.path],
                            })
                          }
                        >
                          {s.kind === "stage" ? (
                            <Plus size={14} />
                          ) : (
                            <Minus size={14} />
                          )}
                        </IconButton>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
              <form
                className="working-commit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({
                    kind: "commit",
                    revision: tree.revision,
                    message,
                  });
                }}
              >
                <textarea
                  aria-label="Commit message"
                  placeholder="Commit message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  maxLength={16000}
                />
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !message.trim() ||
                    !sections[0]?.files.length ||
                    tree.changes.some((c) => c.conflict) ||
                    !!tree.operation ||
                    !tree.branch
                  }
                >
                  {busy ? "Working…" : "Commit staged changes"}
                </button>
                <small>
                  Commits contain staged changes only. Unsaved editor buffers
                  aren’t included.
                </small>
              </form>
            </aside>
            <div className="working-review">
              {selected ? (
                <>
                  <header>
                    <strong title={selected.path}>{selected.path}</strong>
                    <span>
                      {selected.area === "staged"
                        ? "HEAD → Index"
                        : "Index → Working file"}
                    </span>
                  </header>
                  {diff.error ? (
                    <ErrorBox error={diff.error} />
                  ) : diff.data ? (
                    <WorkingDiff pair={diff.data} />
                  ) : (
                    <Loading text="Loading local diff…" />
                  )}
                </>
              ) : (
                <div className="empty">
                  <h2>
                    {tree.changes.length
                      ? "Your changes, before the commit."
                      : "Working tree is clean."}
                  </h2>
                  <p>Select a file to review its local diff.</p>
                </div>
              )}
            </div>
          </div>
        )
      )}
      {push && tree && (
        <Modal title="Push commits" onClose={() => !busy && setPush(false)}>
          <p>
            Push <strong>{tree.branch}</strong> to{" "}
            <strong>{tree.pushTarget}</strong>.
          </p>
          <p className="muted">
            <code>{tree.pushUrl}</code>
          </p>
          <p className="muted">
            Only commits are published. Uncommitted changes aren’t pushed
            {tree.upstream
              ? ". Counts reflect the last Git fetch."
              : ". This sets the branch’s upstream."}
          </p>
          {tree.outgoing.length > 0 && (
            <ul className="outgoing-commits">
              {tree.outgoing.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha.slice(0, 7)}</code> {c.subject}
                </li>
              ))}
            </ul>
          )}
          {!!error && <ErrorBox error={error} />}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void act({ kind: "push", revision: tree.revision })}
          >
            {busy ? "Pushing…" : `Push to ${tree.pushTarget}`}
          </button>
        </Modal>
      )}
    </section>
  );
}
