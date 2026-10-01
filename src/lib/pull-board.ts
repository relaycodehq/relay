// What the Pull requests page shows: Gitea's search for the PRs you're part
// of, and each local project's own PR list.
import type { Project } from "../../shared/projects";
import type { Issue, Pull, PullRef, Repo, Review } from "../../shared/types";

export type Relation = "review" | "assigned" | "mine" | "other";
export type Verdict = "approved" | "changes";

export interface BoardPull {
  ref: PullRef;
  /** `owner/name` as Gitea spells it. */
  repo: string;
  title: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  updatedAt: string;
  comments: number;
  relation: Relation;
  /** Only a repository's own PR list has these; search results don't. */
  head?: string;
  base?: string;
  additions?: number;
  deletions?: number;
  files?: number;
}

/** A search result, or a project's PR, which carries the Pull fields too. */
export type ListedPull = Issue &
  Partial<
    Pick<
      Pull,
      "head" | "base" | "additions" | "deletions" | "changed_files" | "draft"
    >
  > & { merged?: boolean };

export interface BoardGroup {
  /** Lower-cased `owner/name`, for matching. */
  key: string;
  repo: string;
  /** The local project checked out from it; none for a repository only on Gitea. */
  project?: Project;
  pulls: BoardPull[];
  /** All the PRs the list has, past the page loaded. */
  total: number;
  /** For you to review or look into. */
  forYou: number;
  error?: unknown;
}

export interface Board {
  pulls: BoardPull[];
  groups: BoardGroup[];
  /** Projects with nothing in the chosen state. */
  quiet: Project[];
}

export const repoKey = (r: Repo) => `${r.owner}/${r.name}`.toLowerCase();
export const pullKey = (r: PullRef) => `${repoKey(r)}#${r.number}`;
const itemRef = (item: Issue): PullRef => ({
  owner: item.repository.owner,
  name: item.repository.name,
  number: item.number,
});

/** Where the page is: a project's page, an open PR, both or neither. */
export interface PullsLocation {
  repo: { key: string; label: string } | null;
  pull: { number: number; title?: string } | null;
}
/**
 * Where the page is, for the window title: the open PR in its repository,
 * or a repository's page. A project's name stands in for its repository's.
 */
export function pullsLocation(
  selected: PullRef | null,
  title: string | undefined,
  repo: string | null,
  projectOf: (repo: Repo) => Project | undefined,
): PullsLocation {
  const label = (key: string) => {
    const [owner, name] = key.split("/");
    return projectOf({ owner, name })?.name ?? key;
  };
  return {
    repo: selected
      ? {
          key: repoKey(selected),
          label:
            projectOf(selected)?.name ?? `${selected.owner}/${selected.name}`,
        }
      : repo
        ? { key: repo, label: label(repo) }
        : null,
    pull: selected ? { number: selected.number, title } : null,
  };
}
export type PullsTarget = { to: "board" } | { to: "repo"; repo: string };
export type PullsPageHandle = {
  /** Leaves the open PR for the board or a project's page. */
  go: (target: PullsTarget) => void;
};

