// The Pull requests page: what needs you, then a card per project. A card
// opens that project's page, sorted the same way: waiting on you, yours,
// everyone else's.
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertCircle,
  ChevronRight,
  FolderGit2,
  FolderPlus,
  GitPullRequest,
  Link2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { tildePath, type Project } from "../../../shared/projects";
import type { Account, Repo } from "../../../shared/types";
import { api } from "../../lib/api";
import {
  boardPull,
  keyRepo,
  needsYou,
  onServer,
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
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { hostKindOf, pullHostName } from "../../../shared/source-control";
import { errorMessage } from "../../lib/error-message";
import { accountOn } from "./usePullHosts";
import "./pull-requests.css";

/** The window title's trail back from a PR or a project's page. Back goes up
 *  one crumb, and from the board leaves the page. */
export function PullsTitle({
  where,
  onNav,
  onLeave,
}: {
  where: PullsLocation;
  onNav: (target: PullsTarget) => void;
  onLeave: () => void;
}) {
  const { repo, pull } = where;
  const back = () => {
    if (pull && repo) onNav({ to: "repo", repo: repo.key });
    else if (pull || repo) onNav({ to: "board" });
    else onLeave();
  };
  return (
    <div className="project-window-title pulls-title">
      <IconButton label="Back" onClick={back}>
        <ArrowLeft size={15} />
      </IconButton>
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
  accounts,
  hostError,
  onRecheckHosts,
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
  /** Every host you're signed in to; their PRs share the page. */
  accounts: Account[];
  /** A host you're signed in to didn't answer, so its PRs are missing. */
  hostError?: unknown;
  onRecheckHosts: () => void;
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
  const {
    board,
    verdicts,
    started,
    loading,
    pending,
    failures,
    fetching,
    retry,
  } = usePullBoard(accounts, projects, state);
  const incomplete = !!pending.length || !!failures.length || !!hostError;
  const waiting = `Waiting for ${pending.map(pullHostName).join(", ")}…`;
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
  const projectOf = (r: Repo) => projectFor(projects, r);
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
        summary: <SearchSummary accounts={accounts} />,
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
            <BoardSummary
              board={board}
              needs={needs.length}
              state={state}
              incomplete={incomplete}
            />
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
                onClick={() => onAddProject(group?.ref ?? keyRepo(repo))}
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
            onClick={() => {
              // A login made since may be someone else: it decides which PRs are yours.
              onRecheckHosts();
              void qc.invalidateQueries({ queryKey: [PULL_BOARD] });
            }}
          >
            <RefreshCw size={14} className={fetching ? "spin" : ""} />
          </button>
        </div>
      </header>
      {(!!failures.length || !!hostError) && (
        <div className="pulls-notices">
          {failures.map(({ server, error }) => (
            <PullLoadNotice
              key={server}
              title={`${pullHostName(server)} unavailable`}
              error={error}
              onReload={() => {
                // A refused sign-in may come back as another account.
                onRecheckHosts();
                retry(server);
              }}
            />
          ))}
          {!!hostError && (
            <PullLoadNotice
              title="Provider unavailable"
              error={hostError}
              onReload={onRecheckHosts}
            />
          )}
        </div>
      )}
      {!!pending.length && !loading && !query && (
        <p className="pulls-note" role="status">
          {waiting}
        </p>
      )}
      {query ? (
        <SearchResults
          query={query}
          state={state}
          accounts={accounts}
          board={board}
          context={context}
          projectOf={projectOf}
        />
      ) : repo ? (
        <ProjectPulls
          repo={repo}
          project={pageProject}
          state={state}
          accounts={accounts}
          board={board}
          context={context}
        />
      ) : loading ? (
        <Loading text={waiting} />
      ) : (
        <BoardView
          board={board}
          needs={needs}
          state={state}
          context={context}
          projectOf={projectOf}
          onRepo={onRepo}
          onAddProject={() => onAddProject()}
          incomplete={incomplete}
        />
      )}
    </div>
  );
}

/** A connection hiccup stays beside the results, with the full error on demand. */
function PullLoadNotice({
  title,
  error,
  onReload,
}: {
  title: string;
  error: unknown;
  onReload: () => void;
}) {
  return (
    <section className="pulls-notice" role="alert" aria-label={title}>
      <div className="pulls-notice-main">
        <AlertCircle size={16} aria-hidden="true" />
        <div className="pulls-notice-copy">
          <strong>{title}</strong>
          <span>Some pull requests may be missing.</span>
        </div>
        <button
          type="button"
          className="pulls-notice-reload"
          aria-label={`Reload: ${title}`}
          onClick={onReload}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Reload
        </button>
      </div>
      <details className="pulls-notice-details">
        <summary>
          Details
          <ChevronRight size={12} aria-hidden="true" />
        </summary>
        <p>{errorMessage(error)}</p>
      </details>
    </section>
  );
}

/**
 * GitHub searches only what you're part of unless asked wider, Azure DevOps
 * reads through its newest PRs, Gitea searches all.
 */
function SearchSummary({ accounts }: { accounts: Account[] }) {
  const kinds = new Set(accounts.map((a) => hostKindOf(a.server)));
  if (kinds.size === 1 && kinds.has("github"))
    return (
      <>
        Searching pull requests you're part of; add repo: or org: to look wider
      </>
    );
  const parts = [
    kinds.has("gitea") &&
      (kinds.size === 1
        ? "every repository you can see"
        : "every repository you can see on Gitea"),
    kinds.has("github") &&
      "on GitHub the pull requests you're part of (add repo: or org: to look wider)",
    kinds.has("azure-devops") &&
      "the newest 1,000 pull requests in each Azure DevOps organization",
  ].filter(Boolean);
  return <>Searching {parts.join(", and ")}</>;
}

function BoardSummary({
  board,
  needs,
  state,
  incomplete,
}: {
  board: Board;
  needs: number;
  state: PullState;
  incomplete: boolean;
}) {
  const total = board.groups.reduce((n, g) => n + g.total, 0);
  const repos = board.groups.length;
  return (
    <>
      {incomplete ? (
        <>Showing available pull requests · </>
      ) : (
        state === "open" && (
          <>
            <strong>{needs ? `${needs} need you` : "Nothing needs you"}</strong>
            {" · "}
          </>
        )
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
      · {project ? tildePath(project.path) : "not cloned here"}
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
  incomplete,
}: {
  board: Board;
  needs: BoardPull[];
  state: PullState;
  context: PullContext;
  projectOf: (r: Repo) => Project | undefined;
  onRepo: (repo: string) => void;
  onAddProject: () => void;
  incomplete: boolean;
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
          {incomplete
            ? "No pull requests loaded"
            : board.quiet.length || state !== "open"
              ? `No ${state === "all" ? "" : `${state} `}pull requests`
              : "No pull requests yet"}
        </h2>
        <p>
          {incomplete ? (
            "Some providers haven’t answered. Their pull requests may be missing."
          ) : (
            <>
              PRs you’re asked to review, assigned or opened show up here, and
              so does every PR in your project folders.
            </>
          )}
        </p>
        {!incomplete && (
          <button onClick={onAddProject}>
            <FolderPlus size={15} />
            Add project folder
          </button>
        )}
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
  accounts,
  board,
  context,
}: {
  repo: string;
  project?: Project;
  state: PullState;
  accounts: Account[];
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
    relate(
      onServer(item as ListedPull, project!.repository!.server),
      board,
      accounts,
    ),
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
  accounts,
  board,
  context,
  projectOf,
}: {
  query: string;
  state: PullState;
  accounts: Account[];
  board: Board;
  context: PullContext;
  projectOf: (r: Repo) => Project | undefined;
}) {
  const found = usePullSearch(query, state, accounts);
  if (found.isPending) return <Loading text="Searching…" />;
  if (!found.data)
    return <ErrorBox error={found.error} retry={() => void found.refetch()} />;
  const pulls = found.data.pages
    .flatMap((page) => page.items)
    .map((item) => relate(item, board, accounts));
  const missed = found.data.pages.find((page) => page.failed.length)?.failed[0];
  if (!pulls.length)
    return (
      <>
        <p className="pulls-none">
          {missed ? "Nothing that answered matches" : "No pull requests match"}{" "}
          “{query}”.
        </p>
        {!!missed && (
          <ErrorBox error={missed} retry={() => void found.refetch()} />
        )}
      </>
    );
  return (
    <section className="pulls-section">
      <h2>
        Results
        <small>
          {found.data.pages[0].total ?? pulls.length}
          {found.hasNextPage ? "+" : ""}
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
      {!found.error && !!missed && (
        <ErrorBox error={missed} retry={() => void found.refetch()} />
      )}
      {found.error && (
        <ErrorBox
          error={found.error}
          retry={() =>
            void (found.isFetchNextPageError
              ? found.fetchNextPage()
              : found.refetch())
          }
        />
      )}
      {found.hasNextPage && !found.isFetchNextPageError && (
        <button
          className="pulls-more"
          disabled={found.isFetchingNextPage}
          onClick={() => void found.fetchNextPage()}
        >
          {found.isFetchingNextPage ? "Loading…" : "Load more pull requests"}
        </button>
      )}
    </section>
  );
}

/** A listed PR, which names its server, related to you the way the board already knows it. */
function relate(item: ListedPull, board: Board, accounts: Account[]) {
  const server = item.repository.server!;
  const known = board.pulls.find(
    (p) =>
      p.ref.number === item.number &&
      repoKey(p.ref) === repoKey(item.repository),
  );
  const login = accountOn(accounts, server)?.user.login.toLowerCase();
  const relation: Relation =
    known?.relation ??
    (item.user.login.toLowerCase() === login ? "mine" : "other");
  return boardPull(item, relation, server);
}
