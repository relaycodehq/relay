import { compactCount, type DiffStat } from "../lib/turn-diff-tree";

export function DiffStatLabel({ stat }: { stat: DiffStat }) {
  return (
    <span
      className="diff-stat"
      role="group"
      aria-label={`${stat.additions} additions, ${stat.deletions} deletions`}
    >
      <span aria-hidden className="diff-stat-add">
        +{compactCount(stat.additions)}
      </span>
      <span aria-hidden className="diff-stat-del">
        −{compactCount(stat.deletions)}
      </span>
    </span>
  );
}
