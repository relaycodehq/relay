import type { WorkingChange } from "../../shared/working-tree";

/** One run of Git that says what `rev-parse`, `branch`, `status` and `rev-list` each said before. */
export const statusArgs = [
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all",
];

/** What `git status --porcelain=v2 --branch -z` says about a checkout. */
export interface StatusRead {
  /** HEAD's commit; empty on a branch with no commits yet. */
  head: string;
  /** The checked-out branch; empty when HEAD is detached. */
  branch: string;
  /** The upstream the branch is set to track, as `origin/main`, whether or not it still exists. */
  upstream: string | null;
  /** Commits ahead of and behind the upstream; null when Git couldn't compare (none, gone, or no commits). */
  ab: { ahead: number; behind: number } | null;
  changes: WorkingChange[];
  /**
   * Each change's line as Git printed it, index hashes included, so staging
   * part of a file changes it; in the order of `changes`.
   */
  rows: string[];
}

// v2 marks an unchanged side with "."; v1, and everything reading
// WorkingChange, with a space.
const side = (code: string) => (code === "." ? " " : code);

/** The first `count` space-separated fields of `row`, then the rest: a path may hold spaces. */
function fields(row: string, count: number) {
  const out: string[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const next = row.indexOf(" ", at);
    out.push(row.slice(at, next));
    at = next + 1;
  }
  return { fields: out, rest: row.slice(at) };
}

export function parseStatusV2(raw: string): StatusRead {
  const tokens = raw.split("\0");
  const read: StatusRead = {
    head: "",
    branch: "",
    upstream: null,
    ab: null,
    changes: [],
    rows: [],
  };
  for (let i = 0; i < tokens.length; i++) {
    const row = tokens[i]!;
    if (!row) continue;
    if (row.startsWith("# ")) {
      const space = row.indexOf(" ", 2);
      const key = row.slice(2, space),
        value = row.slice(space + 1);
      if (key === "branch.oid") read.head = value === "(initial)" ? "" : value;
      else if (key === "branch.head")
        read.branch = value === "(detached)" ? "" : value;
      else if (key === "branch.upstream") read.upstream = value;
      else if (key === "branch.ab") {
        const [ahead, behind] = value.split(" ");
        read.ab = { ahead: Number(ahead!.slice(1)), behind: -Number(behind) };
      }
      continue;
    }
    const kind = row[0];
    if (kind === "?") {
      read.rows.push(row);
      read.changes.push({
        path: row.slice(2),
        index: "?",
        worktree: "?",
        conflict: false,
      });
    } else if (kind === "1" || kind === "2" || kind === "u") {
      // Ordinary: `1 XY sub mH mI mW hH hI path`; renamed or copied:
      // `2 … hI Xscore path` then the old path; unmerged: `u XY sub m1 m2 m3 mW h1 h2 h3 path`.
      const { fields: f, rest: path } = fields(
        row,
        kind === "1" ? 8 : kind === "2" ? 9 : 10,
      );
      const xy = f[1]!;
      const previousPath = kind === "2" ? tokens[++i] : undefined;
      read.rows.push(
        previousPath === undefined ? row : `${row}\0${previousPath}`,
      );
      read.changes.push({
        path,
        previousPath,
        index: side(xy[0]!),
        worktree: side(xy[1]!),
        conflict: kind === "u",
      });
    }
  }
  return read;
}
