import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import {
  ChevronDown,
  CloudUpload,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import type { Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import type { GitAction, WorkingTree } from "../../shared/working-tree";
import { api } from "../lib/api";
import { CreatePullSheet } from "./BranchPullRequest";
import { MergeSheet } from "./MergeSheet";
import { ErrorBox, IconButton, Modal, Spinner } from "./ui";
import "./git-actions.css";

type Action = "commit" | "commit_push" | "push" | "merge" | "pr";
const MAX_COMMIT_FILES = 1000;

/**
 * The header's Commit & push button; Commit, Push, Merge and the branch's PR
 * sit under its arrow. Without Gitea, merging leads once the work is committed.
 */
export function GitActions({
  project,
  where,
  connected,
  disabled,
  request,
  onConnect,
  onReview,
  onChanges,
  onError,
}: {
  project: Project;
  /** Workspace id: the checkout, or the thread's worktree and its branch. */
  where: string;
  connected: boolean;
  disabled: boolean;
  /** Bumped to open the branch's PR, as the PR button did. */
  request: number;
  onConnect: () => void;
  onReview: (ref: PullRef) => void;
  onChanges: () => void;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const key = ["working-tree", "project", where];
  // Refreshed by the shell's working-tree poll.
  const tree = useQuery({
    queryKey: key,
    queryFn: () => api.projectWorkingTree(where),
  });
  const existing = useQuery({
    queryKey: ["branch-pulls", where, tree.data?.branch, connected],
    queryFn: () => api.projectBranchPulls(where),
    enabled: connected && !!project.repository && !!tree.data?.branch,
    staleTime: 30000,
    refetchInterval: 60000,
  });
  // Fails on the main branch itself, which has nothing to merge into.
  const plan = useQuery({
    queryKey: ["merge-plan", where, tree.data?.branch, tree.data?.head],
    queryFn: () => api.projectMergePlan(where),
    enabled: !!tree.data?.branch,
    staleTime: 30000,
    retry: false,
  });
  const [committing, setCommitting] = useState<"commit" | "commit_push">();
  const [merging, setMerging] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);
  const [pushing, setPushing] = useState(false);
  const t = tree.data;
  const ready = !!t?.branch && !t.operation;
  const changes = t?.changes.length ?? 0;
  const canPush = ready && !!t?.pushTarget;
  const unpushed = !!t && (t.ahead > 0 || !t.upstream);
  const pulls = existing.data ?? [];
  const prLabel =
    pulls.length === 1
      ? `View PR #${pulls[0].ref.number}`
      : pulls.length
        ? `PRs (${pulls.length})`
        : "Create PR";
  const hasPr = !!project.repository;
  const mergeable = ready && !!plan.data?.commits.length;
  const primary: Action = changes
    ? canPush
      ? "commit_push"
      : "commit"
    : !hasPr && mergeable
      ? "merge"
      : canPush && unpushed
        ? "push"
        : hasPr
          ? "pr"
          : "push";
  const enabled: Record<Action, boolean> = {
    commit: ready && changes > 0 && changes <= MAX_COMMIT_FILES,
    commit_push: canPush && changes > 0 && changes <= MAX_COMMIT_FILES,
    push: canPush && !changes && unpushed && !pushing,
    merge: mergeable,
    pr: hasPr,
  };
  const labels: Record<Action, string> = {
    commit: "Commit",
    commit_push: "Commit & push",
    push: pushing ? "Pushing…" : "Push",
    merge: `Merge into ${plan.data?.base ?? "main"}`,
    pr: prLabel,
  };
  const icons: Record<Action, ReactNode> = {
    commit: <GitCommitHorizontal size={14} />,
    commit_push: <CloudUpload size={14} />,
    push: pushing ? <Spinner size={14} /> : <CloudUpload size={14} />,
    merge: <GitMerge size={14} />,
    pr: <GitPullRequest size={14} />,
  };
  function openPr() {
    if (!connected) return onConnect();
    if (pulls.length === 1) return onReview(pulls[0].ref);
    setCreatingPr(true);
  }
  async function push() {
    if (!t) return;
    setPushing(true);
    try {
      qc.setQueryData(
        key,
        await api.projectGitAction(where, {
          kind: "push",
          revision: t.revision,
        }),
      );
    } catch (e) {
      onError(e);
      void tree.refetch();
    } finally {
      setPushing(false);
    }
  }
  function run(action: Action) {
    if (disabled || !enabled[action]) return;
    if (action === "pr") openPr();
    else if (action === "push") void push();
    else if (action === "merge") setMerging(true);
    else setCommitting(action);
  }
  const seen = useRef(request);
  useEffect(() => {
    if (request !== seen.current) {
      seen.current = request;
      if (!disabled && hasPr) openPr();
    }
  }, [request]);
  if (!t) return null;
  const hint =
    primary === "commit_push"
      ? `Commit ${changes} ${changes === 1 ? "file" : "files"} and push to ${t.pushTarget}`
      : primary === "commit"
        ? `Commit ${changes} ${changes === 1 ? "file" : "files"} on ${t.branch || "this checkout"}`
        : primary === "push"
          ? `Push ${t.branch} to ${t.pushTarget}`
          : primary === "merge"
            ? `Merge ${t.branch} into ${plan.data?.base} without leaving it`
            : "Open or create a pull request for the current branch";
  const menu: Action[] = [
    "commit",
    "commit_push",
    "push",
    ...(plan.data ? ["merge" as const] : []),
    ...(hasPr ? ["pr" as const] : []),
  ];
  return (
    <>
      <div className="git-actions" role="group" aria-label="Git actions">
        <button
          className="git-actions-main"
          onClick={() => run(primary)}
          disabled={disabled || !enabled[primary]}
          title={hint}
        >
          {icons[primary]}
          {labels[primary]}
        </button>
        <Menu.Root>
          <Menu.Trigger
            className="git-actions-more"
            aria-label="More Git actions"
            disabled={disabled}
          >
            <ChevronDown size={13} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              className="composer-popup-positioner"
              align="end"
              sideOffset={6}
            >
              <Menu.Popup className="composer-select-popup git-actions-menu">
                {menu.map((action) => (
                  <Menu.Item
                    key={action}
                    className="composer-select-item"
                    disabled={!enabled[action]}
                    onClick={() => run(action)}
                  >
                    {icons[action]}
                    {labels[action]}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {committing && (
        <CommitSheet
          where={where}
          tree={t}
          push={committing === "commit_push"}
          onClose={() => setCommitting(undefined)}
        />
      )}
      {merging && (
        <MergeSheet where={where} onClose={() => setMerging(false)} />
      )}
      {creatingPr && (
        <CreatePullSheet
          where={where}
          onClose={() => setCreatingPr(false)}
          onReview={(ref) => {
            setCreatingPr(false);
            onReview(ref);
          }}
          onChanges={() => {
            setCreatingPr(false);
            onChanges();
          }}
        />
      )}
    </>
  );
}

function CommitSheet({
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
  const key = ["working-tree", "project", where];
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
  const toggle = (path: string) =>
    setExcluded((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
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
        <p className="commit-sheet-route">
          On <code>{tree.branch}</code>
          {push && tree.pushTarget && (
            <>
              , then push to <code>{tree.pushTarget}</code>
            </>
          )}
        </p>
        <fieldset className="commit-files" disabled={busy}>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={!excluded.size}
                ref={(el) => {
                  if (el)
                    el.indeterminate = !!excluded.size && !!selected.length;
                }}
                onChange={() =>
                  setExcluded(
                    excluded.size
                      ? new Set()
                      : new Set(files.map((c) => c.path)),
                  )
                }
              />
              {selected.length} of {files.length}{" "}
              {files.length === 1 ? "file" : "files"}
            </label>
          </legend>
          <ul>
            {files.map((c) => (
              <li key={c.path}>
                <label title={c.path}>
                  <input
                    type="checkbox"
                    checked={!excluded.has(c.path)}
                    onChange={() => toggle(c.path)}
                  />
                  <span className="commit-file-name">{c.path}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="commit-message">
          <span className="commit-message-label">
            Message
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
          className="primary"
          disabled={
            busy ||
            (writing && !typed.current) ||
            !message.trim() ||
            !selected.length
          }
        >
          {busy
            ? push
              ? "Committing and pushing…"
              : "Committing…"
            : push
              ? "Commit & push"
              : "Commit"}
        </button>
      </form>
    </Modal>
  );
}
