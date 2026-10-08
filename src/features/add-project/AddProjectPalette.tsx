// Adding a project: one search field that opens a folder, clones from GitHub
// or a URL, or starts a new one, then offers the repos beside it as links.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Link2,
  Lock,
  Search,
} from "lucide-react";
import {
  linkName,
  parseRemote,
  repoName,
  slug,
  tildePath,
  type FolderEntry,
  type GithubRepo,
  type LinkSuggestion,
  type Project,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/relative-date";
import { ErrorBox } from "../../ui/ui";
import { GitHubMark } from "../settings/BrandIcons";
import {
  JobProgress,
  NewProjectFields,
  PickedNote,
  type Spec,
} from "./AddingParts";
import { LinkStep } from "./LinkStep";
import { relatedFolders } from "./related";
import { useAdding } from "./useAdding";
import "./add-project.css";

type Page = "root" | "folder" | "github" | "url" | "new";

interface Item {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  detail?: string;
  right?: ReactNode;
  section?: string;
  run: () => void;
}

const placeholder: Record<Page, string> = {
  root: "Open a folder, clone a repository, or start a new one…",
  folder: "~/",
  github: "Search your repositories…",
  url: "https://github.com/owner/repo, git@host:owner/repo, or owner/repo",
  new: "Name the project",
};
const title: Partial<Record<Page, string>> = {
  folder: "Open a folder",
  github: "Clone from GitHub",
  url: "Clone from a URL",
  new: "New project",
};

export function AddProjectPalette({
  projects,
  onClose,
  onDone,
}: {
  projects: readonly Project[];
  onClose: () => void;
  /** Added, or picked from the ones there already: start a thread in it. */
  onDone: (project: Project) => void;
}) {
  const adding = useAdding(projects);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<Page>("root");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [linking, setLinking] = useState<{
    project: Project;
    related: LinkSuggestion[];
  }>();
  const [chosenInto, setCloneInto] = useState<string>();
  const [spec, setSpec] = useState<Partial<Spec>>({});
  const cloneInto = chosenInto ?? adding.start?.cloneFolder ?? "~";
  const fullSpec: Spec = {
    location: cloneInto,
    git: true,
    github: false,
    private: true,
    ...spec,
  };
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    input.current?.focus();
  }, [page]);

  const github = useQuery({
    queryKey: ["github-repos"],
    queryFn: () => api.githubRepos(),
    enabled:
      page === "github" ||
      (page === "root" && query.trim().length > 1) ||
      (page === "new" && !!spec.github),
    staleTime: 60_000,
  });
  const repos = github.data && "repos" in github.data ? github.data.repos : [];
  const login =
    github.data && "login" in github.data ? github.data.login : undefined;

  const cut = query.lastIndexOf("/");
  const dir =
    page === "folder" ? (cut < 0 ? "~/" : query.slice(0, cut + 1)) : "";
  const leaf = page === "folder" ? query.slice(cut + 1).toLowerCase() : "";
  const listing = useQuery({
    queryKey: ["folder-listing", dir],
    queryFn: () => api.listFolders(dir).catch(() => [] as FolderEntry[]),
    enabled: page === "folder",
    staleTime: 10_000,
  });

  function go(next: Page, text = "") {
    setPage(next);
    setQuery(text);
    setActive(0);
    adding.clear();
  }
  const known = (p: Project) => projects.some((x) => x.id === p.id);
  /** Brand new: offer the repos beside it first, when there are any. */
  async function finish(project: Project | undefined) {
    if (!project) return;
    if (known(project)) return onDone(project);
    const related = relatedFolders(
      project,
      await api.linkSuggestions(project.id).catch(() => []),
    );
    if (related.length) setLinking({ project, related });
    else onDone(project);
  }
  function clone(remote: string) {
    void adding.clone(remote, cloneInto).then(finish);
  }
  async function choose(what: "clone" | "new") {
    const path = await api.chooseFolder(
      what === "clone" ? "Clone into" : "Where the project goes",
    );
    if (!path) return;
    if (what === "clone") setCloneInto(path);
    else setSpec((s) => ({ ...s, location: path }));
  }

  const remote = parseRemote(query);
  const items: Item[] = [];
  if (page === "root") {
    const q = query.trim().toLowerCase();
    if (remote)
      items.push(cloneItem(remote.full, remote.host, () => clone(remote.url)));
    else {
      const sources: Item[] = [
        {
          key: "folder",
          icon: <FolderOpen size={15} />,
          label: "Open a folder",
          detail: `Browse from ${tildePath(cloneInto)}`,
          run: () => go("folder", `${tildePath(cloneInto)}/`),
        },
        {
          key: "github",
          icon: <GitHubMark size={15} />,
          label: "Clone from GitHub",
          detail: login
            ? `Your repositories, signed in as ${login}`
            : "Your repositories, through gh",
          run: () => go("github"),
        },
        {
          key: "url",
          icon: <Link2 size={15} />,
          label: "Clone from a URL",
          detail: "Any Git host, or owner/repo",
          run: () => go("url"),
        },
        {
          key: "new",
          icon: <FolderPlus size={15} />,
          label: "New project",
          detail: "An empty folder, with git and a GitHub repo if you like",
          run: () => go("new", query),
        },
      ];
      items.push(
        ...sources
          .filter(
            (s) => !q || `${s.label} ${s.detail}`.toLowerCase().includes(q),
          )
          .map((s) => ({ ...s, section: "Add a project" })),
        ...(adding.start?.recent ?? [])
          .filter((f) => !q || f.path.toLowerCase().includes(q))
          .map((f) => ({
            key: f.path,
            icon: f.repository ? (
              <FolderGit2 size={15} />
            ) : (
              <Folder size={15} />
            ),
            label: linkName(f.path),
            detail: tildePath(f.path),
            right: timeAgo(new Date(f.when).toISOString()),
            section: "Folders your agents worked in",
            run: () => void adding.pick(f.path).then(finish),
          })),
      );
      if (q)
        items.push(
          ...repos
            .filter((r) => r.full.toLowerCase().includes(q))
            .slice(0, 8)
            .map((r) => ({ ...repoItem(r), section: "On GitHub" })),
        );
      items.push({
        key: "finder",
        icon: <Folder size={15} />,
        label: "Choose in Finder…",
        section: q ? undefined : " ",
        run: () =>
          void api.chooseFolder("Add a project folder").then((path) => {
            if (path) return adding.pick(path).then(finish);
          }),
      });
    }
  } else if (page === "folder") {
    if (!leaf && dir.length > 1)
      items.push({
        key: `this:${dir}`,
        icon: <FolderOpen size={15} />,
        label: "This folder",
        detail: dir,
        run: () => void adding.pick(dir).then(finish),
      });
    for (const f of listing.data ?? []) {
      if (!f.name.toLowerCase().startsWith(leaf)) continue;
      const project = projects.find((p) => p.path === f.path);
      items.push({
        key: f.path,
        icon: f.repository ? <FolderGit2 size={15} /> : <Folder size={15} />,
        label: f.name,
        right: project
          ? `In Relay as ${project.name}`
          : f.repository
            ? "git"
            : "›",
        run: () =>
          project
            ? onDone(project)
            : f.repository
              ? void adding.pick(f.path).then(finish)
              : enter(f),
      });
      if (items.length > 80) break;
    }
  } else if (page === "github") {
    const q = query.trim().toLowerCase();
    items.push(
      ...repos
        .filter((r) => `${r.full} ${r.description}`.toLowerCase().includes(q))
        .map(repoItem),
    );
  } else if (page === "url" && remote) {
    items.push(cloneItem(remote.full, remote.host, () => clone(remote.url)));
  }

  function enter(f: FolderEntry) {
    setQuery(`${tildePath(f.path)}/`);
    setActive(0);
    adding.clear();
  }
  function existingClone(full: string, host: string) {
    return projects.find((p) => {
      if (p.path !== `${cloneInto}/${repoName(full)}` || !p.repository)
        return false;
      const remote = parseRemote(
        `${p.repository.server}/${p.repository.owner}/${p.repository.name}`,
      );
      return (
        remote?.host.toLowerCase() === host.toLowerCase() &&
        remote.full.toLowerCase() === full.toLowerCase()
      );
    });
  }
  function cloneItem(full: string, host: string, run: () => void): Item {
    const there = existingClone(full, host);
    return {
      key: `clone:${full}`,
      icon: <GitHubMark size={15} />,
      label: there ? `Open ${there.name}` : `Clone ${full}`,
      detail: there
        ? `In Relay already, at ${tildePath(there.path)}`
        : `From ${host} into ${tildePath(cloneInto)}/${repoName(full)}`,
      run,
    };
  }
  function repoItem(r: GithubRepo): Item {
    const there = existingClone(
      r.full,
      parseRemote(r.url)?.host ?? "github.com",
    );
    return {
      key: r.full,
      icon: <GitHubMark size={15} />,
      label: r.full,
      detail: r.description || undefined,
      right: there ? (
        `In Relay as ${there.name}`
      ) : (
        <>
          {r.private && <Lock size={11} aria-label="Private" />}
          {r.pushed ? timeAgo(new Date(r.pushed).toISOString()) : ""}
        </>
      ),
      run: () => clone(r.url),
    };
  }

  const name = slug(query);
  const create = () => {
    if (name) void adding.create({ ...fullSpec, name }).then(finish);
  };
  function onKeyDown(e: KeyboardEvent) {
    if (adding.busy) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (page === "root") onClose();
      else go("root");
    } else if (
      e.key === "Backspace" &&
      page !== "root" &&
      (!query || query === "~/")
    ) {
      e.preventDefault();
      go("root");
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length)
        setActive(
          (i) =>
            (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length,
        );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (page === "new") create();
      else if (page === "folder" && /^[~/]/.test(query) && !items.length)
        void adding.pick(query).then(finish);
      else items[Math.min(active, items.length - 1)]?.run();
    } else if (e.key === "Tab" && page === "folder") {
      e.preventDefault();
      const f = listing.data?.find((x) => x.path === items[active]?.key);
      if (f) enter(f);
    }
  }

  const githubProblem =
    github.data && "problem" in github.data ? github.data.problem : undefined;
  let section: string | undefined;
  return (
    <dialog
      ref={dialog}
      className="modal add-palette"
      aria-label="Add a project"
      onCancel={(e) => {
        e.preventDefault();
        if (!adding.busy && !linking) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !adding.busy && !linking) onClose();
      }}
    >
      {linking ? (
        <LinkStep
          project={linking.project}
          related={linking.related}
          onDone={() => onDone(linking.project)}
        />
      ) : (
        <>
          {title[page] && (
            <div className="add-palette-crumb">
              <button
                type="button"
                className="text-button"
                onClick={() => go("root")}
              >
                <ArrowLeft size={13} />
                Add a project
              </button>
              <span>/ {title[page]}</span>
            </div>
          )}
          <div className="headline-project-search add-palette-search">
            {page === "folder" ? (
              <FolderOpen size={15} />
            ) : page === "new" ? (
              <FolderPlus size={15} />
            ) : (
              <Search size={15} />
            )}
            <input
              ref={input}
              aria-label={title[page] ?? "Add a project"}
              placeholder={placeholder[page]}
              value={query}
              disabled={adding.busy}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                const text = e.target.value;
                // A path typed from the top opens the folder browser on it.
                if (page === "root" && /^[~/]/.test(text))
                  return go("folder", text);
                setQuery(text);
                setActive(0);
                adding.clear();
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {adding.job ? (
            <div className="add-palette-body">
              <JobProgress job={adding.job} onCancel={adding.cancel} />
            </div>
          ) : page === "new" ? (
            <div className="add-palette-body add-palette-form">
              <NewProjectFields
                name={name}
                spec={fullSpec}
                login={login}
                onSpec={(next) => setSpec(next)}
                onLocation={() => void choose("new")}
              />
              {!!adding.error && <ErrorBox error={adding.error} />}
              <div className="add-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!name || adding.busy}
                  onClick={create}
                >
                  Create {name || "project"}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="add-palette-body"
              role="listbox"
              aria-label="Choices"
            >
              {adding.picked && (
                <PickedNote
                  picked={adding.picked}
                  onOpen={onDone}
                  onAdd={(path, setUpGit) =>
                    void adding.add(path, setUpGit).then(finish)
                  }
                />
              )}
              {!!adding.error && <ErrorBox error={adding.error} />}
              {items.map((item, i) => {
                const head =
                  item.section !== section ? item.section : undefined;
                section = item.section;
                return (
                  <div key={item.key}>
                    {head?.trim() && (
                      <div className="composer-menu-label">{head}</div>
                    )}
                    {head === " " && <hr />}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      className="headline-project-row add-palette-row"
                      data-highlighted={i === active ? "" : undefined}
                      disabled={adding.busy}
                      onMouseMove={() => setActive(i)}
                      onClick={item.run}
                    >
                      {item.icon}
                      <span className="headline-project-row-label">
                        <strong>{item.label}</strong>
                        {item.detail && <small>{item.detail}</small>}
                      </span>
                      {item.right && <em>{item.right}</em>}
                    </button>
                  </div>
                );
              })}
              {!items.length && (
                <p className="headline-project-empty">
                  {page === "url"
                    ? "Paste a clone URL from any host, or owner/repo for GitHub."
                    : page === "folder"
                      ? listing.isLoading
                        ? "Looking…"
                        : "No folder by that name. ↵ adds the path as typed."
                      : page === "github"
                        ? (githubProblem ??
                          (github.isLoading
                            ? "Asking GitHub…"
                            : "No repository by that name."))
                        : "Nothing matches. Enter a URL or owner/repo to clone it."}
                </p>
              )}
            </div>
          )}
          <div className="add-palette-foot">
            {page === "github" || page === "url" || remote ? (
              <span>
                Clones into <code>{tildePath(cloneInto)}</code>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void choose("clone")}
                >
                  Change
                </button>
              </span>
            ) : page === "folder" ? (
              <span>Tab goes into a folder · ↵ adds it</span>
            ) : page === "new" ? (
              <span>↵ creates it</span>
            ) : (
              <span>Paste a URL, owner/repo or a path</span>
            )}
            {!adding.busy && (
              <span>{page === "root" ? "esc to close" : "esc to go back"}</span>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
