// Small pieces every PR overview option shares.
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Link2,
  RefreshCw,
  Search,
} from "lucide-react";
import { ProjectBadge } from "../src/components/ProjectBadge";
import { DiffStatLabel } from "../src/components/DiffStatLabel";
import {
  initials,
  repoOf,
  type Checks,
  type ReviewState,
  type SamplePr,
} from "./pr-overview-data";

export type StateFilter = "open" | "closed" | "all";

export function PrGlyph({ pr, size = 15 }: { pr: SamplePr; size?: number }) {
  const Icon =
    pr.state === "merged"
      ? GitMerge
      : pr.state === "closed"
        ? GitPullRequestClosed
        : pr.state === "draft"
          ? GitPullRequestDraft
          : GitPullRequest;
  return (
    <Icon
      size={size}
      className={`pro-glyph ${pr.state}`}
      aria-label={pr.state}
    />
  );
}

export function ChecksGlyph({ checks }: { checks: Checks }) {
  if (checks === "none") return <span className="pro-checks none" />;
  const Icon =
    checks === "passing"
      ? CircleCheck
      : checks === "failing"
        ? CircleX
        : CircleDashed;
  const label =
    checks === "passing"
      ? "Checks passing"
      : checks === "failing"
        ? "Checks failing"
        : "Checks running";
  return (
    <span className={`pro-checks ${checks}`} title={label}>
      <Icon size={13} aria-label={label} />
    </span>
  );
}

export function ReviewText({ state }: { state: ReviewState }) {
  return (
    <span className={`pro-review ${state}`}>
      {state === "approved" && <Check size={12} />}
      {state === "approved"
        ? "Approved"
        : state === "changes"
          ? "Changes requested"
          : state === "commented"
            ? "Commented"
            : "Waiting"}
    </span>
  );
}

/** The strongest review so far, from the author's side. */
export const reviewOf = (pr: SamplePr): ReviewState =>
  pr.reviewers.some((r) => r.state === "changes")
    ? "changes"
    : pr.reviewers.some((r) => r.state === "approved")
      ? "approved"
      : pr.reviewers.some((r) => r.state === "commented")
        ? "commented"
        : "waiting";

export function Person({ name, size = 18 }: { name: string; size?: number }) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return (
    <span
      className="pro-person"
      style={
        {
          "--hue": Math.abs(hash) % 360,
          "--size": `${size}px`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function RepoLabel({
  repo,
  number,
  quiet,
}: {
  repo: string;
  number?: number;
  quiet?: boolean;
}) {
  const r = repoOf(repo);
  return (
    <span className={`pro-repo ${quiet ? "quiet" : ""}`}>
      {r.project ? (
        <ProjectBadge id={r.project.id} name={r.project.name} />
      ) : (
        <span className="pro-repo-remote" aria-hidden>
          <GitPullRequest size={10} />
        </span>
      )}
      <span className="pro-repo-name">{repo}</span>
      {number !== undefined && <span className="pro-num">#{number}</span>}
    </span>
  );
}

export function Stat({ pr }: { pr: SamplePr }) {
  return (
<DiffStatLabel stat={pr} />
  );
}

export function PageHead({
  crumb,
  title = "Pull requests",
  summary,
  placeholder = "Search pull requests",
  actions,
  query,
  onQuery,
  state,
  onState,
  counts,
}: {
  crumb?: React.ReactNode;
  title?: React.ReactNode;
  summary: React.ReactNode;
  placeholder?: string;
  /** Replaces "Open by URL", which only belongs on the top page. */
  actions?: React.ReactNode;
  query: string;
  onQuery: (q: string) => void;
  state: StateFilter;
  onState: (s: StateFilter) => void;
  counts: Record<StateFilter, number>;
}) {
  return (
    <header className="pro-head">
      <div className="pro-head-text">
        {crumb}
        <h1>{title}</h1>
        <p>{summary}</p>
      </div>
      <div className="pro-tools">
        <label className="pro-search">
          <Search size={13} />
          <input
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onQuery("")}
          />
          <kbd>⌘F</kbd>
        </label>
        <StateToggle state={state} onState={onState} counts={counts} />
        {actions ?? (
          <button
            className="pro-quiet-button"
            title="Open a pull request by its link (⌘K)"
          >
            <Link2 size={14} />
            Open by URL
          </button>
        )}
        <button className="pro-icon-button" aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
    </header>
  );
}

export function StateToggle({
  state,
  onState,
  counts,
}: {
  state: StateFilter;
  onState: (s: StateFilter) => void;
  counts: Record<StateFilter, number>;
}) {
  return (
    <div className="pro-states" role="radiogroup" aria-label="State">
      {(["open", "closed", "all"] as const).map((s) => (
        <button
          key={s}
          role="radio"
          aria-checked={state === s}
          onClick={() => onState(s)}
        >
          {s === "open" ? "Open" : s === "closed" ? "Closed" : "All"}
          {s !== "all" && <small>{counts[s]}</small>}
        </button>
      ))}
    </div>
  );
}
