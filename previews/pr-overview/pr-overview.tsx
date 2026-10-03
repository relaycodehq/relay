// Options for the Pull requests page, inside the real app shell on sample data.
// Open http://127.0.0.1:5177/previews/pr-overview/ (?option=triage|board|table|peek|sidebar)
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Bell,
  ChevronRight,
  FolderGit2,
  FolderPlus,
  GitPullRequest,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/changes/changed-files.css";
import "../../src/app/ci-status.css";
import "../_shared/chrome.css";
import "./pr-overview.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import { ProjectBadge } from "../../src/features/projects/ProjectBadge";
import { RelayMark } from "../../src/ui/RelayMark";
import type { Api } from "../../shared/types";
import {
  chats,
  isOpen,
  keyOf,
  projects,
  pulls,
  repoOf,
  threadFor,
  type SamplePr,
} from "./pr-overview-data";
import { PageHead, type StateFilter } from "./pr-overview-parts";
import {
  Board,
  BoardTriage,
  Overview,
  Peek,
  SidebarList,
  Table,
  Triage,
  mine,
  needsYou,
  waiting,
  type OptionProps,
} from "./pr-overview-options";
import { OpenedPr } from "./pr-overview-opened";

localStorage.setItem(
  "relay-project-expansion",
  JSON.stringify({
    licensing: true,
    relay: true,
    portal: false,
    openusage: false,
    dotfiles: false,
    website: false,
  }),
);
initAppearance();
initWindowFocus();

Object.assign(window.relay, {
  projectChats: async (id: string) => chats.filter((c) => c.projectId === id),
  scratchChats: async () => [],
  projectGroups: async () => [],
  updateState: async () => ({ status: "off", current: "0.1.0" }),
  onUpdate: () => () => {},
  agentVersions: async () => ({ agents: [], checking: false }),
  onAgentVersions: () => () => {},
  onProjectChat: () => () => {},
  triageProjectChat: async () => {},
} satisfies Partial<Record<keyof Api, unknown>>);

const options = [
  {
    id: "triage",
    label: "1 · Triage",
    idea: "What needs you first, yours next, everyone else by project.",
  },
  {
    id: "board",
    label: "2 · Projects",
    idea: "A card per repository; click a card to see all its PRs.",
  },
  {
    id: "board-triage",
    label: "2b · Projects + triage",
    idea: "Cards sorted by what needs you; a project's page is its own triage. Esc steps back.",
  },
  {
    id: "table",
    label: "3 · Table",
    idea: "Dense and sortable, grouped by project. ↑/↓ and ⏎ work.",
  },
  {
    id: "peek",
    label: "4 · List + peek",
    idea: "Skim a PR's summary before opening it. ↑/↓, ⏎ or double-click opens.",
  },
  {
    id: "sidebar",
    label: "5 · In the sidebar",
    idea: "PRs become a sidebar view like Activity; the page is a dashboard.",
  },
] as const;
type Option = (typeof options)[number]["id"];

const params = new URLSearchParams(location.search);

