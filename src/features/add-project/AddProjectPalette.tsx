// Add a project where it will run; computer setup stays inside this flow.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Import as ImportIcon,
  Search,
} from "lucide-react";
import {
  parseRemote,
  repoName,
  slug,
  type LinkSuggestion,
  type Project,
} from "../../../shared/projects";
import type { PairedComputer } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { useReturnFocus } from "../../lib/focus-return";
import { useBackdropClose } from "../../lib/backdrop-close";
import { ErrorBox } from "../../ui/ui";
import { GitHubMark } from "../../ui/BrandIcons";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { usePairedComputers } from "../handoff/usePairedComputers";
import { computerLine, reachable } from "../handoff/computer-status";
import {
  JobProgress,
  NewProjectFields,
  PickedNote,
  WayRow,
  type Spec,
} from "./AddingParts";
import { LinkStep } from "./LinkStep";
import { relatedFolders } from "./related";
import { useAdding } from "./useAdding";
import { ImportProjects } from "./ImportProjects";
import type { ImportApp } from "../../../shared/project-import";
import { AddProjectHeading } from "./AddProjectHeading";
import { ComputerPicker } from "../handoff/ComputerPicker";
import { ProjectFolders } from "./ProjectFolders";
import { folderLabel } from "./folder-path";
import { LocationCards, LocationTrigger } from "./LocationChoice";
import "../../ui/palette.css";
import "./add-project.css";

export type AddProjectPage =
  "root" | "folder" | "github" | "url" | "new" | "import" | "computers";
const titles: Record<AddProjectPage, string> = {
  root: "Add a project",
  folder: "Open a folder",
  github: "Clone from GitHub",
  url: "Clone a repository",
  new: "New project",
  import: "Import projects",
  computers: "Choose a computer",
};

