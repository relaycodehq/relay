import type { CommitSummary } from "../../shared/history";

interface GraphEdge {
  /** Lane the line leaves from, at the top or middle of the row. */
  from: number;
  /** Lane the line reaches, at the middle or bottom of the row. */
  to: number;
  color: number;
}
export interface GraphRow {
  lane: number;
  color: number;
  /** Lines in the upper half, ending at the row's middle. */
  top: GraphEdge[];
  /** Lines in the lower half, starting at the row's middle. */
  bottom: GraphEdge[];
  /** Lanes in use through this row, for sizing the graph column. */
  width: number;
}

type Lane = { sha: string; color: number } | null;

/**
 * Lays topo-ordered commits out on lanes: each lane waits for one commit,
 * a commit takes the lane waiting for it, and its parents take over from
 * there. Lanes that waited for the same commit merge into its node.
 */
export function layoutGraph(commits: CommitSummary[]): GraphRow[] {
  const lanes: Lane[] = [];
  let colors = 0;
  const free = (avoid = -1) => {
    const i = lanes.findIndex((l, i) => !l && i !== avoid);
    return i === -1 ? lanes.length : i;
  };
  return commits.map((commit) => {
    let lane = lanes.findIndex((l) => l?.sha === commit.sha);
    if (lane === -1) {
      lane = free();
      lanes[lane] = { sha: commit.sha, color: colors++ };
    }
    const color = lanes[lane]!.color;
    const top: GraphEdge[] = [];
    lanes.forEach((l, i) => {
      if (!l) return;
      if (l.sha === commit.sha) {
        top.push({ from: i, to: lane, color: l.color });
        if (i !== lane) lanes[i] = null;
      } else top.push({ from: i, to: i, color: l.color });
    });
    const bottom: GraphEdge[] = [];
    const opened = new Set<number>();
    const [first, ...rest] = commit.parents;
    lanes[lane] = first ? { sha: first, color } : null;
    for (const parent of rest) {
      const existing = lanes.findIndex((l) => l?.sha === parent);
      if (existing !== -1) {
        bottom.push({
          from: lane,
          to: existing,
          color: lanes[existing]!.color,
        });
        continue;
      }
      const target = free(lane);
      lanes[target] = { sha: parent, color: colors++ };
      opened.add(target);
      bottom.push({ from: lane, to: target, color: lanes[target]!.color });
    }
    lanes.forEach((l, i) => {
      if (l && !opened.has(i)) bottom.push({ from: i, to: i, color: l.color });
    });
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
    const width =
      Math.max(
        lane,
        ...top.map((e) => Math.max(e.from, e.to)),
        ...bottom.map((e) => Math.max(e.from, e.to)),
      ) + 1;
    return { lane, color, top, bottom, width };
  });
}
