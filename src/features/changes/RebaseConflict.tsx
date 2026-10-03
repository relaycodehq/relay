import { FileWarning } from "lucide-react";
import type { Commit, RebaseResult } from "../../../shared/working-tree";
import "./rebase-conflict.css";

export type RebaseConflict = Extract<RebaseResult, { rebased: false }>;

const shown = 4;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the thread that resolves it is asked to do. */
export function resolvePrompt(branch: string, c: RebaseConflict) {
  return [
    `Rebase \`${branch}\` onto \`${c.upstream}\` and resolve the conflicts.`,
    "",
    `Relay tried and stopped: ${plural(c.incoming.length, "new commit")} on ${c.upstream} and our ${plural(c.outgoing.length, "local commit")} both change ${c.conflicts.map((f) => `\`${f}\``).join(", ")}.`,
    "",
    "- Keep what both sides meant. If a conflict needs a judgement call, stop and ask me.",
    "- Other threads may have uncommitted work in this folder. Leave it as it is (`git rebase --autostash`).",
    "- Run the checks that cover what you resolved.",
    "- Don't push.",
  ].join("\n");
}

function Commits({ title, commits }: { title: string; commits: Commit[] }) {
  return (
    <div className="rebase-conflict-side">
      <h5>
        {title} · {commits.length}
      </h5>
      <ul>
        {commits.slice(0, shown).map((c) => (
          <li key={c.sha}>
            <code>{c.sha}</code>
            <span>{c.subject}</span>
          </li>
        ))}
      </ul>
      {commits.length > shown && (
        <small>and {commits.length - shown} more</small>
      )}
    </div>
  );
}

/** Why the sync button couldn't rebase, and a thread to sort it out. */
export function RebaseConflictCard({
  conflict,
  onResolve,
}: {
  conflict: RebaseConflict;
  /** Unset where no thread can be started from here. */
  onResolve?: (draft: boolean) => void;
}) {
  return (
    <>
      <h3>Couldn’t rebase onto {conflict.upstream}</h3>
      <p>
        Both sides changed the same lines. The rebase was undone, so nothing in
        the project folder moved.
      </p>
      <Commits title="Incoming" commits={conflict.incoming} />
      <Commits title="Yours" commits={conflict.outgoing} />
      <div className="rebase-conflict-side">
        <h5>Conflicts in</h5>
        {conflict.conflicts.slice(0, shown).map((f) => (
          <div key={f} className="rebase-conflict-file">
            <FileWarning size={12} />
            <code>{f}</code>
          </div>
        ))}
        {conflict.conflicts.length > shown && (
          <small>and {conflict.conflicts.length - shown} more</small>
        )}
      </div>
      {onResolve && (
        <div className="rebase-conflict-actions">
          <button type="button" onClick={() => onResolve(true)}>
            Open as draft
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onResolve(false)}
          >
            Resolve in new thread
          </button>
        </div>
      )}
    </>
  );
}
