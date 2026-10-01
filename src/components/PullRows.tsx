// The Pull requests page's rows, tiles and project cards.
import {
  ChevronRight,
  FolderGit2,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
} from "lucide-react";
import type { Project } from "../../shared/projects";
import {
  pullKey,
  waitsOnYou,
  type BoardGroup,
  type BoardPull,
  type Verdict,
} from "../lib/pull-board";
import { DiffStatLabel } from "./DiffStatLabel";
import { ProjectBadge } from "./ProjectBadge";
import { relativeDate } from "./ui";

/** What the page knows beyond the PR itself. */
export interface PullContext {
  verdicts: Map<string, Verdict | null>;
  started: Set<string>;
  onOpen: (pull: BoardPull) => void;
}

function PullGlyph({ pull, size = 15 }: { pull: BoardPull; size?: number }) {
  const [Icon, label] =
    pull.state === "merged"
      ? [GitMerge, "Merged"]
      : pull.state === "closed"
        ? [GitPullRequestClosed, "Closed"]
        : pull.draft
          ? [GitPullRequestDraft, "Draft"]
          : [GitPullRequest, undefined];
  // Open goes without saying; read out, it would sound like a command.
  return (
    <Icon
      size={size}
      className={`pulls-glyph ${pull.draft && pull.state === "open" ? "draft" : pull.state}`}
      aria-label={label}
      aria-hidden={!label}
    />
  );
}