/** Projects whose clone is of a repository on this Gitea server. */
export function linkedProjects(projects: Project[], server: string) {
  const seen = new Set<string>();
  return projects.filter((p) => {
    if (p.scratch || p.plain || p.repository?.server !== server) return false;
    const key = repoKey(p.repository);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function projectFor(projects: Project[], server: string, repo: Repo) {
  const key = repoKey(repo);
  return linkedProjects(projects, server).find(
    (p) => repoKey(p.repository!) === key,
  );
}

export function boardPull(item: ListedPull, relation: Relation): BoardPull {
  const merged = item.merged ?? item.pull_request?.merged ?? false;
  return {
    ref: itemRef(item),
    repo: item.repository.full_name,
    title: item.title,
    author: item.user.login,
    state: merged ? "merged" : item.state === "closed" ? "closed" : "open",
    // Gitea marks a draft by its title; search results have no draft field.
    draft: item.draft ?? /^\s*(\[wip\]|wip:)/i.test(item.title),
    updatedAt: item.updated_at,
    comments: item.comments,
    relation,
    head: item.head?.ref,
    base: item.base?.ref,
    additions: item.additions,
    deletions: item.deletions,
    files: item.changed_files,
  };
}

export interface BoardInput {
  server: string;
  login: string;
  projects: Project[];
  /** Gitea's searches: review requested from you, assigned to you, yours. */
  review: Issue[];
  assigned: Issue[];
  created: Issue[];
  /** Each linked project's PR list, by project id; missing while loading. */
  lists: Record<
    string,
    { items: ListedPull[]; total: number } | { error: unknown }
  >;
}

export function buildBoard(input: BoardInput): Board {
  const review = new Set(input.review.map((i) => pullKey(itemRef(i))));
  const assigned = new Set(input.assigned.map((i) => pullKey(itemRef(i))));
  const login = input.login.toLowerCase();
  const relation = (item: Issue): Relation => {
    const key = pullKey(itemRef(item));
    if (item.user.login.toLowerCase() === login) return "mine";
    if (review.has(key)) return "review";
    if (assigned.has(key)) return "assigned";
    return "other";
  };
  const byKey = new Map<string, BoardPull>();
  const add = (item: ListedPull) => {
    const key = pullKey(itemRef(item));
    const next = boardPull(item, relation(item));
    const known = byKey.get(key);
    // A project's list knows branches and sizes; keep what either one said.
    byKey.set(key, known ? { ...known, ...defined(next) } : next);
    return key;
  };
  for (const item of [...input.review, ...input.assigned, ...input.created])
    add(item);

  const linked = linkedProjects(input.projects, input.server);
  const groups: BoardGroup[] = [];
  const quiet: Project[] = [];
  const covered = new Set<string>();
  for (const project of linked) {
    const key = repoKey(project.repository!);
    covered.add(key);
    const list = input.lists[project.id];
    const repo = `${project.repository!.owner}/${project.repository!.name}`;
    if (!list) continue;
    if ("error" in list) {
      groups.push({
        key,
        repo,
        project,
        pulls: [],
        total: 0,
        forYou: 0,
        error: list.error,
      });
      continue;
    }
    const keys = new Set(list.items.map(add));
    // Involved PRs past the loaded page still belong on the card.
    for (const [k, p] of byKey) if (repoKey(p.ref) === key) keys.add(k);
    const pulls = [...keys].map((k) => byKey.get(k)!);
    if (!pulls.length) quiet.push(project);
    else
      groups.push({
        key,
        repo,
        project,
        pulls: newestFirst(pulls),
        total: Math.max(list.total, pulls.length),
        forYou: 0,
      });
  }
  const remote = new Map<string, BoardPull[]>();
  for (const p of byKey.values()) {
    const key = repoKey(p.ref);
    if (covered.has(key)) continue;
    remote.set(key, [...(remote.get(key) ?? []), p]);
  }
  for (const [key, pulls] of remote)
    groups.push({
      key,
      repo: pulls[0].repo,
      pulls: newestFirst(pulls),
      total: pulls.length,
      forYou: 0,
    });
  for (const g of groups) g.forYou = g.pulls.filter(waitsOnYou).length;
  return {
    pulls: newestFirst([...byKey.values()]),
    groups: groups.sort(byAttention),
    quiet,
  };
}

/** Someone asked for your review or handed it to you. */
export const waitsOnYou = (p: BoardPull) =>
  p.state === "open" && (p.relation === "review" || p.relation === "assigned");

/** Waiting on you, or yours and reviewed: to fix or to merge. */
export const needsYou = (p: BoardPull, verdict?: Verdict | null) =>
  waitsOnYou(p) ||
  (p.relation === "mine" && p.state === "open" && !p.draft && !!verdict);

/**
 * Cards with PRs waiting on you first, then ones with your own open PRs,
 * then the most recently active. Nothing that loads later reorders them.
 */
function byAttention(a: BoardGroup, b: BoardGroup) {
  const own = (g: BoardGroup) =>
    g.pulls.filter((p) => p.relation === "mine" && p.state === "open").length;
  return (
    b.forYou - a.forYou ||
    own(b) - own(a) ||
    latest(b) - latest(a) ||
    a.repo.localeCompare(b.repo)
  );
}
const latest = (g: BoardGroup) =>
  Math.max(0, ...g.pulls.map((p) => Date.parse(p.updatedAt) || 0));
const newestFirst = (pulls: BoardPull[]) =>
  [...pulls].sort(
    (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
  );
const defined = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

/**
 * Where reviewers left a PR: each one's latest verdict counts. A dismissed
 * review doesn't, and neither does an approval of older commits; a request
 * for changes stands until its reviewer looks again.
 */
export function verdictOf(reviews: Review[]): Verdict | null {
  const latestBy = new Map<number, Review>();
  for (const r of reviews) {
    if (
      (r.state !== "APPROVED" && r.state !== "REQUEST_CHANGES") ||
      r.dismissed
    )
      continue;
    const known = latestBy.get(r.user.id);
    if (!known || later(r, known)) latestBy.set(r.user.id, r);
  }
  const standing = [...latestBy.values()];
  if (standing.some((r) => r.state === "REQUEST_CHANGES")) return "changes";
  if (standing.some((r) => r.state === "APPROVED" && !r.stale))
    return "approved";
  return null;
}
function later(a: Review, b: Review) {
  const at = Date.parse(a.submitted_at),
    bt = Date.parse(b.submitted_at);
  return Number.isFinite(at) && Number.isFinite(bt) && at !== bt
    ? at > bt
    : a.id > b.id;
}
