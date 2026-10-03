// The Pull requests page: what needs you, then a card per project. A card
// opens that project's page, sorted the same way: waiting on you, yours,
// everyone else's.
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FolderGit2,
  FolderPlus,
  GitPullRequest,
  Link2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Project } from "../../../shared/projects";
import type { Account, Repo } from "../../../shared/types";
import { api } from "../../lib/api";
import {
  boardPull,
  needsYou,
  projectFor,
  pullKey,
  repoKey,
  waitsOnYou,
  type Board,
  type BoardPull,
  type ListedPull,
  type PullsLocation,
  type PullsTarget,
  type Relation,
} from "./pull-board";
import {
  PULL_BOARD,
  usePullBoard,
  usePullSearch,
  type PullState,
} from "./usePullBoard";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";
import {
  NeedsTile,
  ProjectCard,
  PullRow,
  RepoMark,
  type PullContext,
} from "./PullRows";
import { ErrorBox, Loading } from "../../ui/ui";
import "./pull-requests.css";

/** The window title's trail back from a PR or a project's page. */
export function PullsTitle({
  where,
  onNav,
}: {
  where: PullsLocation;
  onNav: (target: PullsTarget) => void;
}) {
  const { repo, pull } = where;
  return (
    <div className="project-window-title pulls-title">
      <GitPullRequest size={14} />
      {repo || pull ? (
        <button onClick={() => onNav({ to: "board" })}>Pull requests</button>
      ) : (
        <strong>Pull requests</strong>
      )}
      {repo && (
        <>
          <span className="breadcrumb-slash">/</span>
          {pull ? (
            <button onClick={() => onNav({ to: "repo", repo: repo.key })}>
              {repo.label}
            </button>
          ) : (
            <strong>{repo.label}</strong>
          )}
        </>
      )}
      {pull && (
        <>
          <span className="breadcrumb-slash">/</span>
          <strong>
            #{pull.number}
            {pull.title && ` ${pull.title}`}
          </strong>
        </>
      )}
    </div>
  );
}

