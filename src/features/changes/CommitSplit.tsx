import { useEffect, useRef, useState } from "react";
import type { CommitSplitPlan, SplitChange } from "../../../shared/commit-split";
import { choiceLabel } from "../../../shared/settings";
import type { WorkingTree } from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { useAISettings } from "../agents/useAISettings";
import { ErrorBox, FileEntryIcon, Modal, Spinner } from "../../ui/ui";
import "./changed-files.css";
import "./commit-split.css";

interface Draft {
  message: string;
  include: boolean;
}

/**
 * A model's split of the uncommitted changes into commits. Nothing is
 * committed until the user has read the plan and pressed Commit.
 */
export function CommitSplitSheet({
  where,
  onClose,
  onDone,
}: {
  where: string;
  onClose: () => void;
  onDone: (tree: WorkingTree, made: number) => void;
}) {
  const settings = useAISettings().data;
  const [plan, setPlan] = useState<CommitSplitPlan>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState("");
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  // Closing or planning again drops an answer still on its way.
  const generation = useRef(0);
  useEffect(() => {
    void replan("");
    return () => {
      generation.current++;
    };
  }, []);
  async function replan(guide: string) {
    const id = ++generation.current;
    setPlanning(true);
    setError(undefined);
    try {
      const next = await api.projectPlanCommitSplit(where, guide || undefined);
      if (id !== generation.current) return;
      setPlan(next);
      setDrafts(
        next.commits.map((c) => ({ message: c.message, include: !c.unplaced })),
      );
    } catch (e) {
      if (id === generation.current) setError(e);
    } finally {
      if (id === generation.current) setPlanning(false);
    }
  }
  const included = plan
    ? plan.commits.filter((_, i) => drafts[i]?.include)
    : [];
  const ready =
    !!plan &&
    !planning &&
    !busy &&
    included.length > 0 &&
    drafts.every((d) => !d.include || d.message.trim());
  async function commit() {
    if (!plan || !ready) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.projectApplyCommitSplit(where, {
        fingerprint: plan.fingerprint,
        commits: plan.commits.flatMap((c, i) =>
          drafts[i].include
            ? [{ message: drafts[i].message, changes: c.changes }]
            : [],
        ),
      });
      onDone(next, included.length);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const byId = new Map(plan?.changes.map((c) => [c.id, c]));
  const choice = settings
    ? choiceLabel(settings.split, settings.splitProvider)
    : "";
  return (
    <Modal
      title="Split into commits"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="create-pull-sheet commit-split-sheet"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void commit();
          }
        }}
      >
        {planning ? (
          <p className="split-planning" role="status">
            <Spinner size={13} />
            Planning commits{choice && ` with ${choice}`}…
          </p>
        ) : plan ? (
          <p className="split-route">
            Planned by {plan.plannedBy}. Each commit takes its changes as they
            are on disk; staging doesn’t matter. Unticked commits stay
            uncommitted.
          </p>
        ) : null}
        {plan && (
          <ol className="split-commits" aria-busy={planning}>
            {plan.commits.map((c, i) => {
              const draft = drafts[i];
              const changes = c.changes
                .map((id) => byId.get(id))
                .filter((x): x is SplitChange => !!x);
              return (
                <li
                  key={`${plan.fingerprint}-${i}`}
                  className={draft?.include ? undefined : "excluded"}
                >
                  <div className="split-commit-head">
                    <input
                      type="checkbox"
                      aria-label={`Include commit ${i + 1}`}
                      checked={!!draft?.include}
                      disabled={busy || planning}
                      onChange={(e) => update(i, { include: e.target.checked })}
                    />
                    <span>
                      {c.unplaced ? "Not placed by the model" : i + 1}
                    </span>
                    <Stat changes={changes} />
                  </div>
                  <textarea
                    aria-label={`Message for commit ${i + 1}`}
                    placeholder="Commit message"
                    value={draft?.message ?? ""}
                    onChange={(e) => update(i, { message: e.target.value })}
                    disabled={busy || planning || !draft?.include}
                    maxLength={16000}
                    rows={1}
                  />
                  <ul>
                    {changes.map((ch) => (
                      <ChangeRow key={ch.id} change={ch} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
        {!!error && <ErrorBox error={error} />}
        <div className="split-actions">
          <input
            aria-label="Guidance for another plan"
            placeholder="Plan again with a hint, like “keep the CSS with its component”"
            value={note}
            maxLength={2000}
            disabled={planning || busy}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                void replan(note.trim());
              }
            }}
          />
          <button
            type="button"
            disabled={planning || busy}
            onClick={() => void replan(note.trim())}
          >
            Plan again
          </button>
          <button className="primary" disabled={!ready}>
            {busy ? "Committing…" : `Commit ${included.length || ""}`.trim()}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Stat({ changes }: { changes: SplitChange[] }) {
  const add = changes.reduce((n, c) => n + c.additions, 0),
    del = changes.reduce((n, c) => n + c.deletions, 0);
  return (
    <span className="diff-stat">
      <span className="diff-stat-add">+{add}</span>
      <span className="diff-stat-del">−{del}</span>
    </span>
  );
}

const kind = {
  added: "added",
  deleted: "deleted",
  modified: "modified",
  renamed: "modified",
} as const;

function ChangeRow({ change }: { change: SplitChange }) {
  const slash = change.path.lastIndexOf("/");
  return (
    <li
      title={`${change.previousPath ? `${change.previousPath} → ` : ""}${change.path}`}
    >
      <FileEntryIcon path={change.path} directory={false} />
      <span className={`change-name ${kind[change.status]}`}>
        {change.path.slice(slash + 1)}
      </span>
      <span className="change-dir">
        {change.part ?? (slash > 0 ? change.path.slice(0, slash) : "")}
      </span>
      <span className="diff-stat">
        <span className="diff-stat-add">+{change.additions}</span>
        <span className="diff-stat-del">−{change.deletions}</span>
      </span>
    </li>
  );
}
