// Five takes on the Pull requests page. Each lists every PR and opens one
// through `onOpen`; the shell decides what "open" looks like.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  FolderGit2,
  FolderPlus,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { ProjectBadge } from "../src/components/ProjectBadge";
import {
  ago,
  isOpen,
  keyOf,
  repoOf,
  repos,
  standing,
  type SamplePr,
} from "./pr-overview-data";
import {
  ChecksGlyph,
  Person,
  PrGlyph,
  RepoLabel,
  ReviewText,
  Stat,
  reviewOf,
  type StateFilter,
} from "./pr-overview-parts";

export interface OptionProps {
  pulls: SamplePr[];
  state: StateFilter;
  onOpen: (pr: SamplePr) => void;
}

export const waiting = (p: SamplePr) =>
  isOpen(p) && (p.relation === "review" || p.relation === "assigned");
export const mine = (p: SamplePr) => p.relation === "mine";
const rest = (p: SamplePr) => !waiting(p) && !mine(p);
const byRepo = (list: SamplePr[]) =>
  repos
    .map((r) => ({ ...r, pulls: list.filter((p) => p.repo === r.repo) }))
    .filter((r) => r.pulls.length);

/* 1 · Triage: what needs you first, everything else by project. */

export function Triage({ pulls, onOpen }: OptionProps) {
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const others = byRepo(pulls.filter(rest));
  return (
    <div className="pro-triage">
      <Section title="Waiting on you" count={pulls.filter(waiting).length}>
        <div className="pro-list">
          {pulls.filter(waiting).map((p) => (
            <TriageRow key={keyOf(p)} pr={p} onOpen={onOpen} />
          ))}
        </div>
      </Section>
      <Section title="Yours" count={pulls.filter(mine).length}>
        <div className="pro-list">
          {pulls.filter(mine).map((p) => (
            <TriageRow key={keyOf(p)} pr={p} onOpen={onOpen} />
          ))}
        </div>
      </Section>
      <Section title="Everyone else" count={pulls.filter(rest).length}>
        {others.map((r) => {
          const open = !folded[r.repo];
          return (
            <div key={r.repo} className="pro-group">
              <button
                className="pro-group-head"
                aria-expanded={open}
                onClick={() => setFolded((f) => ({ ...f, [r.repo]: open }))}
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <RepoLabel repo={r.repo} />
                {r.project ? (
                  <span className="pro-group-path">{r.project.name}</span>
                ) : (
                  <span className="pro-group-path">Not on this Mac</span>
                )}
                <small>{r.pulls.length}</small>
              </button>
              {open &&
                r.pulls.map((p) => (
                  <button
                    key={keyOf(p)}
                    className="pro-line"
                    onClick={() => onOpen(p)}
                  >
                    <PrGlyph pr={p} size={14} />
                    <span className="pro-line-title">{p.title}</span>
                    <span className="pro-num">#{p.number}</span>
                    <span className="pro-line-who">
                      <Person name={p.author} size={16} />
                      {p.author.split(" ")[0]}
                    </span>
                    <span className="pro-line-standing">{standing(p)}</span>
                    <ChecksGlyph checks={p.checks} />
                    <span className="pro-time">{ago(p.updated)}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="pro-section">
      <h2>
        {title}
        <small>{count}</small>
      </h2>
      {children}
    </section>
  );
}

function TriageRow({
  pr,
  onOpen,
  inProject,
}: {
  pr: SamplePr;
  onOpen: (pr: SamplePr) => void;
  /** On a project's page the repository goes without saying. */
  inProject?: boolean;
}) {
  const alarm =
    pr.relation === "mine" &&
    (reviewOf(pr) === "changes" || pr.checks === "failing");
  return (
    <button className="pro-row" onClick={() => onOpen(pr)}>
      <PrGlyph pr={pr} size={16} />
      <span className="pro-row-main">
        <span className="pro-row-top">
          {inProject ? (
            <>
              <span className="pro-num">#{pr.number}</span>
              <span className="pro-branch">
                {pr.head} → {pr.base}
              </span>
            </>
          ) : (
            <>
              <RepoLabel repo={pr.repo} number={pr.number} />
              {!repoOf(pr.repo).project && (
                <span className="pro-remote-note">Not on this Mac</span>
              )}
            </>
          )}
        </span>
        <span className="pro-row-title">{pr.title}</span>
        <span className="pro-row-sub">
          {pr.relation !== "mine" && <Person name={pr.author} size={16} />}
          <span className={alarm ? "pro-alarm" : undefined}>
            {standing(pr)}
          </span>
          {!!pr.newComments && (
            <span className="pro-new">{pr.newComments} new comments</span>
          )}
        </span>
      </span>
      <span className="pro-row-side">
        <span className="pro-row-stats">
          <ChecksGlyph checks={pr.checks} />
          {pr.comments > 0 && (
            <span className="pro-comments">
              <MessageSquare size={12} />
              {pr.comments}
            </span>
          )}
          <span className="pro-time">{ago(pr.updated)}</span>
        </span>
        <span className="pro-row-stats">
          <span className="pro-files">{pr.files} files</span>
          <Stat pr={pr} />
        </span>
        {pr.progress && (
          <span
            className="pro-progress"
            title={`${pr.progress.viewed} of ${pr.files} files viewed`}
          >
            <i style={{ width: `${(pr.progress.viewed / pr.files) * 100}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

/* 2 · Projects: a card per repository, what needs you on top. */

export function Board({ pulls, onOpen }: OptionProps) {
  const [repo, setRepo] = useState<string | null>(null);
  const groups = byRepo(pulls);
  const focus = repo && groups.find((g) => g.repo === repo);
  if (focus)
    return (
      <div className="pro-board-focus">
        <nav className="pro-crumbs">
          <button onClick={() => setRepo(null)}>All projects</button>
          <ChevronRight size={13} />
          <span>{focus.project?.name ?? focus.repo}</span>
        </nav>
        <div className="pro-focus-head">
          <RepoLabel repo={focus.repo} />
          <span className="pro-group-path">
            {focus.project?.path.replace("/Users/you", "~") ??
              "Not checked out on this Mac"}
          </span>
          <span className="spacer" />
          {focus.project ? (
            <button className="pro-quiet-button">
              <FolderGit2 size={14} />
              Open project
            </button>
          ) : (
            <button className="pro-quiet-button">
              <FolderPlus size={14} />
              Link a folder…
            </button>
          )}
        </div>
        <div className="pro-list">
          {focus.pulls.map((p) => (
            <TriageRow key={keyOf(p)} pr={p} onOpen={onOpen} />
          ))}
        </div>
      </div>
    );
  const needs = pulls.filter(waiting);
  return (
    <div className="pro-board">
      {needs.length > 0 && (
        <section className="pro-section">
          <h2>
            Waiting on you<small>{needs.length}</small>
          </h2>
          <div className="pro-tiles">
            {needs.map((p) => (
              <button
                key={keyOf(p)}
                className="pro-tile"
                onClick={() => onOpen(p)}
              >
                <RepoLabel repo={p.repo} number={p.number} quiet />
                <span className="pro-tile-title">{p.title}</span>
                <span className="pro-tile-foot">
                  <Person name={p.author} size={16} />
                  <span>{p.author.split(" ")[0]}</span>
                  <span className="pro-time">{ago(p.updated)}</span>
                  <span className="spacer" />
                  <Stat pr={p} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="pro-section">
        <h2>
          Projects<small>{groups.length}</small>
        </h2>
        <div className="pro-cards">
          {groups.map((g) => (
            <ProjectCard
              key={g.repo}
              group={g}
              needs={waiting}
              onRepo={setRepo}
              onOpen={onOpen}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

type RepoGroup = ReturnType<typeof byRepo>[number];

function ProjectCard({
  group: g,
  needs,
  onRepo,
  onOpen,
}: {
  group: RepoGroup;
  needs: (p: SamplePr) => boolean;
  onRepo: (repo: string) => void;
  onOpen: (pr: SamplePr) => void;
}) {
  const need = g.pulls.filter(needs).length;
  return (
    <article className={`pro-card ${g.project ? "" : "remote"}`}>
      <button className="pro-card-head" onClick={() => onRepo(g.repo)}>
        {g.project ? (
          <ProjectBadge id={g.project.id} name={g.project.name} />
        ) : (
          <span className="pro-repo-remote" aria-hidden>
            <FolderGit2 size={10} />
          </span>
        )}
        <span className="pro-card-name">
          <strong>{g.project?.name ?? g.repo}</strong>
          <small>{g.project ? g.repo : "Not on this Mac"}</small>
        </span>
        <span className="pro-card-count">
          {g.pulls.length} {g.pulls.length === 1 ? "PR" : "PRs"}
          {need > 0 && <em>{need} for you</em>}
        </span>
      </button>
      <div className="pro-card-rows">
        {g.pulls.slice(0, 4).map((p) => (
          <button
            key={keyOf(p)}
            className={`pro-card-row ${needs(p) ? "needs" : ""}`}
            onClick={() => onOpen(p)}
          >
            <PrGlyph pr={p} size={13} />
            <span className="pro-card-title">{p.title}</span>
            <ChecksGlyph checks={p.checks} />
            <span className="pro-time">{ago(p.updated)}</span>
          </button>
        ))}
      </div>
      {g.pulls.length > 4 && (
        <button className="pro-card-more" onClick={() => onRepo(g.repo)}>
          All {g.pulls.length}
          <ChevronRight size={12} />
        </button>
      )}
    </article>
  );
}

/* 2b · Projects, where a project's page is its own triage. */

/** Your own open PRs that wait on you: to fix, answer or merge. */
const blocked = (p: SamplePr) =>
  mine(p) &&
  p.state === "open" &&
  (reviewOf(p) === "changes" ||
    reviewOf(p) === "approved" ||
    p.checks === "failing" ||
    !!p.newComments);
export const needsYou = (p: SamplePr) => waiting(p) || blocked(p);

/** Why a PR is in "Needs you", short enough for a tile. */
function reason(p: SamplePr): { text: string; alarm?: boolean } {
  if (p.relation === "review")
    return {
      text: p.progress
        ? `Reviewing · ${p.progress.viewed} of ${p.files} viewed`
        : "Review requested",
    };
  if (p.relation === "assigned") return { text: "Assigned to you" };
  if (reviewOf(p) === "changes")
    return { text: "Changes requested", alarm: true };
  if (p.checks === "failing") return { text: "Checks failing", alarm: true };
  if (p.newComments) return { text: `${p.newComments} new comments` };
  return { text: "Approved · ready to merge" };
}

export function BoardTriage({
  pulls,
  onOpen,
  repo,
  onRepo,
}: OptionProps & {
  repo: string | null;
  onRepo: (repo: string | null) => void;
}) {
  if (repo) {
    const r = repoOf(repo);
    const own = pulls.filter((p) => p.repo === repo);
    const sections: [string, SamplePr[]][] = [
      ["Waiting on you", own.filter(waiting)],
      ["Yours", own.filter(mine)],
      ["Everyone else", own.filter(rest)],
    ];
    return (
      <div className="pro-project">
        {own.length ? (
          sections.map(([title, list]) => (
            <Section key={title} title={title} count={list.length}>
              <div className="pro-list">
                {list.map((p) => (
                  <TriageRow key={keyOf(p)} pr={p} onOpen={onOpen} inProject />
                ))}
              </div>
            </Section>
          ))
        ) : (
          <p className="pro-empty">
            Nothing here right now. New pull requests in{" "}
            {r.project?.name ?? r.repo} show up on this page.
          </p>
        )}
      </div>
    );
  }
  const needs = pulls.filter(needsYou);
  const groups = byRepo(pulls).sort(
    (a, b) =>
      b.pulls.filter(needsYou).length - a.pulls.filter(needsYou).length ||
      Math.min(...a.pulls.map((p) => p.updated)) -
        Math.min(...b.pulls.map((p) => p.updated)),
  );
  const quiet = repos.filter(
    (r) => r.project && !pulls.some((p) => p.repo === r.repo),
  );
  return (
    <div className="pro-board">
      {needs.length > 0 && (
        <section className="pro-section">
          <h2>
            Needs you<small>{needs.length}</small>
          </h2>
          <div className="pro-tiles">
            {needs.map((p) => {
              const why = reason(p);
              return (
                <button
                  key={keyOf(p)}
                  className="pro-tile"
                  onClick={() => onOpen(p)}
                >
                  <RepoLabel repo={p.repo} number={p.number} quiet />
                  <span className="pro-tile-title">{p.title}</span>
                  <span
                    className={`pro-tile-reason ${why.alarm ? "alarm" : ""}`}
                  >
                    {why.text}
                  </span>
                  <span className="pro-tile-foot">
                    <Person name={p.author} size={16} />
                    <span>{p.author.split(" ")[0]}</span>
                    <span className="pro-time">{ago(p.updated)}</span>
                    <span className="spacer" />
                    <Stat pr={p} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <section className="pro-section">
        <h2>
          Projects<small>{groups.length}</small>
        </h2>
        <div className="pro-cards">
          {groups.map((g) => (
            <ProjectCard
              key={g.repo}
              group={g}
              needs={needsYou}
              onRepo={onRepo}
              onOpen={onOpen}
            />
          ))}
        </div>
        {quiet.length > 0 && (
          <p className="pro-quiet">
            Nothing open in{" "}
            {quiet.map((r, i) => (
              <span key={r.repo}>
                <button onClick={() => onRepo(r.repo)}>
                  {r.project!.name}
                </button>
                {i < quiet.length - 2 ? ", " : i === quiet.length - 2 ? " and " : ""}
              </span>
            ))}
          </p>
        )}
      </section>
    </div>
  );
}

/* 3 · Table: dense, sortable, keyboard first. */

type Tab = "waiting" | "mine" | "all";
type Sort = "updated" | "size" | "title";

export function Table({ pulls, onOpen }: OptionProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<Sort>("updated");
  const [cursor, setCursor] = useState(0);
  const listed = useMemo(() => {
    const list = pulls
      .filter((p) =>
        tab === "waiting" ? waiting(p) : tab === "mine" ? mine(p) : true,
      )
      .sort((a, b) =>
        sort === "updated"
          ? a.updated - b.updated
          : sort === "size"
            ? b.additions + b.deletions - (a.additions + a.deletions)
            : a.title.localeCompare(b.title),
      );
    return grouped ? byRepo(list).flatMap((g) => g.pulls) : list;
  }, [pulls, tab, sort, grouped]);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => setCursor(0), [tab, sort, grouped]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input")) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setCursor((c) => Math.min(listed.length - 1, c + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter" && listed[cursor]) onOpen(listed[cursor]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listed, cursor]);
  useEffect(() => {
    body.current
      ?.querySelector(".cursor")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const tabs: [Tab, string, number][] = [
    ["waiting", "Waiting on you", pulls.filter(waiting).length],
    ["mine", "Yours", pulls.filter(mine).length],
    ["all", "Everything", pulls.length],
  ];
  const head = (label: string, key?: Sort) =>
    key ? (
      <button
        className={sort === key ? "sorted" : undefined}
        onClick={() => setSort(key)}
      >
        {label}
        {sort === key && <ChevronDown size={11} />}
      </button>
    ) : (
      label
    );
  let lastRepo = "";
  return (
    <div className="pro-table-wrap">
      <div className="pro-tabs" role="tablist">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
            <small>{count}</small>
          </button>
        ))}
        <span className="spacer" />
        <label className="pro-check">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
          />
          Group by project
        </label>
      </div>
      <table className="pro-table">
        <thead>
          <tr>
            <th className="pro-col-title">{head("Pull request", "title")}</th>
            {!grouped && <th>Project</th>}
            <th>Author</th>
            <th>Review</th>
            <th className="pro-col-center">Checks</th>
            <th className="pro-col-right">{head("Changes", "size")}</th>
            <th className="pro-col-right">{head("Updated", "updated")}</th>
          </tr>
        </thead>
        <tbody ref={body}>
          {listed.map((p, i) => {
            const group = grouped && p.repo !== lastRepo;
            lastRepo = p.repo;
            const r = repoOf(p.repo);
            return [
              group && (
                <tr key={p.repo} className="pro-table-group">
                  <td colSpan={6}>
                    <RepoLabel repo={p.repo} />
                    {!r.project && (
                      <span className="pro-remote-note">Not on this Mac</span>
                    )}
                  </td>
                </tr>
              ),
              <tr
                key={keyOf(p)}
                className={i === cursor ? "cursor" : undefined}
                onClick={() => onOpen(p)}
                onMouseMove={() => i !== cursor && setCursor(i)}
              >
                <td className="pro-col-title">
                  <span>
                    <PrGlyph pr={p} size={14} />
                    <span className="pro-table-title">{p.title}</span>
                    <span className="pro-num">#{p.number}</span>
                    {waiting(p) && <span className="pro-for-you">for you</span>}
                  </span>
                </td>
                {!grouped && (
                  <td>
                    <RepoLabel repo={p.repo} quiet />
                  </td>
                )}
                <td>
                  <span className="pro-who">
                    <Person name={p.author} size={16} />
                    {p.author.split(" ")[0]}
                  </span>
                </td>
                <td>
                  {p.state === "draft" ? (
                    <span className="pro-review">Draft</span>
                  ) : (
                    <ReviewText state={reviewOf(p)} />
                  )}
                </td>
                <td className="pro-col-center">
                  <ChecksGlyph checks={p.checks} />
                </td>
                <td className="pro-col-right">
                  <Stat pr={p} />
                </td>
                <td className="pro-col-right pro-time">{ago(p.updated)}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="pro-keys">
        <kbd>↑</kbd>
        <kbd>↓</kbd> or <kbd>j</kbd>
        <kbd>k</kbd> to move · <kbd>⏎</kbd> to open
      </p>
    </div>
  );
}

/* 4 · List and peek: skim a PR before opening it. */

export function Peek({ pulls, onOpen }: OptionProps) {
  const ordered = useMemo(
    () => [
      ...pulls.filter(waiting),
      ...pulls.filter(mine),
      ...pulls.filter(rest),
    ],
    [pulls],
  );
  const [selected, setSelected] = useState(() => ordered[0]);
  const pr = ordered.find((p) => p === selected) ?? ordered[0];
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input")) return;
      const i = ordered.indexOf(pr!);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelected(ordered[Math.min(ordered.length - 1, i + 1)]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelected(ordered[Math.max(0, i - 1)]);
      } else if (e.key === "Enter" && pr) onOpen(pr);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, pr]);
  useEffect(() => {
    list.current
      ?.querySelector(".selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [pr]);
  if (!pr) return <p className="pro-empty">No pull requests match.</p>;
  const groups: [string, SamplePr[]][] = [
    ["Waiting on you", pulls.filter(waiting)],
    ["Yours", pulls.filter(mine)],
    ["Everyone else", pulls.filter(rest)],
  ];
  const local = repoOf(pr.repo).project;
  return (
    <div className="pro-peek">
      <div className="pro-peek-list" ref={list}>
        {groups
          .filter(([, g]) => g.length)
          .map(([title, g]) => (
            <section key={title}>
              <h2>
                {title}
                <small>{g.length}</small>
              </h2>
              {g.map((p) => (
                <button
                  key={keyOf(p)}
                  className={`pro-peek-row ${p === pr ? "selected" : ""}`}
                  onClick={() => setSelected(p)}
                  onDoubleClick={() => onOpen(p)}
                >
                  <PrGlyph pr={p} size={14} />
                  <span className="pro-peek-main">
                    <span className="pro-peek-title">{p.title}</span>
                    <span className="pro-peek-sub">
                      {p.repo} #{p.number} · {p.author.split(" ")[0]}
                    </span>
                  </span>
                  <span className="pro-time">{ago(p.updated)}</span>
                </button>
              ))}
            </section>
          ))}
      </div>
      <article className="pro-peek-detail">
        <div className="pro-peek-kicker">
          <RepoLabel repo={pr.repo} number={pr.number} />
          <span className="pro-branch">
            {pr.head} → {pr.base}
          </span>
        </div>
        <h2>{pr.title}</h2>
        <div className="pro-peek-by">
          <Person name={pr.author} size={20} />
          <span>
            {pr.author} opened {ago(pr.opened)} ago · updated{" "}
            {ago(pr.updated)} ago
          </span>
        </div>
        <div className="pro-peek-actions">
          <button className="primary" onClick={() => onOpen(pr)}>
            Open review
            <CornerDownLeft size={13} />
          </button>
          <button className="pro-quiet-button" disabled={!local}>
            <Sparkles size={14} />
            Ask an agent
          </button>
          <button className="pro-quiet-button">
            <ArrowUpRight size={14} />
            Open in Gitea
          </button>
        </div>
        {!local && (
          <p className="pro-peek-note">
            {pr.repo} isn’t on this Mac. You can review it; asking an agent
            needs a local folder. <button>Link a folder…</button>
          </p>
        )}
        <p className="pro-peek-body">{pr.body}</p>
        <dl className="pro-facts">
          <dt>Where it stands</dt>
          <dd>{standing(pr)}</dd>
          <dt>Reviewers</dt>
          <dd>
            {pr.reviewers.length ? (
              pr.reviewers.map((r) => (
                <span key={r.name} className="pro-reviewer">
                  <Person name={r.name} size={16} />
                  {r.name}
                  <ReviewText state={r.state} />
                </span>
              ))
            ) : (
              <span className="pro-muted">Nobody yet</span>
            )}
          </dd>
          <dt>Checks</dt>
          <dd>
            <span className="pro-reviewer">
              <ChecksGlyph checks={pr.checks} />
              {pr.checks === "none"
                ? "No checks"
                : pr.checks === "passing"
                  ? "build, test and lint passed"
                  : pr.checks === "failing"
                    ? "test failed · build and lint passed"
                    : "build running · lint passed"}
            </span>
          </dd>
          <dt>Changes</dt>
          <dd>
            <span className="pro-reviewer">
              {pr.files} files <Stat pr={pr} />
            </span>
            <ul className="pro-dirs">
              {pr.dirs.map((d) => (
                <li key={d.path}>
                  <span>{d.path}</span>
                  <small>{d.files} files</small>
                  <Stat pr={d as unknown as SamplePr} />
                </li>
              ))}
            </ul>
          </dd>
          {pr.progress && (
            <>
              <dt>Your review</dt>
              <dd>
                {pr.progress.viewed} of {pr.files} files viewed ·{" "}
                {pr.progress.drafts} draft comment
                {pr.progress.drafts === 1 ? "" : "s"}
              </dd>
            </>
          )}
        </dl>
      </article>
    </div>
  );
}

/* 5 · In the sidebar: the list lives where threads live; the page is an overview. */

export function SidebarList({
  pulls,
  selected,
  onOpen,
  onProjects,
}: {
  pulls: SamplePr[];
  selected?: string;
  onOpen: (pr: SamplePr) => void;
  onProjects: () => void;
}) {
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const others = byRepo(pulls.filter(rest));
  const card = (p: SamplePr) => {
    const r = repoOf(p.repo);
    return (
      <div
        key={keyOf(p)}
        role="button"
        tabIndex={0}
        className={`sb-card ${selected === keyOf(p) ? "selected" : ""}`}
        onClick={() => onOpen(p)}
      >
        <div className="sb-card-top">
          {r.project ? (
            <ProjectBadge id={r.project.id} name={r.project.name} />
          ) : (
            <span className="pro-repo-remote" aria-hidden>
              <FolderGit2 size={10} />
            </span>
          )}
          <span className="sb-card-name">
            <span className="sb-card-project">{r.project?.name ?? p.repo}</span>
          </span>
          <span className="pro-time">{ago(p.updated)}</span>
        </div>
        <div className="sb-card-title">{p.title}</div>
        <div className="sb-card-meta">
          <span className="sb-card-scope">#{p.number}</span>
          <span className="sb-card-branch">
            {p.relation === "mine" ? standing(p) : p.author}
          </span>
          <ChecksGlyph checks={p.checks} />
        </div>
      </div>
    );
  };
  return (
    <div className="sb-scroll">
      <div className="sb-view-heading">
        <h2>Pull requests</h2>
        <button className="pro-sb-back" onClick={onProjects}>
          Projects
        </button>
      </div>
      <div className="pro-sb-label">Waiting on you</div>
      <div className="sb-cards">{pulls.filter(waiting).map(card)}</div>
      <div className="pro-sb-label">Yours</div>
      <div className="sb-cards">{pulls.filter(mine).map(card)}</div>
      <div className="pro-sb-label">Everyone else</div>
      {others.map((g) => {
        const open = !folded[g.repo];
        return (
          <div key={g.repo} className="pro-sb-group">
            <button
              className="pro-sb-group-head"
              aria-expanded={open}
              onClick={() => setFolded((f) => ({ ...f, [g.repo]: open }))}
            >
              {g.project ? (
                <ProjectBadge id={g.project.id} name={g.project.name} />
              ) : (
                <span className="pro-repo-remote" aria-hidden>
                  <FolderGit2 size={10} />
                </span>
              )}
              <span>{g.project?.name ?? g.repo}</span>
              <small>{g.pulls.length}</small>
            </button>
            {open && (
              <div className="sb-thread-list">
                {g.pulls.map((p) => (
                  <button
                    key={keyOf(p)}
                    className={`sb-thread ${selected === keyOf(p) ? "selected" : ""}`}
                    onClick={() => onOpen(p)}
                  >
                    <span className="pro-sb-num">#{p.number}</span>
                    <span className="sb-thread-title">{p.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Overview({ pulls, onOpen }: OptionProps) {
  const open = pulls.filter(isOpen);
  const need = open.filter(waiting);
  const yours = open.filter(mine);
  const oldest = [...need].sort((a, b) => b.updated - a.updated)[0];
  const merged = pulls.filter((p) => p.state === "merged");
  const stale = open
    .filter((p) => p.updated >= 4 * 24 * 60)
    .sort((a, b) => b.updated - a.updated);
  const groups = byRepo(open).sort((a, b) => b.pulls.length - a.pulls.length);
  const most = Math.max(...groups.map((g) => g.pulls.length), 1);
  return (
    <div className="pro-overview">
      <div className="pro-stats">
        <div>
          <strong>{need.length}</strong>
          <span>waiting on you</span>
          {oldest && <small>oldest {ago(oldest.updated)}</small>}
        </div>
        <div>
          <strong>{yours.length}</strong>
          <span>yours open</span>
          <small>
            {yours.filter((p) => reviewOf(p) === "changes").length} with changes
            requested
          </small>
        </div>
        <div>
          <strong>{open.length}</strong>
          <span>open in total</span>
          <small>across {groups.length} repositories</small>
        </div>
        <div>
          <strong>{merged.length}</strong>
          <span>merged this week</span>
          <small>{merged.filter(mine).length} of them yours</small>
        </div>
      </div>
      <div className="pro-overview-grid">
        <section className="pro-panel">
          <h2>Open by repository</h2>
          <ul className="pro-bars">
            {groups.map((g) => {
              const forYou = g.pulls.filter(waiting).length;
              return (
                <li
                  key={g.repo}
                  title={`${g.repo}: ${g.pulls.length} open, ${forYou} waiting on you`}
                >
                  <span className="pro-bar-name">
                    <RepoLabel repo={g.repo} quiet />
                  </span>
                  <span className="pro-bar-track">
                    <i style={{ width: `${(g.pulls.length / most) * 100}%` }} />
                    <b>{g.pulls.length}</b>
                  </span>
                  <span className="pro-bar-note">
                    {forYou ? `${forYou} for you` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="pro-panel">
          <h2>Going stale</h2>
          <p className="pro-panel-note">Open, no activity for 4+ days</p>
          {stale.map((p) => (
            <button
              key={keyOf(p)}
              className="pro-mini"
              onClick={() => onOpen(p)}
            >
              <PrGlyph pr={p} size={13} />
              <span>{p.title}</span>
              <span className="pro-time">{ago(p.updated)}</span>
            </button>
          ))}
        </section>
        <section className="pro-panel">
          <h2>Recently merged</h2>
          {merged.map((p) => (
            <button
              key={keyOf(p)}
              className="pro-mini"
              onClick={() => onOpen(p)}
            >
              <PrGlyph pr={p} size={13} />
              <span>{p.title}</span>
              <span className="pro-time">{ago(p.updated)}</span>
            </button>
          ))}
        </section>
        <section className="pro-panel">
          <h2>Next up</h2>
          <p className="pro-panel-note">
            Oldest request for your review first
          </p>
          {[...need]
            .sort((a, b) => b.updated - a.updated)
            .map((p) => (
              <button
                key={keyOf(p)}
                className="pro-mini"
                onClick={() => onOpen(p)}
              >
                <PrGlyph pr={p} size={13} />
                <span>{p.title}</span>
                <span className="pro-time">{ago(p.updated)}</span>
              </button>
            ))}
        </section>
      </div>
    </div>
  );
}
