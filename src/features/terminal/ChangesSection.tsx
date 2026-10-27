import { GitCompareArrows } from "lucide-react";
import type { DiffStat } from "../changes/turn-diff-tree";
import { DiffStatLabel } from "../changes/DiffStatLabel";

/** What the open thread changed, as the card counts it. */
export interface CardChanges {
  files: number;
  lines: DiffStat;
  /** For a folder without Git: the other repositories they're in. */
  elsewhere?: string[];
}

function filesChanged({ files, elsewhere }: CardChanges) {
  const count = `${files} ${files === 1 ? "file" : "files"} changed`;
  if (!elsewhere) return count;
  if (elsewhere.length === 1) return `${count} in ${elsewhere[0]}`;
  return `${count} in ${elsewhere.length} repositories`;
}

/** The thread's changes, which open in the editor. */
export function ChangesSection({
  changes,
  onOpen,
}: {
  changes: CardChanges;
  onOpen: () => void;
}) {
  return (
    <section className="running-changes">
      {changes.files ? (
        <button
          type="button"
          className="running-changes-row"
          title="Open the changes in the editor"
          onClick={onOpen}
        >
          <GitCompareArrows size={15} aria-hidden />
          <span className="running-changes-name">{filesChanged(changes)}</span>
          <DiffStatLabel stat={changes.lines} />
        </button>
      ) : (
        <div className="running-changes-row quiet">
          <GitCompareArrows size={15} aria-hidden />
          <span>No changes yet</span>
        </div>
      )}
    </section>
  );
}
