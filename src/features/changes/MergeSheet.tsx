import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { MergeResult } from "../../../shared/branch-merge";
import { api } from "../../lib/api";
import { parseWorkspaceId } from "../../../shared/workspaces";
import { workingTreeKey } from "../../lib/working-tree-key";
import { ErrorBox, Loading, Modal } from "../../ui/ui";

/** Merges the checkout's branch into another without leaving it, then offers to switch and clean up. */
export function MergeSheet({
  where,
  onClose,
}: {
  /** Workspace id; from a thread's worktree, `base` is the checkout's branch. */
  where: string;
  onClose: () => void;
}) {
  // A worktree can't switch to a branch the checkout has open, and its own
  // branch goes with the worktree.
  const inWorktree = !!parseWorkspaceId(where).chatId;
  const qc = useQueryClient();
  const [base, setBase] = useState<string>();
  const plan = useQuery({
    queryKey: ["merge-plan", where, "sheet", base],
    queryFn: () => api.projectMergePlan(where, base),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<MergeResult>();
  const [switched, setSwitched] = useState(false);
  const [caughtUp, setCaughtUp] = useState<string[]>();
  const p = plan.data;
  const refresh = () =>
    Promise.all(
      [
        workingTreeKey(where),
        ["project-branches", where],
        ["merge-plan", where],
      ].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
  async function step(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      void refresh();
    }
  }
  const merge = () =>
    step(async () => {
      if (!p) return;
      setResult(
        await api.projectMergeBranch(where, {
          branch: p.branch,
          head: p.head,
          base: p.base,
          baseHead: p.baseHead,
          push: push && !!p.pushTarget,
        }),
      );
    });
  const switchToBase = () =>
    step(async () => {
      const list = await api.projectBranches(where);
      const target = list.branches.find((b) => !b.remote && b.name === p!.base);
      if (!target) throw new Error(`${p!.base} no longer exists.`);
      await api.projectChangeBranch(where, {
        kind: "switch",
        name: target.ref,
        current: list.current,
        head: list.head,
      });
      setSwitched(true);
    });
  const deleteBranch = () =>
    step(async () => {
      await api.projectDeleteBranch(where, p!.branch);
      onClose();
    });
  const catchUp = () =>
    step(async () => {
      const { conflicts } = await api.projectCatchUp(where, p!.base);
      setCaughtUp(conflicts);
      if (!conflicts.length) setResult(undefined);
    });
  const commits = p?.commits.length ?? 0;
  const pushing = push && !!p?.pushTarget;
  return (
    <Modal
      title={result?.merged ? `Merged into ${result.base}` : "Merge branch"}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="create-pull-sheet merge-sheet"
    >
      {result?.merged && p ? (
        <div className="merge-done">
          <p>
            <code>{p.branch}</code> is in <code>{result.base}</code>
            {result.fastForward ? " (fast-forward)" : " as a merge commit"}
            {result.pushedTo ? (
              <>
                {" "}
                and pushed to <code>{result.pushedTo}</code>.
              </>
            ) : (
              "."
            )}
          </p>
          {!!error && <ErrorBox error={error} />}
          {inWorktree ? (
            <div className="merge-done-actions">
              <button className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          ) : switched ? (
            <div className="merge-done-actions">
              <button
                className="primary"
                onClick={deleteBranch}
                disabled={busy}
              >
                Delete {p.branch}
              </button>
              <button onClick={onClose} disabled={busy}>
                Keep it
              </button>
            </div>
          ) : (
            <div className="merge-done-actions">
              <button
                className="primary"
                onClick={switchToBase}
                disabled={busy}
              >
                Switch to {result.base}
              </button>
              <button onClick={onClose} disabled={busy}>
                Stay on {p.branch}
              </button>
            </div>
          )}
          {!inWorktree && !switched && !!p.uncommitted && (
            <small className="muted">
              Your {p.uncommitted} uncommitted{" "}
              {p.uncommitted === 1 ? "file comes" : "files come"} along when you
              switch.
            </small>
          )}
        </div>
      ) : (
        <>
          {plan.isPending && <Loading text="Checking the branches…" />}
          {!!plan.error && <ErrorBox error={plan.error} />}
          {p && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void merge();
              }}
            >
              <div className="pr-branch-route">
                <code>{p.branch}</code>
                <ArrowRight size={16} />
                <label>
                  Into
                  <select
                    aria-label="Merge target branch"
                    value={p.base}
                    onChange={(e) => {
                      setResult(undefined);
                      setBase(e.target.value);
                    }}
                    disabled={busy}
                  >
                    {p.bases.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {commits ? (
                <details className="merge-commits">
                  <summary>
                    {commits === 50 ? "Latest 50" : commits}{" "}
                    {commits === 1 ? "commit" : "commits"} ·{" "}
                    {p.fastForward ? "fast-forward" : "creates a merge commit"}
                  </summary>
                  <ul>
                    {p.commits.map((c) => (
                      <li key={c.sha}>
                        <code>{c.sha.slice(0, 7)}</code> {c.subject}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="pr-local-note">
                  {p.base} already has everything on {p.branch}.
                </p>
              )}
              {p.pushTarget && (
                <label className="pr-draft">
                  <input
                    type="checkbox"
                    checked={push}
                    onChange={(e) => setPush(e.target.checked)}
                    disabled={busy}
                  />
                  Push {p.base} to <code>{p.pushTarget}</code>
                </label>
              )}
              {!!p.uncommitted && (
                <p className="pr-local-note">
                  {p.uncommitted} uncommitted{" "}
                  {p.uncommitted === 1 ? "file stays" : "files stay"} in your
                  checkout and {p.uncommitted === 1 ? "isn't" : "aren't"}{" "}
                  merged.
                </p>
              )}
              {p.checkedOutAt && (
                <p className="pr-local-note" title={p.checkedOutAt}>
                  Also moves {p.base} where it's checked out, in{" "}
                  <code>{p.checkedOutAt.split("/").pop()}</code>. Uncommitted
                  edits there stay; if one touches a file this merge changes,
                  nothing happens.
                </p>
              )}
              {!!p.snapshots && (
                <p className="pr-local-note">
                  Includes{" "}
                  {p.snapshots === 1 ? "a commit" : `${p.snapshots} commits`}{" "}
                  Relay made of the checkout's uncommitted edits when this
                  worktree started; merging lands those edits too.
                </p>
              )}
              {caughtUp?.length ? (
                <div role="alert" className="merge-conflicts">
                  <p>
                    {p.base} is merged into {p.branch}, with conflicts marked in
                    these files. Resolve them in Changes (or ask the agent),
                    commit, then merge again.
                  </p>
                  <ul>
                    {caughtUp.map((path) => (
                      <li key={path}>
                        <code>{path}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                result &&
                !result.merged && (
                  <div role="alert" className="merge-conflicts">
                    <p>
                      These files conflict, so nothing was merged. Catch{" "}
                      {p.branch} up with {p.base} first, then resolve them
                      there.
                    </p>
                    <ul>
                      {result.conflicts.map((path) => (
                        <li key={path}>
                          <code>{path}</code>
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={catchUp} disabled={busy}>
                      Merge {p.base} into {p.branch}
                    </button>
                  </div>
                )
              )}
              {!!error && <ErrorBox error={error} />}
              <button
                className="primary"
                disabled={busy || !commits || !!caughtUp?.length}
              >
                {busy
                  ? "Merging…"
                  : pushing
                    ? `Merge & push ${p.base}`
                    : `Merge into ${p.base}`}
              </button>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