export function PullRequestsPage({
  account,
  projects,
  repo,
  onRepo,
  query,
  onQuery,
  state,
  onState,
  onOpen,
  onOpenUrl,
  onOpenProject,
  onAddProject,
}: {
  account: Account;
  projects: Project[];
  /** The project page showing, by `repoKey`; null for the board. */
  repo: string | null;
  onRepo: (repo: string | null) => void;
  query: string;
  onQuery: (query: string) => void;
  state: PullState;
  onState: (state: PullState) => void;
  onOpen: (pull: BoardPull) => void;
  onOpenUrl: () => void;
  onOpenProject: (project: Project) => void;
  /** Adds a clone of `repo` as a project. */
  onAddProject: (repo?: Repo) => void;
}) {
  const qc = useQueryClient();
  const { board, verdicts, started, loading, error, fetching, retry } =
    usePullBoard(account, projects, state);
  const [typed, setTyped] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => onQuery(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const searchRef = useRef<HTMLInputElement>(null);
  useShortcut("find", true, () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });
  const searchKeys = useShortcutLabel("find");
  const openKeys = useShortcutLabel("pr-open");
  const context: PullContext = { verdicts, started, onOpen };
  const projectOf = (r: Repo) => projectFor(projects, account.server, r);
  const group = repo ? board.groups.find((g) => g.key === repo) : undefined;
  // A quiet project has no card, but its page still opens from the quiet line.
  const pageProject =
    group?.project ??
    board.quiet.find((p) => p.repository && repoKey(p.repository) === repo);
  const repoName = pageProject?.name ?? group?.repo ?? repo;
  const needs = board.pulls.filter((p) =>
    needsYou(p, verdicts.get(pullKey(p.ref))),
  );

  const head = query
    ? {
        title: "Pull requests",
        summary: <>Searching every repository you can see</>,
      }
    : repo
      ? {
          crumb: (
            <nav className="pulls-crumbs">
              <button onClick={() => onRepo(null)}>All projects</button>
              <ChevronRight size={13} />
            </nav>
          ),
          title: (
            <>
              <RepoMark project={pageProject} />
              {repoName}
            </>
          ),
          summary: (
            <RepoSummary
              repo={repo}
              project={pageProject}
              pulls={board.pulls.filter((p) => repoKey(p.ref) === repo)}
            />
          ),
        }
      : {
          title: "Pull requests",
          summary: loading ? (
            <>Finding your pull requests…</>
          ) : (
            <BoardSummary board={board} needs={needs.length} state={state} />
          ),
        };

  return (
    <div className="pulls-page">
      <header className="pulls-head">
        <div className="pulls-head-text">
          {head.crumb}
          <h1>{head.title}</h1>
          <p>{head.summary}</p>
        </div>
        <div className="pulls-tools">
          <label className="pulls-search">
            <Search size={13} />
            <input
              ref={searchRef}
              aria-label="Search pull requests"
              placeholder="Search pull requests"
              value={typed}
              maxLength={500}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && typed) {
                  e.stopPropagation();
                  setTyped("");
                }
              }}
            />
            {typed ? (
              <button
                className="pulls-search-clear"
                aria-label="Clear search"
                onClick={() => setTyped("")}
              >
                <X size={12} />
              </button>
            ) : (
              searchKeys && <kbd>{searchKeys}</kbd>
            )}
          </label>
          <div className="pulls-states" role="radiogroup" aria-label="State">
            {(["open", "closed", "all"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={state === s}
                onClick={() => onState(s)}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {repo && !query ? (
            pageProject ? (
              <button
                className="pulls-quiet-button"
                onClick={() => onOpenProject(pageProject)}
              >
                <FolderGit2 size={14} />
                Open project
              </button>
            ) : (
              <button
                className="pulls-quiet-button"
                onClick={() => onAddProject(refOf(repo, group?.repo))}
              >
                <FolderPlus size={14} />
                Add its folder…
              </button>
            )
          ) : (
            <button
              className="pulls-quiet-button"
              title={`Open a pull request by its link${openKeys && ` (${openKeys})`}`}
              onClick={onOpenUrl}
            >
              <Link2 size={14} />
              Open by URL
            </button>
          )}
          <button
            className="pulls-icon-button"
            aria-label="Refresh pull requests"
            onClick={() =>
              void qc.invalidateQueries({ queryKey: [PULL_BOARD] })
            }
          >
            <RefreshCw size={14} className={fetching ? "spin" : ""} />
          </button>
        </div>
      </header>
      {error && <ErrorBox error={error} retry={retry} />}
      {query ? (
        <SearchResults
          query={query}
          state={state}
          account={account}
          board={board}
          context={context}
          projectOf={projectOf}
        />
      ) : repo ? (
        <ProjectPulls
          repo={repo}
          project={pageProject}
          state={state}
          account={account}
          board={board}
          context={context}
        />
      ) : loading ? (
        <Loading text="Finding your pull requests…" />
      ) : (
        <BoardView
          board={board}
          needs={needs}
          state={state}
          context={context}
          projectOf={projectOf}
          onRepo={onRepo}
          onAddProject={() => onAddProject()}
        />
      )}
    </div>
  );
}

function BoardSummary({
  board,
  needs,
  state,
}: {
  board: Board;
  needs: number;
  state: PullState;
}) {
  const total = board.groups.reduce((n, g) => n + g.total, 0);
  const repos = board.groups.length;
  return (
    <>
      {state === "open" && (
        <>
          <strong>{needs ? `${needs} need you` : "Nothing needs you"}</strong>
          {" · "}
        </>
      )}
      {total} {state === "all" ? "" : `${state} `}in {repos}{" "}
      {repos === 1 ? "repository" : "repositories"}
    </>
  );
}

function RepoSummary({
  repo,
  project,
  pulls,
}: {
  repo: string;
  project?: Project;
  pulls: BoardPull[];
}) {
  const waiting = pulls.filter(waitsOnYou).length;
  const mine = pulls.filter(
    (p) => p.relation === "mine" && p.state === "open",
  ).length;
  return (
    <>
      {project?.repository
        ? `${project.repository.owner}/${project.repository.name}`
        : repo}{" "}
      · {project ? tildePath(project.path) : "not on this Mac"}
      {waiting > 0 && (
        <>
          {" · "}
          <strong>{waiting} waiting on you</strong>
        </>
      )}
      {mine > 0 && ` · ${mine} of yours`}
    </>
  );
}

function BoardView({
  board,
  needs,
  state,
  context,
  projectOf,
  onRepo,
  onAddProject,
}: {
  board: Board;
  needs: BoardPull[];
  state: PullState;
  context: PullContext;
  projectOf: (r: Repo) => Project | undefined;
  onRepo: (repo: string) => void;
  onAddProject: () => void;
}) {
  // Asked of you first, then your own: what you'd act on in that order.
  const order: Record<Relation, number> = {
    review: 0,
    assigned: 1,
    mine: 2,
    other: 3,
  };
  const tiles = [...needs].sort(
    (a, b) => order[a.relation] - order[b.relation],
  );
  if (!board.groups.length && !tiles.length)
    return (
      <div className="pulls-empty">
        <GitPullRequest size={30} />
        <h2>
          {board.quiet.length || state !== "open"
            ? `No ${state === "all" ? "" : `${state} `}pull requests`
            : "No pull requests yet"}
        </h2>
        <p>
          PRs you’re asked to review, assigned or opened show up here, and so
          does every PR in your project folders.
        </p>
        <button onClick={onAddProject}>
          <FolderPlus size={15} />
          Add project folder
        </button>
      </div>
    );
  return (
    <>
      {tiles.length > 0 && (
        <section className="pulls-section">
          <h2>
            Needs you<small>{tiles.length}</small>
          </h2>
          <div className="pulls-tiles">
            {tiles.map((p) => (
              <NeedsTile
                key={pullKey(p.ref)}
                pull={p}
                context={context}
                project={projectOf(p.ref)}
              />
            ))}
          </div>
        </section>
      )}
      {board.groups.length > 0 && (
        <section className="pulls-section">
          <h2>
            Projects<small>{board.groups.length}</small>
          </h2>
          <div className="pulls-cards">
            {board.groups.map((g) => (
              <ProjectCard
                key={g.key}
                group={g}
                context={context}
                onRepo={onRepo}
              />
            ))}
          </div>
        </section>
      )}
      {board.quiet.length > 0 && (
        <p className="pulls-quiet">
          {state === "open"
            ? "Nothing open in "
            : state === "closed"
              ? "Nothing closed in "
              : "No pull requests in "}
          {board.quiet.map((p, i) => (
            <span key={p.id}>
              <button onClick={() => onRepo(repoKey(p.repository!))}>
                {p.name}
              </button>
              {i < board.quiet.length - 2
                ? ", "
                : i === board.quiet.length - 2
                  ? " and "
                  : ""}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function ProjectPulls({
  repo,
  project,
  state,
  account,
  board,
  context,
}: {
  repo: string;
  project?: Project;
  state: PullState;
  account: Account;
  board: Board;
  context: PullContext;
}) {
  const list = useInfiniteQuery({
    queryKey: [PULL_BOARD, "project-all", project?.id, state],
    queryFn: ({ pageParam }) => api.projectPulls(project!.id, state, pageParam),
    initialPageParam: 1,
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: !!project,
  });
  const involved = board.pulls.filter((p) => repoKey(p.ref) === repo);
  const listed = (list.data?.pages.flatMap((p) => p.items) ?? []).map((item) =>
    relate(item as ListedPull, board, account),
  );
  const keys = new Set(listed.map((p) => pullKey(p.ref)));
  // Your PRs past the loaded pages still show; a repository with no clone
  // here only has those.
  const pulls = [
    ...listed,
    ...involved.filter((p) => !keys.has(pullKey(p.ref))),
  ];
  const sections: [string, BoardPull[]][] = [
    ["Waiting on you", pulls.filter(waitsOnYou)],
    ["Yours", pulls.filter((p) => p.relation === "mine")],
    [
      "Everyone else",
      pulls.filter((p) => !waitsOnYou(p) && p.relation !== "mine"),
    ],
  ];
  if (project && list.isPending)
    return <Loading text="Loading its pull requests…" />;
  if (project && list.error)
    return <ErrorBox error={list.error} retry={() => void list.refetch()} />;
  return (
    <>
      {!project && (
        <p className="pulls-note">
          Only the pull requests you’re part of. Add its folder as a project to
          see all of them.
        </p>
      )}
      {!pulls.length && (
        <p className="pulls-none">
          {state === "open"
            ? "Nothing open here right now."
            : state === "closed"
              ? "Nothing closed here yet."
              : "No pull requests here yet."}
        </p>
      )}
      {sections.map(
        ([title, items]) =>
          items.length > 0 && (
            <section key={title} className="pulls-section">
              <h2>
                {title}
                <small>{items.length}</small>
              </h2>
              <div className="pulls-list">
                {items.map((p) => (
                  <PullRow
                    key={pullKey(p.ref)}
                    pull={p}
                    context={context}
                    inProject
                  />
                ))}
              </div>
            </section>
          ),
      )}
      {list.hasNextPage && (
        <button
          className="pulls-more"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "Loading…" : "Load more pull requests"}
        </button>
      )}
    </>
  );
}

function SearchResults({
  query,
  state,
  account,
  board,
  context,
  projectOf,
}: {
  query: string;
  state: PullState;
  account: Account;
  board: Board;
  context: PullContext;
  projectOf: (r: Repo) => Project | undefined;
}) {
  const found = usePullSearch(query, state, account.id);
  if (found.isPending) return <Loading text="Searching…" />;
  if (found.error)
    return <ErrorBox error={found.error} retry={() => void found.refetch()} />;
  const pulls = found.data.items.map((item) => relate(item, board, account));
  if (!pulls.length)
    return <p className="pulls-none">No pull requests match “{query}”.</p>;
  return (
    <section className="pulls-section">
      <h2>
        Results
        <small>
          {found.data.total ?? pulls.length}
          {found.data.nextPage ? "+" : ""}
        </small>
      </h2>
      <div className="pulls-list">
        {pulls.map((p) => (
          <PullRow
            key={pullKey(p.ref)}
            pull={p}
            context={context}
            project={projectOf(p.ref)}
          />
        ))}
      </div>
    </section>
  );
}

/** A listed PR, related to you the way the board already knows it. */
function relate(item: ListedPull, board: Board, account: Account) {
  const known = board.pulls.find(
    (p) =>
      p.ref.number === item.number &&
      repoKey(p.ref) === repoKey(item.repository),
  );
  const relation: Relation =
    known?.relation ??
    (item.user.login.toLowerCase() === account.user.login.toLowerCase()
      ? "mine"
      : "other");
  return boardPull(item, relation);
}

function refOf(key: string, repo?: string): Repo {
  const [owner, name] = (repo ?? key).split("/");
  return { owner, name };
}

const tildePath = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");
