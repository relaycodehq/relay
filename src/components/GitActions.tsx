import { useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import {
  ChevronDown,
  CloudUpload,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
} from "lucide-react";
import type { Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import { api } from "../lib/api";
import { workingTreeKey } from "../lib/working-tree-key";
import { CreatePullSheet } from "./BranchPullRequest";
import { CommitSheet } from "./CommitSheet";
import { MergeSheet } from "./MergeSheet";
import { Spinner } from "./ui";
import "./git-actions.css";

type Action = "commit" | "commit_push" | "push" | "merge" | "pr";
export type GitActionsHandle = {
  /** Opens the branch's PR, as the PR button does. */
  openPr: () => void;
};
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
  ref,
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
  ref?: Ref<GitActionsHandle>;
  onConnect: () => void;
  onReview: (ref: PullRef) => void;
  onChanges: () => void;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const key = workingTreeKey(where);
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
  useImperativeHandle(ref, () => ({
    openPr() {
      if (!disabled && hasPr) openPr();
    },
  }));
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