function Preview() {
  const [option, setOption] = useState<Option>(
    () =>
      (options.find((o) => o.id === params.get("option"))?.id ??
        "triage") as Option,
  );
  const [opened, setOpened] = useState<SamplePr | null>(null);
  const [state, setState] = useState<StateFilter>("open");
  const [query, setQuery] = useState("");
  const [sidebarView, setSidebarView] = useState<"prs" | "projects">("prs");
  const [focusRepo, setFocusRepo] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("option", option);
    history.replaceState(null, "", url);
    setOpened(null);
    setSidebarView("prs");
    setFocusRepo(null);
  }, [option]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement).closest("input"))
        return;
      if (opened) setOpened(null);
      else setFocusRepo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened]);

  const q = query.trim().toLowerCase();
  const matching = pulls.filter(
    (p) =>
      (state === "all" ||
        (state === "open" ? isOpen(p) : !isOpen(p))) &&
      (!q ||
        `${p.title} ${p.repo} #${p.number} ${p.author}`
          .toLowerCase()
          .includes(q)),
  );
  const counts = {
    open: pulls.filter(isOpen).length,
    closed: pulls.filter((p) => !isOpen(p)).length,
    all: pulls.length,
  };
  const props: OptionProps = { pulls: matching, state, onOpen: setOpened };
  const waitingCount = pulls.filter(
    (p) => isOpen(p) && (p.relation === "review" || p.relation === "assigned"),
  ).length;
  const summary = (
    <>
      <strong>{waitingCount} waiting on you</strong> ·{" "}
      {pulls.filter((p) => isOpen(p) && p.relation === "mine").length} of yours
      open · {counts.open} open across{" "}
      {new Set(pulls.filter(isOpen).map((p) => p.repo)).size} repositories
    </>
  );
  const repoCount = new Set(pulls.filter(isOpen).map((p) => p.repo)).size;
  // 2b's project page takes over the page header instead of stacking under it.
  const focus =
    option === "board-triage" && focusRepo ? repoOf(focusRepo) : undefined;
  const focusName = focus?.project?.name ?? focus?.repo;
  const focusPulls = matching.filter((p) => p.repo === focus?.repo);
  const head = focus
    ? {
        crumb: (
          <nav className="pro-crumbs">
            <button onClick={() => setFocusRepo(null)}>All projects</button>
            <ChevronRight size={13} />
          </nav>
        ),
        title: (
          <>
            {focus.project ? (
              <ProjectBadge id={focus.project.id} name={focus.project.name} />
            ) : (
              <span className="pro-repo-remote" aria-hidden>
                <FolderGit2 size={13} />
              </span>
            )}
            {focusName}
          </>
        ),
        summary: (
          <>
            {focus.repo} ·{" "}
            {focus.project?.path.replace("/Users/you", "~") ??
              "not checked out on this Mac"}{" "}
            {focusPulls.some(waiting) && (
              <>
                {" "}
                ·{" "}
                <strong>
                  {focusPulls.filter(waiting).length} waiting on you
                </strong>
              </>
            )}
            {focusPulls.some(mine) &&
              ` · ${focusPulls.filter(mine).length} of yours`}
          </>
        ),
        placeholder: `Search ${focusName}`,
        counts: {
          open: pulls.filter((p) => p.repo === focus.repo && isOpen(p)).length,
          closed: pulls.filter((p) => p.repo === focus.repo && !isOpen(p))
            .length,
          all: pulls.filter((p) => p.repo === focus.repo).length,
        },
        actions: focus.project ? (
          <button className="pro-quiet-button">
            <FolderGit2 size={14} />
            Open project
          </button>
        ) : (
          <button className="pro-quiet-button">
            <FolderPlus size={14} />
            Link a folder…
          </button>
        ),
      }
    : option === "board-triage"
      ? {
          summary: (
            <>
              <strong>{pulls.filter(needsYou).length} need you</strong> ·{" "}
              {counts.open} open across {repoCount} repositories
            </>
          ),
        }
      : { summary };
  const project = opened ? repoOf(opened.repo).project : undefined;
  const thread = opened ? threadFor(opened) : undefined;
  const current = options.find((o) => o.id === option)!;

  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>
          <GitPullRequest size={14} /> Pull requests page
        </strong>
        <span className="preview-tag">Sample data</span>
        <div className="preview-segmented" role="radiogroup" aria-label="Option">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={option === o.id}
              onClick={() => setOption(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span>
          {opened
            ? "Opened: a sketch of today's PR thread + Review pane. Esc, or Pull requests in the sidebar, goes back."
            : current.idea + " Click any PR to open it."}
        </span>
      </div>
      <div
        className={`app project-app platform-darwin pv-window ${
          !opened && option !== "sidebar" ? "pv-on-prs" : ""
        }`}
      >
        <header className="titlebar project-titlebar">
          <div className="project-titlebar-brand">
            <span className="traffic-space pv-traffic">
              <i />
              <i />
              <i />
            </span>
            <button
              type="button"
              className="icon-button relay-sidebar-toggle"
              aria-label="Hide sidebar"
            >
              <PanelLeft size={16} />
            </button>
            <RelayMark size={38} />
          </div>
          <div className="project-window-title">
            {opened ? (
              <>
                {project ? (
                  <ProjectBadge id={project.id} name={project.name} />
                ) : (
                  <GitPullRequest size={14} />
                )}
                <span>{project?.name ?? opened.repo}</span>
                <span className="breadcrumb-slash">/</span>
                <strong>
                  #{opened.number} {opened.title}
                </strong>
              </>
            ) : focusRepo ? (
              <>
                <GitPullRequest size={14} />
                <span>Pull requests</span>
                <span className="breadcrumb-slash">/</span>
                <strong>{repoOf(focusRepo).project?.name ?? focusRepo}</strong>
              </>
            ) : (
              <>
                <GitPullRequest size={14} />
                <strong>Pull requests</strong>
              </>
            )}
          </div>
          <span className="spacer" />
          {opened && (
            <div className="pv-pane-toggles">
              {project && (
                <span className="on">
                  <MessageSquare size={13} /> Chat
                </span>
              )}
              <span className="on">
                <GitPullRequest size={13} /> PR #{opened.number}
              </span>
            </div>
          )}
        </header>
        <div className="project-layout">
          <aside className="projects-sidebar" aria-label="Projects">
            {option === "sidebar" && sidebarView === "prs" ? (
              <div className="sb">
                <div className="sb-top">
                  <label className="sb-search">
                    <Search size={13} />
                    <input
                      placeholder="Search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <button className="sb-top-button" aria-label="New thread">
                    <Plus size={16} />
                  </button>
                  <button
                    className="sb-top-button sb-bell active"
                    aria-pressed
                    aria-label="Pull requests"
                    onClick={() => setOpened(null)}
                  >
                    <GitPullRequest size={15} />
                  </button>
                  <button className="sb-top-button" aria-label="View activity">
                    <Bell size={15} />
                  </button>
                </div>
                <SidebarList
                  pulls={matching}
                  selected={opened ? keyOf(opened) : undefined}
                  onOpen={setOpened}
                  onProjects={() => setSidebarView("projects")}
                />
                <div className="sb-footer">
                  <button className="sb-account">
                    <span className="sb-avatar" aria-hidden>
                      YO
                    </span>
                    <span>you</span>
                  </button>
                  <button className="icon-button" aria-label="Open settings">
                    <Settings2 size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <ProjectSidebar
                initialView="threads"
                projects={projects}
                showing={{ projectId: project?.id, chatId: thread?.id }}
                account="you"
                onOpen={() => {}}
                onPickNew={() => {}}
                onNewScratch={() => {}}
                onSendDraft={() => {}}
                onAdd={() => {}}
                onShared={() => {}}
                onSettings={() => {}}
                onAccount={() => {}}
                onInbox={() => {
                  if (option === "sidebar") return setSidebarView("prs");
                  setOpened(null);
                  setFocusRepo(null);
                }}
              />
            )}
          </aside>
          <main className="pro-main">
            {opened ? (
              <OpenedPr key={keyOf(opened)} pr={opened} />
            ) : option === "sidebar" ? (
              <div className="pro-page">
                <header className="pro-head">
                  <div className="pro-head-text">
                    <h1>Pull requests</h1>
                    <p>{summary}</p>
                  </div>
                </header>
                <Overview {...props} pulls={pulls} />
              </div>
            ) : (
              <div className={`pro-page ${option === "peek" ? "fill" : ""}`}>
                <PageHead
                  counts={counts}
                  {...head}
                  query={query}
                  onQuery={setQuery}
                  state={state}
                  onState={setState}
                />
                {!matching.length ? (
                  <p className="pro-empty">No pull requests match.</p>
                ) : option === "triage" ? (
                  <Triage {...props} />
                ) : option === "board" ? (
                  <Board {...props} />
                ) : option === "board-triage" ? (
                  <BoardTriage
                    {...props}
                    repo={focusRepo}
                    onRepo={setFocusRepo}
                  />
                ) : option === "table" ? (
                  <Table {...props} />
                ) : (
                  <Peek key={state + query} {...props} />
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