function Person({ login, size = 18 }: { login: string; size?: number }) {
  let hash = 0;
  for (const c of login) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return (
    <span
      className="pulls-person"
      style={
        {
          "--hue": Math.abs(hash) % 360,
          "--size": `${size}px`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {login.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** A project's badge, or an outline for a repository with no clone here. */
export function RepoMark({ project }: { project?: Project }) {
  return project ? (
    <ProjectBadge id={project.id} name={project.name} />
  ) : (
    <span className="pulls-remote-mark" aria-hidden>
      <FolderGit2 size={10} />
    </span>
  );
}

/** Where a PR stands, from your side. */
function standing(
  pull: BoardPull,
  verdict: Verdict | null | undefined,
  started: boolean,
): { text: string; tone?: "alarm" | "accent" } {
  if (pull.state === "merged") return { text: "Merged" };
  if (pull.state === "closed") return { text: "Closed" };
  if (pull.draft) return { text: "Draft" };
  if (pull.relation === "review")
    return started
      ? { text: "You've started reviewing", tone: "accent" }
      : { text: `${pull.author} asked for your review` };
  if (pull.relation === "assigned") return { text: "Assigned to you" };
  if (pull.relation === "mine")
    return verdict === "changes"
      ? { text: "Changes requested", tone: "alarm" }
      : verdict === "approved"
        ? { text: "Approved · ready to merge", tone: "accent" }
        : { text: "Waiting for review" };
  return { text: pull.author };
}

export function PullRow({
  pull,
  context,
  inProject,
  project,
}: {
  pull: BoardPull;
  context: PullContext;
  /** On a project's page the repository goes without saying. */
  inProject?: boolean;
  project?: Project;
}) {
  const key = pullKey(pull.ref);
  const { text, tone } = standing(
    pull,
    context.verdicts.get(key),
    context.started.has(key),
  );
  return (
    <button className="pulls-row" onClick={() => context.onOpen(pull)}>
      <PullGlyph pull={pull} size={16} />
      <span className="pulls-row-main">
        <span className="pulls-row-top">
          {inProject ? (
            <>
              <span className="pulls-num">#{pull.ref.number}</span>
              {pull.head && (
                <span className="pulls-branch">
                  {pull.head} → {pull.base}
                </span>
              )}
            </>
          ) : (
            <span className="pulls-repo">
              <RepoMark project={project} />
              <span className="pulls-repo-name">{pull.repo}</span>
              <span className="pulls-num">#{pull.ref.number}</span>
            </span>
          )}
        </span>
        <span className="pulls-row-title">{pull.title}</span>
        <span className="pulls-row-sub">
          {pull.relation !== "mine" && <Person login={pull.author} size={16} />}
          <span className={tone && `pulls-${tone}`}>{text}</span>
        </span>
      </span>
      <span className="pulls-row-side">
        <span className="pulls-row-stats">
          {pull.comments > 0 && (
            <span
              className="pulls-comments"
              aria-label={`${pull.comments} comments`}
            >
              <MessageSquare size={12} />
              {pull.comments}
            </span>
          )}
          <span className="pulls-time">{relativeDate(pull.updatedAt)}</span>
        </span>
        {pull.additions !== undefined && pull.deletions !== undefined && (
          <span className="pulls-row-stats">
            {pull.files !== undefined && (
              <span className="pulls-files">
                {pull.files} {pull.files === 1 ? "file" : "files"}
              </span>
            )}
            <DiffStatLabel
              stat={{ additions: pull.additions, deletions: pull.deletions }}
            />
          </span>
        )}
      </span>
    </button>
  );
}

/** Short enough for a tile: why this PR is waiting on you. */
function reason(
  pull: BoardPull,
  verdict: Verdict | null | undefined,
  started: boolean,
) {
  if (pull.relation === "review")
    return { text: started ? "Review started" : "Review requested" };
  if (pull.relation === "assigned") return { text: "Assigned to you" };
  return verdict === "changes"
    ? { text: "Changes requested", alarm: true }
    : { text: "Ready to merge" };
}

export function NeedsTile({
  pull,
  context,
  project,
}: {
  pull: BoardPull;
  context: PullContext;
  project?: Project;
}) {
  const key = pullKey(pull.ref);
  const why = reason(pull, context.verdicts.get(key), context.started.has(key));
  return (
    <button className="pulls-tile" onClick={() => context.onOpen(pull)}>
      <span className="pulls-repo quiet">
        <RepoMark project={project} />
        <span className="pulls-repo-name">{pull.repo}</span>
        <span className="pulls-num">#{pull.ref.number}</span>
      </span>
      <span className="pulls-tile-title">{pull.title}</span>
      <span className={`pulls-tile-reason ${why.alarm ? "alarm" : ""}`}>
        {why.text}
      </span>
      <span className="pulls-tile-foot">
        <Person login={pull.author} size={16} />
        <span className="pulls-tile-author">{pull.author}</span>
        <span className="pulls-time">{relativeDate(pull.updatedAt)}</span>
      </span>
    </button>
  );
}

const CARD_ROWS = 4;

export function ProjectCard({
  group,
  context,
  onRepo,
}: {
  group: BoardGroup;
  context: PullContext;
  onRepo: (key: string) => void;
}) {
  const { project } = group;
  return (
    <article className={`pulls-card ${project ? "" : "remote"}`}>
      <button className="pulls-card-head" onClick={() => onRepo(group.key)}>
        <RepoMark project={project} />
        <span className="pulls-card-name">
          <strong>{project?.name ?? group.repo}</strong>
          <small>{project ? group.repo : "Not on this Mac"}</small>
        </span>
        <span className="pulls-card-count">
          {group.error
            ? "Couldn’t load"
            : `${group.total} ${group.total === 1 ? "PR" : "PRs"}`}
          {group.forYou > 0 && <em>{group.forYou} for you</em>}
        </span>
      </button>
      {group.error ? (
        <p className="pulls-card-error">
          {group.error instanceof Error
            ? group.error.message
            : String(group.error)}
        </p>
      ) : (
        <div className="pulls-card-rows">
          {group.pulls.slice(0, CARD_ROWS).map((p) => (
            <button
              key={pullKey(p.ref)}
              className={`pulls-card-row ${waitsOnYou(p) ? "needs" : ""}`}
              onClick={() => context.onOpen(p)}
            >
              <PullGlyph pull={p} size={13} />
              <span className="pulls-card-title">{p.title}</span>
              <span className="pulls-time">{relativeDate(p.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
      {group.total > CARD_ROWS && !group.error && (
        <button className="pulls-card-more" onClick={() => onRepo(group.key)}>
          All {group.total}
          <ChevronRight size={12} />
        </button>
      )}
    </article>
  );
}