export function AddProjectPalette({
  projects,
  computerId,
  initialPage = "root",
  onClose,
  onDone,
  onImportWithAgent,
}: {
  projects: readonly Project[];
  computerId?: string;
  initialPage?: AddProjectPage;
  onClose: () => void;
  onDone: (project: Project) => void;
  /** Opens a thread whose agent imports `app`'s history, sorted as the user says. */
  onImportWithAgent?: (app: ImportApp) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const importStep = useRef<{ back: () => void }>(null);
  const locationChoice = useRef<HTMLButtonElement>(null);
  const paired = usePairedComputers(true);
  const [selectedComputer, setSelectedComputer] = useState(computerId);
  const [justConnected, setJustConnected] = useState<PairedComputer>();
  const computer =
    paired.data?.find((c) => c.id === selectedComputer) ??
    (justConnected?.id === selectedComputer ? justConnected : undefined);
  const available = !selectedComputer || (!!computer && reachable(computer));
  const adding = useAdding(projects, selectedComputer, available);
  const [page, setPage] = useState<AddProjectPage>(initialPage);
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [spec, setSpec] = useState<Partial<Spec>>({});
  const [importBusy, setImportBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [linking, setLinking] = useState<{
    project: Project;
    related: LinkSuggestion[];
  }>();
  const returnTo = useRef<{ page: AddProjectPage; query: string }>({
    page: "root",
    query: "",
  });
  const locked = adding.busy || importBusy || connectionBusy || !!linking;
  const close = () => {
    if (!locked) onClose();
  };
  const backdropClose = useBackdropClose(close);
  useReturnFocus();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (page === "root") locationChoice.current?.focus();
    else input.current?.focus();
  }, [page, selectedComputer]);
  // What was typed stays as typed; only the computer's default is shown from ~.
  const typedLocation = locations[selectedComputer ?? "here"];
  const cloneInto = typedLocation ?? adding.start?.cloneFolder ?? "";
  const location =
    typedLocation ??
    (adding.start
      ? folderLabel(adding.start.cloneFolder, adding.start.home)
      : "");
  function setLocation(path: string) {
    setLocations((l) => ({ ...l, [selectedComputer ?? "here"]: path }));
  }
  const fullSpec: Spec = {
    git: true,
    github: false,
    private: true,
    ...spec,
    location: cloneInto,
  };
  function go(next: AddProjectPage, text = "") {
    if (locked) return;
    setPage(next);
    setQuery(text);
    adding.clear();
    setNativeError(undefined);
  }
  function computers() {
    returnTo.current = { page, query };
    go("computers");
  }
  /** One step back: out of the computer list, to the first page, or closed. */
  function back() {
    if (page === "import") return void importStep.current?.back();
    if (page === "root") return onClose();
    if (page !== "computers") return go("root");
    setPage(returnTo.current.page);
    setQuery(returnTo.current.query);
  }
  function chooseComputer(next?: PairedComputer) {
    if (locked) return;
    setSelectedComputer(next?.id);
    setJustConnected(next);
    setPage(returnTo.current.page);
    setQuery(returnTo.current.query);
    adding.clear();
  }
  async function finish(project: Project | undefined) {
    if (!project) return;
    if (project.computer || projects.some((p) => p.id === project.id))
      return onDone(project);
    const related = relatedFolders(
      project,
      await api.linkSuggestions(project.id).catch(() => []),
    );
    if (related.length) setLinking({ project, related });
    else onDone(project);
  }
  async function chooseNative() {
    try {
      const path = await api.chooseFolder("Add a project folder");
      if (path) await finish(await adding.pick(path));
    } catch (error) {
      setNativeError(error);
    }
  }
  const [nativeError, setNativeError] = useState<unknown>();
  const github = useQuery({
    queryKey: ["github-repos", selectedComputer],
    queryFn: () => api.githubRepos(selectedComputer),
    enabled:
      available && (page === "github" || (page === "new" && !!spec.github)),
    staleTime: 60_000,
    retry: false,
  });
  const repos = github.data && "repos" in github.data ? github.data.repos : [];
  const matchingRepos = repos.filter((r) =>
    `${r.full} ${r.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const login =
    github.data && "login" in github.data ? github.data.login : undefined;
  const githubProblem =
    github.data && "problem" in github.data ? github.data.problem : undefined;
  const remote = parseRemote(query);
  const name = slug(query);
  // Until that computer has answered, its usual folder isn't known.
  const ready = available && !locked && !!adding.start && !!cloneInto.trim();
  const create = () => {
    if (name && ready) void adding.create({ ...fullSpec, name }).then(finish);
  };
  const clone = () => {
    if (remote && ready) void adding.clone(remote.url, cloneInto).then(finish);
  };
  const errors = (
    <>
      {!!adding.error && <ErrorBox error={adding.error} />}
      {!!nativeError && <ErrorBox error={nativeError} />}
    </>
  );
  const picked = adding.picked && (
    <PickedNote
      picked={adding.picked}
      onAdd={(path, git) => void adding.add(path, git).then(finish)}
    />
  );
  const heading = (
    <AddProjectHeading
      title={titles[page]}
      disabled={locked}
      onClose={close}
      onBack={page === "root" ? undefined : back}
    >
      {page !== "root" && page !== "computers" && (
        <LocationTrigger
          computer={computer}
          disabled={locked}
          onClick={computers}
        />
      )}
    </AddProjectHeading>
  );
  return (
    <dialog
      ref={dialog}
      className="modal palette add-palette"
      aria-label="Add a project"
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) back();
      }}
      {...backdropClose}
    >
      {page === "import" ? (
        <ImportProjects
          ref={importStep}
          onBack={() => go("root")}
          onClose={close}
          onDone={onDone}
          onAskAgent={onImportWithAgent}
          onBusy={setImportBusy}
        />
      ) : linking ? (
        <LinkStep
          project={linking.project}
          related={linking.related}
          onDone={() => onDone(linking.project)}
        />
      ) : (
        <>
          {heading}
          {page === "computers" ? (
            <ComputerPicker
              onPick={chooseComputer}
              onBusy={setConnectionBusy}
            />
          ) : (
            <>
              {!available && (
                <div className="add-project-error">
                  {paired.isPending || computer?.status === "connecting" ? (
                    <p className="headline-project-empty">Connecting…</p>
                  ) : (
                    <ErrorBox
                      error={
                        computer
                          ? computerLine(computer)
                          : "This computer is no longer paired."
                      }
                    />
                  )}
                  <button className="text-button" onClick={computers}>
                    Choose a computer
                  </button>
                </div>
              )}
              {page === "root" ? (
                <div className="palette-body add-project-home">
                  <LocationCards
                    computer={computer}
                    elsewhere={!!selectedComputer}
                    focus={locationChoice}
                    onHere={() => {
                      setSelectedComputer(undefined);
                      setJustConnected(undefined);
                      adding.clear();
                    }}
                    onChoose={computers}
                  />
                  <div className="add-project-ways">
                    <WayRow
                      icon={<FolderOpen size={17} />}
                      label="Open a folder"
                      disabled={!available}
                      onClick={() => go("folder")}
                    />
                    <WayRow
                      icon={<GitHubMark size={17} />}
                      label="Clone a repository"
                      disabled={!available}
                      onClick={() => go("github")}
                    />
                    <WayRow
                      icon={<FolderPlus size={17} />}
                      label="New project"
                      disabled={!available}
                      onClick={() => go("new")}
                    />
                    {!selectedComputer && (
                      <WayRow
                        icon={<ImportIcon size={17} />}
                        label="Import from another app…"
                        onClick={() => go("import")}
                      />
                    )}
                  </div>
                </div>
              ) : adding.job ? (
                <div className="palette-body add-project-progress">
                  <JobProgress job={adding.job} onCancel={adding.cancel} />
                </div>
              ) : page === "folder" ? (
                <ProjectFolders
                  key={selectedComputer ?? "here"}
                  projects={projects}
                  computer={computer}
                  initialFolder={adding.start?.cloneFolder}
                  home={adding.start?.home}
                  busy={locked || !available}
                  onPick={(path) => void adding.pick(path).then(finish)}
                  onNative={() => void chooseNative()}
                >
                  {picked}
                  {errors}
                </ProjectFolders>
              ) : page === "github" ? (
                <>
                  <div className="headline-project-search palette-search">
                    <Search size={15} />
                    <input
                      ref={input}
                      aria-label="Search repositories"
                      placeholder="Search or paste a repository URL…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={locked}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && remote) go("url", remote.url);
                      }}
                    />
                  </div>
                  <div className="palette-body add-repositories">
                    {remote && (
                      <button
                        className="headline-project-row palette-row"
                        onClick={() => go("url", remote.url)}
                      >
                        <GitHubMark size={17} />
                        <span className="headline-project-row-label">
                          <strong>{remote.full}</strong>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    )}
                    {matchingRepos.map((r) => (
                      <button
                        type="button"
                        className="headline-project-row palette-row"
                        key={r.full}
                        onClick={() => go("url", r.url)}
                      >
                        <GitHubMark size={17} />
                        <span className="headline-project-row-label">
                          <strong>{r.full}</strong>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                    {github.isPending && (
                      <p className="headline-project-empty">
                        Loading repositories…
                      </p>
                    )}
                    {!!github.error && <ErrorBox error={github.error} />}
                    {githubProblem && (
                      <p className="headline-project-empty">{githubProblem}</p>
                    )}
                    {github.isSuccess && !githubProblem && !repos.length && (
                      <p className="headline-project-empty">No repositories.</p>
                    )}
                    {repos.length > 0 && !matchingRepos.length && !remote && (
                      <p className="headline-project-empty">
                        No matching repositories.
                      </p>
                    )}
                  </div>
                  <div className="add-project-footer add-repository-footer">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => go("url", remote?.url ?? "")}
                    >
                      Clone from a URL…
                    </button>
                    <button
                      className="text-button"
                      disabled={github.isFetching}
                      onClick={() => void github.refetch()}
                    >
                      Refresh
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <form
                    className="palette-body add-project-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      page === "url" ? clone() : create();
                    }}
                  >
                    <label>
                      {page === "url" ? "Repository" : "Name"}
                      <input
                        ref={input}
                        aria-label={
                          page === "url" ? "Repository" : "Project name"
                        }
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          adding.clear();
                        }}
                        placeholder={
                          page === "url" ? "URL or owner/repo" : "my-project"
                        }
                        disabled={locked}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      {page === "url" ? "Clone into" : "Create in"}
                      <input
                        aria-label="Destination folder"
                        value={location}
                        placeholder={
                          adding.start || adding.startError
                            ? undefined
                            : "Loading…"
                        }
                        onChange={(e) => setLocation(e.target.value)}
                        disabled={locked}
                        spellCheck={false}
                      />
                    </label>
                    {page === "new" && (
                      <details className="add-project-options">
                        <summary>Git options</summary>
                        <NewProjectFields
                          name={name}
                          spec={fullSpec}
                          login={login}
                          onSpec={setSpec}
                        />
                      </details>
                    )}
                    {!!adding.startError && (
                      <>
                        <ErrorBox error={adding.startError} />
                        <button
                          type="button"
                          className="text-button"
                          onClick={adding.retryStart}
                        >
                          Try again
                        </button>
                      </>
                    )}
                    {errors}
                    <button
                      className="add-project-submit"
                      type="submit"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </form>
                  <div className="add-project-footer">
                    <MiddleTruncate
                      text={`${location.replace(/[\\/]$/, "")}/${page === "url" ? (remote ? repoName(remote.full) : "…") : name || "…"}`}
                      kind="path"
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={!ready || !(page === "url" ? remote : name)}
                      onClick={page === "url" ? clone : create}
                    >
                      {page === "url" ? "Clone repository" : "Create project"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </dialog>
  );
}
