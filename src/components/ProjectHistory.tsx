import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";
import type { CommitSummary, HistoryScope } from "../../shared/history";
import { api } from "../lib/api";
import { layoutGraph, type GraphRow } from "../lib/commit-graph";
import { CommitChanges } from "./CommitChanges";
import { ErrorBox, Loading, relativeDate } from "./ui";
import type { PaneSlots } from "./WorkspacePanes";
import "./history.css";

const PAGE = 300;
const ROW = 26;
const LANE = 12;
const MAX_LANES = 14;
const COLORS = 8;
const SCOPE_KEY = "relay-history-scope";

/** The project's commits as a graph; picking one shows what it changed. */
export function ProjectHistory({
  projectId,
  slots,
  onOpenFile,
}: {
  projectId: string;
  slots: PaneSlots;
  onOpenFile: (path: string) => void;
}) {
  const [scope, setScope] = useState<HistoryScope>(() =>
    localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "head",
  );
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // New commits and branch switches move HEAD; the log follows it.
  const tree = useQuery({
    queryKey: ["working-tree", "project", projectId],
    queryFn: () => api.projectWorkingTree(projectId),
    refetchInterval: 5000,
  });
  const head = tree.data?.head;
  const log = useQuery({
    queryKey: ["project-history", projectId, scope, limit, head],
    queryFn: () => api.projectHistory(projectId, scope, limit),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
  const commits = log.data?.commits ?? [];
  const rows = useMemo(() => layoutGraph(commits), [commits]);
  const lanes = Math.min(
    MAX_LANES,
    rows.reduce((max, r) => Math.max(max, r.width), 1),
  );
  const index = commits.findIndex((c) => c.sha === selected);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-sha="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  function changeScope(next: HistoryScope) {
    setScope(next);
    setLimit(PAGE);
    localStorage.setItem(SCOPE_KEY, next);
  }
  return (
    <section className="project-history" aria-label="Commit history">
      {slots.actions &&
        createPortal(
          <div className="history-scope" role="group" aria-label="Branches">
            {(["head", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => changeScope(s)}
              >
                {s === "head" ? "Current branch" : "All branches"}
              </button>
            ))}
          </div>,
          slots.actions,
        )}
      <div
        ref={list}
        className="history-log"
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        aria-activedescendant={selected ? `commit-${selected}` : undefined}
        onKeyDown={(e) => {
          const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
          if (step) {
            e.preventDefault();
            const next = commits[Math.max(0, index + step)];
            if (next) setSelected(next.sha);
          } else if (e.key === "Escape" && selected) setSelected(null);
        }}
      >
        {log.error ? (
          <ErrorBox error={log.error} />
        ) : !log.data ? (
          <Loading text="Reading history…" />
        ) : !commits.length ? (
          <div className="empty">
            <GitCommitHorizontal size={28} />
            <h2>No commits yet</h2>
          </div>
        ) : (
          <>
            {commits.map((commit, i) => (
              <CommitRow
                key={commit.sha}
                commit={commit}
                row={rows[i]}
                lanes={lanes}
                selected={commit.sha === selected}
                onSelect={() =>
                  setSelected(commit.sha === selected ? null : commit.sha)
                }
              />
            ))}
            {log.data.more && (
              <button
                type="button"
                className="history-more"
                disabled={log.isFetching}
                onClick={() => setLimit((l) => Math.min(5000, l + PAGE))}
              >
                {log.isFetching ? "Loading…" : "Show older commits"}
              </button>
            )}
          </>
        )}
      </div>
      {selected && (
        <CommitChanges
          key={selected}
          projectId={projectId}
          sha={selected}
          onClose={() => setSelected(null)}
          onOpenFile={onOpenFile}
        />
      )}
    </section>
  );
}

function CommitRow({
  commit,
  row,
  lanes,
  selected,
  onSelect,
}: {
  commit: CommitSummary;
  row: GraphRow;
  lanes: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const date = new Date(commit.time * 1000);
  return (
    <div
      id={`commit-${commit.sha}`}
      data-sha={commit.sha}
      role="option"
      aria-selected={selected}
      className="history-row"
      onClick={onSelect}
    >
      <CommitGraph row={row} lanes={lanes} merge={commit.parents.length > 1} />
      <span className="history-subject">
        {commit.refs.map((ref) => (
          <RefBadge key={ref} value={ref} />
        ))}
        <span title={commit.subject}>{commit.subject}</span>
      </span>
      <span className="history-author">{commit.author}</span>
      <time dateTime={date.toISOString()} title={date.toLocaleString()}>
        {relativeDate(date.toISOString())}
      </time>
      <code>{commit.sha.slice(0, 7)}</code>
    </div>
  );
}

function RefBadge({ value }: { value: string }) {
  const head = value.startsWith("HEAD -> ");
  const tag = value.startsWith("tag: ");
  const name = head ? value.slice(8) : tag ? value.slice(5) : value;
  const kind =
    head || value === "HEAD"
      ? "head"
      : tag
        ? "tag"
        : name.includes("/")
          ? "remote"
          : "branch";
  return (
    <span className="history-ref" data-kind={kind} title={value}>
      {name}
    </span>
  );
}

const x = (lane: number) => lane * LANE + LANE / 2 + 2;
const curve = (from: number, to: number, y0: number, y1: number) =>
  from === to
    ? `M${x(from)} ${y0}V${y1}`
    : `M${x(from)} ${y0}C${x(from)} ${(y0 + y1) / 2} ${x(to)} ${(y0 + y1) / 2} ${x(to)} ${y1}`;

function CommitGraph({
  row,
  lanes,
  merge,
}: {
  row: GraphRow;
  lanes: number;
  merge: boolean;
}) {
  const mid = ROW / 2;
  return (
    <svg
      className="history-graph"
      width={lanes * LANE + 4}
      height={ROW}
      aria-hidden
    >
      {row.top.map((e, i) => (
        <path
          key={`t${i}`}
          d={curve(e.from, e.to, 0, mid)}
          data-color={e.color % COLORS}
        />
      ))}
      {row.bottom.map((e, i) => (
        <path
          key={`b${i}`}
          d={curve(e.from, e.to, mid, ROW)}
          data-color={e.color % COLORS}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={merge ? 3 : 3.5}
        data-color={row.color % COLORS}
        data-merge={merge ? "" : undefined}
      />
    </svg>
  );
}
