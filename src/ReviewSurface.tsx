import type { PaneSlots } from "./components/WorkspacePanes";
import { RoomPanel } from "./components/RoomPanel";
import { TeaHint, TeaLogins } from "./components/TeaSignIn";
import { RoomInvitationDialog } from "./components/RoomInvitationDialog";
import { parseRoomInvitation, roomProtocol } from "../shared/rooms";
import type { QuestionTarget } from "../shared/questions";
import type { SettingsCategory } from "./components/Settings";
import { useProjectChecks } from "./lib/useProjectChecks";
import { useReviewProgress } from "./lib/useReviewProgress";
import { useViewedCarryOver } from "./lib/useViewedCarryOver";
import { SETTINGS_PAGE } from "./lib/settings-page";
import { shouldResumeReview } from "./lib/resumeReview";
import {
  GroupedFileList,
  type FileSelection,
} from "./components/GroupedFileList";
import { TriageControls } from "./components/TriageControls";
import { isAnalyzing, notedPaths } from "../shared/triage";
import { useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import { useStoredFlag } from "./lib/useStoredFlag";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  FileCode2,
  GitPullRequest,
  Inbox,
  PanelLeft,
  PanelLeftClose,
  Search,
  ArrowRight,
} from "lucide-react";
import { api } from "./lib/api";
import { matches } from "./lib/shortcuts";
import { linksTo, type ProjectFileLink } from "../shared/project-file-links";
import type {
  Account,
  Bootstrap,
  ChangedFile,
  Progress,
  PullRef,
  Pull,
  Repo,
  WorkspaceState,
} from "../shared/types";
import { revisionOf } from "../shared/types";
import { ErrorBox, IconButton, Loading, Modal } from "./components/ui";
import { PaneResizer } from "./components/PaneResizer";
import { PaneControls } from "./components/PaneControls";
import { ReviewWorkspace } from "./components/ReviewWorkspace";
import {
  PullRequestsPage,
  type PullsLocation,
  type PullsNav,
} from "./components/PullRequestsPage";
import { PULL_BOARD } from "./lib/usePullBoard";
import { repoKey } from "./lib/pull-board";
import type { Project } from "../shared/projects";
const LocalFileEditor = lazy(() => import("./components/LocalFileEditor"));
export function SignIn({
  onConnected,
  loginRestore,
  savedServer,
  platform,
  onRestoreAction,
  invitationUrl,
}: {
  onConnected: (a: Account) => Promise<void>;
  loginRestore: Bootstrap["loginRestore"];
  savedServer?: string;
  platform: string;
  onRestoreAction: (action: "retry" | "cancel") => Promise<void>;
  invitationUrl?: string;
}) {
  // No built-in default: releases are public, and a work host doesn't belong in them.
  const [server, setServer] = useState(savedServer ?? ""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!invitationUrl || token) return;
    try {
      const project = parseRoomInvitation(invitationUrl).project;
      if (project) setServer(project.server);
    } catch {
      /* Normal PR links continue through the existing sign-in flow. */
    }
  }, [invitationUrl, token]);
  const restoreAction = async (action: "retry" | "cancel") => {
    setBusy(true);
    setError(undefined);
    try {
      await onRestoreAction(action);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="welcome-sidebar">
        <div className="titlebar">
          <span className="traffic-space" />
          <PanelLeft size={19} />
        </div>
        <div className="brand">
          <span className="brand-icon">
            <GitPullRequest size={22} />
          </span>
          <div>
            Relay<small>A little more focus.</small>
          </div>
        </div>
        <div className="welcome-nav">
          <Inbox size={17} /> Your review inbox
        </div>
        <div className="welcome-nav">
          <FileCode2 size={17} /> Every line, side by side
        </div>
        <div className="welcome-nav">
          <Check size={17} /> Pick up where you left off
        </div>
        <div className="welcome-bottom">
          Built for the work between
          <br />
          “PR opened” and “looks good.”
        </div>
      </div>
      <main className="welcome-main">
        <div className="titlebar" />
        <div className="connect-card">
          {loginRestore === "unlocking" ? (
            <>
              <span className="eyebrow">PICKING UP WHERE YOU LEFT OFF</span>
              <h1>Unlocking your saved sign-in.</h1>
              <p role="status">
                Waiting for{" "}
                {platform === "darwin"
                  ? "macOS Keychain"
                  : "your system keyring"}
                . If a permission dialog appears, allow access to your saved
                Gitea login. Your review will reopen automatically.
              </p>
              {!!error && <ErrorBox error={error} />}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void restoreAction("cancel")}
              >
                Sign in again
              </button>
            </>
          ) : (
            <>
              <span className="eyebrow">YOUR CODE. A CLEARER VIEW.</span>
              <h1>
                Make room for
                <br />a better review.
              </h1>
              <p>
                Your Gitea pull requests, in a focused desktop workspace. Less
                waiting. More understanding.
              </p>
              {loginRestore === "failed" && (
                <ErrorBox
                  error="Your saved sign-in could not be unlocked. Retry access to your system keyring, or sign in below. Your saved review is still here."
                  retry={() => void restoreAction("retry")}
                />
              )}
              <TeaLogins onConnected={onConnected} />
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError(undefined);
                  try {
                    const a = await api.connect(server, token);
                    setToken("");
                    await onConnected(a);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Gitea server
                  <input
                    autoFocus
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    type="url"
                    required
                    placeholder="https://git.example.com"
                  />
                </label>
                <label>
                  Personal access token
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    placeholder="Paste your token here"
                  />
                </label>
                <p className="field-note">
                  Create a token with <b>read:user</b>, <b>write:repository</b>,
                  and <b>write:issue</b> access. Include private repositories if
                  needed.
                </p>
                {!!error && <ErrorBox error={error} />}
                <button
                  className="primary connect-button"
                  disabled={busy || !token.trim()}
                >
                  {busy ? "Connecting…" : "Connect to Gitea"}
                  <ArrowRight size={16} />
                </button>
              </form>
              <button
                className="text-button"
                disabled={!server.trim()}
                onClick={() => {
                  try {
                    void api
                      .openExternal(
                        `${new URL(server).href.replace(/\/$/, "")}/user/settings/applications`,
                      )
                      .catch(setError);
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Create a token in Gitea <ArrowUpRight size={14} />
              </button>
              <TeaHint />
              <div className="connection-footnote">
                <span className="dot green" /> Direct connection · Credentials
                stay on this device
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
export function Connected({
  onDirtyChange,
  embedded,
  pulls,
  account,
  onSettings,
  pendingUrl,
  initialWorkspace,
  incomingLink,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  embedded?: {
    ref: PullRef;
    /** The thread's workspace: local changes and blame read its folder. */
    workspace?: string;
    onPresence?: (v: {
      path: string | null;
      viewed: number;
      total: number;
    }) => void;
    onDiscuss?: (target: QuestionTarget, pull: Pull) => void;
    /** Pane header slots for the review's toolbar. */
    slots?: PaneSlots;
    /** Open a file in the host's editor instead of a modal. */
    onEditFile?: (path: string, line?: number) => void;
    /** A file to select, such as one clicked in the host's chat. */
    reveal?: (ProjectFileLink & { request: number }) | null;
    onRevealConsumed?: () => void;
  };
  /**
   * On the Pull requests page: its board shows while no PR is open, and a PR
   * whose repository is a project opens on that project's thread instead.
   */
  pulls?: {
    projects: Project[];
    projectOf: (repo: Repo) => Project | undefined;
    onOpenInProject: (project: Project, ref: PullRef) => void;
    onOpenProject: (project: Project) => void;
    onAddProject: (repo?: Repo) => void;
    /** Where the page is, for the window title. */
    onLocation: (where: PullsLocation) => void;
    /** Leave the open PR for the board or a project's page. */
    nav: PullsNav | null;
  };
  account: Account;
  onSettings: (category?: SettingsCategory) => void;
  pendingUrl?: string;
  initialWorkspace: WorkspaceState;
  incomingLink?: { url: string };
}) {
  const [roomInvitationUrl, setRoomInvitationUrl] = useState<string>();
  const [roomOpen, setRoomOpen] = useStoredFlag("relay-room-open");
  const [roomTarget, setRoomTarget] = useState<{
    key: string;
    value: QuestionTarget;
  } | null>(null);
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState(
    !embedded && !!initialWorkspace.pull && !pendingUrl,
  );
  const [query, setQuery] = useState(initialWorkspace.query),
    [state, setState] = useState(initialWorkspace.state),
    [repo, setRepo] = useState(
      () => localStorage.getItem(`relay-pulls-repo:${account.id}`) || null,
    ),
    [selected, setSelected] = useState<PullRef | null>(
      embedded?.ref ?? initialWorkspace.pull,
    ),
    [fileSelection, setFileSelection] = useState<FileSelection>({
      path: initialWorkspace.file,
      reveal: true,
    }),
    [filesHidden, setFilesHidden] = useStoredFlag("relay-files-hidden"),
    [urlOpen, setUrlOpen] = useState(false),
    [error, setError] = useState<unknown>(),
    [fileFilter, setFileFilter] = useState("");
  const file = fileSelection.path;
  const setFile = (path: string | null, reveal = true) =>
    setFileSelection({ path, reveal });
  const [editing, setEditing] = useState<{
    pull: Pull;
    path: string;
    line?: number;
  } | null>(null);
  useEffect(() => {
    // A project's review pane keeps its own place; only the page's is saved.
    if (embedded) return;
    const workspace = {
      pull: selected,
      file,
      filter: initialWorkspace.filter,
      query,
      state,
    };
    // The inbox remounts from the bootstrap snapshot, so keep that current too.
    qc.setQueryData<Bootstrap>(
      ["bootstrap"],
      (boot) => boot && { ...boot, workspace },
    );
    void api.saveWorkspace(workspace).catch(setError);
  }, [selected, file, query, state]);
  useEffect(() => {
    if (embedded) return;
    const key = `relay-pulls-repo:${account.id}`;
    if (repo) localStorage.setItem(key, repo);
    else localStorage.removeItem(key);
  }, [repo]);
  const navigation = useRef(0);
  const selectFile = (path: string) => {
    navigation.current++;
    setFile(path);
  };
  useEffect(
    () => () => {
      navigation.current++;
    },
    [],
  );
  const pull = useQuery({
    queryKey: ["pull", selected],
    queryFn: () => api.pull(selected!),
    enabled: !!selected,
  });
  const checks = useProjectChecks(pull.data);
  const resume = useQuery({
    queryKey: ["resume", selected, pull.data && revisionOf(pull.data)],
    queryFn: () =>
      shouldResumeReview(pull.data!, account.user.id, (ref, page) =>
        api.reviews(ref, page),
      ),
    enabled: restoring && !!pull.data,
    staleTime: 0,
  });
  useEffect(() => {
    if (!restoring || resume.data === undefined) return;
    if (!resume.data) {
      setSelected(null);
      setFile(null);
    }
    setRestoring(false);
  }, [restoring, resume.data]);
  const progressController = useReviewProgress(selected, setError);
  const { progress } = progressController;
  const changedSinceViewed = useViewedCarryOver(
    selected,
    pull.data,
    progressController,
  );
  const revision = pull.data ? revisionOf(pull.data) : "";
  const triageKey = ["triage", selected, revision];
  const triage = useQuery({
    queryKey: triageKey,
    queryFn: () =>
      api.triageState(selected!, pull.data!.head.sha, pull.data!.merge_base),
    enabled: !!pull.data && !restoring,
    refetchInterval: (query) => (isAnalyzing(query.state.data) ? 600 : false),
  });
  const [analysisBusy, setAnalysisBusy] = useState(false),
    [analysisError, setAnalysisError] = useState<unknown>(),
    [plainFiles, setPlainFiles] = useState(false),
    [commentPaths, setCommentPaths] = useState<string[]>([]);
  const analysisResult =
    triage.data?.revision === revision ? triage.data.result : undefined;
  const reviewGroups = useMemo(() => {
    const excluded = new Set([
      ...commentPaths,
      ...notedPaths(progress, revision),
    ]);
    return (analysisResult?.groups ?? [])
      .map((group) => ({
        ...group,
        paths: group.paths.filter((path) => !excluded.has(path)),
      }))
      .filter((group) => group.paths.length >= 2);
  }, [analysisResult, commentPaths, progress.drafts, progress.marks, revision]);
  useEffect(() => {
    setCommentPaths([]);
    setAnalysisError(undefined);
  }, [revision, selected]);
  const startAnalysis = async () => {
    if (!pull.data || !selected) return;
    setAnalysisBusy(true);
    setAnalysisError(undefined);
    try {
      const state = await api.startTriage(
        selected,
        pull.data.head.sha,
        pull.data.merge_base,
      );
      qc.setQueryData(triageKey, state);
      setPlainFiles(false);
    } catch (e) {
      setAnalysisError(e);
    } finally {
      setAnalysisBusy(false);
    }
  };
  const cancelAnalysis = async () => {
    if (!pull.data || !selected) return;
    try {
      await api.cancelTriage(
        selected,
        pull.data.head.sha,
        pull.data.merge_base,
      );
      await triage.refetch();
    } catch (e) {
      setAnalysisError(e);
    }
  };
  const files = useInfiniteQuery({
    queryKey: ["files", selected, pull.data?.head.sha],
    queryFn: ({ pageParam }) => api.files(selected!, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
    enabled: !!pull.data && !restoring,
  });
  useEffect(() => {
    if (
      !analysisResult &&
      fileFilter &&
      files.hasNextPage &&
      !files.isFetchingNextPage
    )
      void files.fetchNextPage();
  }, [fileFilter, files.hasNextPage, files.isFetchingNextPage, files.data]);
  const allFiles = useMemo(
    () =>
      analysisResult?.files ?? files.data?.pages.flatMap((p) => p.items) ?? [],
    [files.data, analysisResult],
  );
  // The sidebar and keyboard navigation share the same logical order, including
  // files in collapsed groups. Flat view retains the repository's file order.
  const reviewFiles = useMemo(() => {
    if (plainFiles || !reviewGroups.length) return allFiles;
    const byPath = new Map(allFiles.map((entry) => [entry.filename, entry]));
    const grouped = reviewGroups.flatMap((group) => group.paths);
    const groupedPaths = new Set(grouped);
    return [
      ...grouped.flatMap((path) => {
        const entry = byPath.get(path);
        return entry ? [entry] : [];
      }),
      ...allFiles.filter((entry) => !groupedPaths.has(entry.filename)),
    ];
  }, [allFiles, reviewGroups, plainFiles]);
  useEffect(() => {
    if (!analysisResult && !files.data) return;
    if (file && allFiles.some((f) => f.filename === file)) return;
    // A restored file may be on a later metadata page. Do not mount/fetch the
    // first diff while finding it, or overwrite its saved selection early.
    if (file && !analysisResult) {
      if (files.isFetching || files.isError) return;
      if (files.hasNextPage) {
        void files.fetchNextPage();
        return;
      }
    }
    setFile(allFiles[0]?.filename ?? null);
  }, [
    allFiles,
    file,
    analysisResult,
    files.data,
    files.hasNextPage,
    files.isFetching,
    files.isError,
  ]);
  // Declared after the fallback above, so a requested file wins over it.
  const reveal = embedded?.reveal;
  useEffect(() => {
    if (!reveal || (!analysisResult && !files.data)) return;
    const match = allFiles.find((f) => linksTo(reveal, f.filename));
    if (!match && !analysisResult && files.hasNextPage) {
      if (!files.isFetching && !files.isError) void files.fetchNextPage();
      return;
    }
    if (match) selectFile(match.filename);
    else
      setError(
        new Error(
          reveal.directory
            ? `This pull request doesn’t change anything in ${reveal.path}/.`
            : `This pull request doesn’t change ${reveal.path}.`,
        ),
      );
    embedded?.onRevealConsumed?.();
  }, [
    reveal?.request,
    allFiles,
    analysisResult,
    files.data,
    files.hasNextPage,
    files.isFetching,
    files.isError,
  ]);
  const advanceUnread = async (
    path: string,
    nextProgress: Progress,
    reveal = true,
  ) => {
    const request = ++navigation.current;
    const revision = pull.data ? revisionOf(pull.data) : "";
    const unread = (entry: ChangedFile) =>
      nextProgress.read[entry.filename] !== revision;
    let loaded = reviewFiles;
    const start = loaded.findIndex((entry) => entry.filename === path) + 1;
    let next = loaded.slice(start).find(unread);
    let hasMore = !analysisResult && files.hasNextPage;
    try {
      // Fetch only metadata when advancing beyond the loaded page, never file contents.
      while (!next && hasMore) {
        const result = await files.fetchNextPage({ cancelRefetch: false });
        if (request !== navigation.current) return;
        if (result.isError) throw result.error;
        const previousCount = loaded.length;
        loaded = result.data?.pages.flatMap((page) => page.items) ?? loaded;
        hasMore = result.hasNextPage;
        if (hasMore && loaded.length <= previousCount)
          throw new Error(
            "Could not load the next files. Try loading more from the file list.",
          );
        next = loaded.slice(start).find(unread);
      }
      // At the end, pick up any earlier unread files; stop once the review is complete.
      next ??= loaded.slice(0, start - 1).find(unread);
      if (next && request === navigation.current)
        setFile(next.filename, reveal);
    } catch (error) {
      if (request === navigation.current) setError(error);
    }
  };
  const select = (r: PullRef) => {
    setRestoring(false);
    if (
      r.owner === selected?.owner &&
      r.name === selected.name &&
      r.number === selected.number
    )
      return;
    navigation.current++;
    setSelected(r);
    setFile(null);
  };
  const deselect = () => {
    setRestoring(false);
    navigation.current++;
    setSelected(null);
    setFile(null);
  };
  /** A PR in one of your projects opens on its thread; any other one here. */
  const open = (r: PullRef) => {
    const project = pulls?.projectOf(r);
    if (project) pulls!.onOpenInProject(project, r);
    else select(r);
  };
  const nav = pulls?.nav;
  // A request from before this mount is spent; answering it would drop the restored PR.
  const handledNav = useRef(nav?.request);
  useEffect(() => {
    if (!nav || nav.request === handledNav.current) return;
    handledNav.current = nav.request;
    setRepo(nav.to === "repo" ? nav.repo : null);
    deselect();
  }, [nav?.request]);
  const repoLabel = (key: string) => {
    const [owner, name] = key.split("/");
    return pulls?.projectOf({ owner, name })?.name ?? key;
  };
  useEffect(() => {
    pulls?.onLocation({
      repo: selected
        ? {
            key: repoKey(selected),
            label:
              pulls.projectOf(selected)?.name ??
              `${selected.owner}/${selected.name}`,
          }
        : repo
          ? { key: repo, label: repoLabel(repo) }
          : null,
      pull: selected
        ? { number: selected.number, title: pull.data?.title }
        : null,
    });
  }, [selected, repo, pull.data?.title]);
  const openUrl = async (url: string) => {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol === roomProtocol + ":" ||
        parsed.hash.startsWith("#join=")
      ) {
        const invitation = parseRoomInvitation(url);
        if (!invitation.project || !invitation.number)
          throw new Error(
            "This older invitation has no PR target. Open its repository and paste the link into its PR room.",
          );
        setRoomInvitationUrl(url);
        setUrlOpen(false);
        return;
      }
      open(await api.parseUrl(url));
      setUrlOpen(false);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    const url = incomingLink?.url ?? pendingUrl;
    if (url) void openUrl(url);
  }, [pendingUrl, incomingLink]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        document.querySelector(`dialog[open], ${SETTINGS_PAGE}`)
      )
        return;
      // A thread's review stays on its own PR.
      if (!embedded && matches("pr-open", e)) {
        e.preventDefault();
        setUrlOpen((v) => !v);
      }
      if (e.repeat) return;
      if (matches("review-files", e)) {
        e.preventDefault();
        setFilesHidden((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const refresh = async () => {
    navigation.current++;
    await Promise.all([
      qc.invalidateQueries({ queryKey: [PULL_BOARD] }),
      qc.invalidateQueries({ queryKey: ["pull"] }),
      qc.invalidateQueries({ queryKey: ["files"] }),
      qc.invalidateQueries({ queryKey: ["reviews"] }),
      qc.invalidateQueries({ queryKey: ["reviewComments"] }),
      qc.invalidateQueries({ queryKey: ["discussion"] }),
    ]);
  };
  useEffect(
    () => setRoomTarget(null),
    [selected?.owner, selected?.name, selected?.number],
  );
  const current = allFiles.find((f) => f.filename === file);
  const localProject = selected ? pulls?.projectOf(selected) : undefined;
  const readCount = allFiles.filter(
    (f) => progress.read[f.filename] === revision,
  ).length;
  useEffect(() => {
    embedded?.onPresence?.({
      path: file,
      viewed: readCount,
      total: pull.data?.changed_files ?? 0,
    });
  }, [file, readCount, pull.data?.changed_files]);
  const paneControls = embedded ? (
    <IconButton
      label="Toggle changed files"
      onClick={() => setFilesHidden((v) => !v)}
    >
      <FileCode2 size={17} />
    </IconButton>
  ) : (
    <PaneControls
      filesHidden={filesHidden}
      onToggleFiles={() => setFilesHidden((v) => !v)}
      onRefresh={() => void refresh()}
      roomOpen={roomOpen}
      onToggleRoom={
        pull.data && !restoring ? () => setRoomOpen((v) => !v) : undefined
      }
    />
  );
  return (
    <>
      {pulls && !selected ? (
        <PullRequestsPage
          account={account}
          projects={pulls.projects}
          repo={repo}
          onRepo={setRepo}
          query={query}
          onQuery={setQuery}
          state={state}
          onState={setState}
          onOpen={(p) => open(p.ref)}
          onOpenUrl={() => setUrlOpen(true)}
          onOpenProject={pulls.onOpenProject}
          onAddProject={pulls.onAddProject}
        />
      ) : (
        <>
          <section
            id="files-sidebar"
            className="files-pane"
            aria-label="Changed files"
            hidden={filesHidden}
          >
            <PaneResizer
              pane="inbox"
              label="Resize file list"
              initial={282}
              min={230}
              max={410}
            />
            <header className="titlebar files-titlebar" hidden={!!embedded}>
              <strong>Changed files</strong>
              {selected && (
                <span className="file-total">
                  {pull.data?.changed_files ?? allFiles.length}
                </span>
              )}
              <IconButton
                label="Hide changed files"
                onClick={() => setFilesHidden(true)}
              >
                <PanelLeftClose size={17} />
              </IconButton>
            </header>
            {selected ? (
              <>
                <div className="files-controls">
                  <div className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="Filter files"
                      placeholder="Filter files…"
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value)}
                    />
                  </div>
                </div>
                {pull.data && !restoring && (
                  <TriageControls
                    state={triage.data}
                    busy={analysisBusy}
                    error={analysisError || triage.error}
                    onStart={() => void startAnalysis()}
                    onCancel={() => void cancelAnalysis()}
                    plain={plainFiles}
                    onToggle={() => setPlainFiles((v) => !v)}
                    individualReason={
                      file ? triage.data?.result?.ordinary[file] : undefined
                    }
                    incomplete={Boolean(
                      file &&
                      triage.data?.result?.incompleteFiles?.includes(file),
                    )}
                  />
                )}
                <div className="files-context" hidden={!!embedded}>
                  <span title={`${selected.owner}/${selected.name}`}>
                    {selected.owner}/{selected.name}
                  </span>
                  <span>
                    {readCount}/{pull.data?.changed_files ?? allFiles.length}{" "}
                    viewed
                  </span>
                </div>
                <div className="file-tree">
                  <GroupedFileList
                    checks={checks.state}
                    files={allFiles}
                    selection={fileSelection}
                    onSelect={selectFile}
                    progress={progress}
                    revision={revision}
                    changedSinceViewed={changedSinceViewed}
                    result={analysisResult}
                    groups={reviewGroups}
                    filter={fileFilter}
                    plain={plainFiles}
                    onReviewGroup={async (group, viewed) => {
                      if (
                        !selected ||
                        !pull.data ||
                        !progressController.initial.isSuccess
                      )
                        throw new Error("Review data is still loading.");
                      const nav = navigation.current;
                      const paths = await api.groupPaths(
                        selected,
                        pull.data.head.sha,
                        pull.data.merge_base,
                        group.id,
                      );
                      if (nav !== navigation.current)
                        throw new Error(
                          "The selected review changed. Open the group again.",
                        );
                      const next = progressController.update((p) => {
                        const protectedPaths = new Set([
                          ...notedPaths(p, revision),
                          ...commentPaths,
                        ]);
                        const read = { ...p.read };
                        for (const path of paths)
                          if (
                            group.paths.includes(path) &&
                            !protectedPaths.has(path)
                          ) {
                            if (viewed) read[path] = revision;
                            else if (read[path] === revision) delete read[path];
                          }
                        return { ...p, read };
                      });
                      if (viewed && file && paths.includes(file))
                        await advanceUnread(file, next, false);
                    }}
                  />
                  {files.error && (
                    <ErrorBox
                      error={files.error}
                      retry={() => void files.refetch()}
                    />
                  )}
                  <div className="file-more">
                    {!analysisResult && files.hasNextPage && (
                      <button
                        onClick={() => void files.fetchNextPage()}
                        disabled={files.isFetchingNextPage}
                      >
                        {files.isFetchingNextPage
                          ? "Loading…"
                          : "Load more files"}
                      </button>
                    )}
                    {files.isPending && <Loading />}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty files-empty">
                <FileCode2 size={28} />
                <strong>Choose a pull request</strong>
                <span>Its changed files will appear here.</span>
              </div>
            )}
            <footer className="files-footer" hidden={!!embedded}>
              {selected && pulls && (
                <span className="review-local-note">
                  {localProject ? (
                    <>
                      <span>In {localProject.name}</span>
                      <button
                        onClick={() =>
                          pulls.onOpenInProject(localProject, selected)
                        }
                      >
                        Open its thread
                      </button>
                    </>
                  ) : (
                    <>
                      <span>Not on this Mac</span>
                      <button onClick={() => pulls.onAddProject(selected)}>
                        Add its folder…
                      </button>
                    </>
                  )}
                </span>
              )}
              <IconButton
                label="Open Gitea"
                onClick={() => void api.openExternal(account.server)}
              >
                <ArrowUpRight size={13} />
              </IconButton>
            </footer>
          </section>
          {!embedded && roomOpen && pull.data && !restoring && (
            <RoomPanel
              key={JSON.stringify([
                account.id,
                pull.data.owner,
                pull.data.name,
                pull.data.number,
              ])}
              pull={pull.data}
              accountId={account.id}
              onAppSettings={onSettings}
              path={current?.filename}
              target={
                roomTarget?.key ===
                `${pull.data.owner}/${pull.data.name}#${pull.data.number}`
                  ? roomTarget.value
                  : null
              }
              viewed={readCount}
              onClearTarget={() => setRoomTarget(null)}
              onClose={() => {
                setRoomOpen(false);
              }}
              onSelect={selectFile}
              onLink={() => {
                void api
                  .linkFolder(pull.data!)
                  .then(() => qc.invalidateQueries({ queryKey: ["folder"] }))
                  .catch(setError);
              }}
            />
          )}
          <main className="review-main">
            {(pull.error || !pull.data || restoring) && (
              <header className="titlebar empty-titlebar">
                <span>Your review workspace</span>
                <div className="toolbar-actions">{paneControls}</div>
              </header>
            )}
            {pull.error ? (
              <ErrorBox error={pull.error} retry={() => void pull.refetch()} />
            ) : !pull.data ? (
              <Loading text="Opening pull request…" />
            ) : restoring ? (
              resume.error ? (
                <ErrorBox
                  error={resume.error}
                  retry={() => void resume.refetch()}
                />
              ) : (
                <Loading text="Checking your last review…" />
              )
            ) : (
              <ReviewWorkspace
                onDiscuss={(target) => {
                  if (embedded?.onDiscuss) {
                    embedded.onDiscuss(target, pull.data!);
                    return;
                  }
                  setRoomTarget({
                    key: `${pull.data!.owner}/${pull.data!.name}#${pull.data!.number}`,
                    value: target,
                  });
                  setRoomOpen(true);
                }}
                checks={checks}
                key={JSON.stringify(selected)}
                pull={pull.data}
                file={current}
                files={reviewFiles}
                progressController={progressController}
                changedSinceViewed={changedSinceViewed}
                onCommentPaths={setCommentPaths}
                onError={setError}
                onRefresh={refresh}
                onSelectFile={selectFile}
                onFileViewed={advanceUnread}
                paneControls={paneControls}
                slots={embedded?.slots}
                workspace={embedded?.workspace}
                onEditFile={(path, line) =>
                  embedded?.onEditFile
                    ? embedded.onEditFile(path, line)
                    : setEditing({ pull: pull.data!, path, line })
                }
              />
            )}
          </main>
        </>
      )}
      {!!error && (
        <div className="toast error" role="alert">
          <ErrorBox error={error} />
          <button onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      )}
      {roomInvitationUrl && (
        <RoomInvitationDialog
          key={roomInvitationUrl}
          url={roomInvitationUrl}
          account={account}
          onClose={() => setRoomInvitationUrl(undefined)}
          onJoined={(ref) => {
            select(ref);
            setRoomOpen(true);
            void qc.invalidateQueries({ queryKey: ["roomState"] });
            setRoomInvitationUrl(undefined);
          }}
        />
      )}
      {!embedded && urlOpen && (
        <OpenUrl onOpen={openUrl} onClose={() => setUrlOpen(false)} />
      )}
      {editing && (
        <Suspense
          fallback={
            <Modal
              title="Opening local editor"
              onClose={() => setEditing(null)}
            >
              <Loading />
            </Modal>
          }
        >
          <LocalFileEditor
            onDirtyChange={onDirtyChange}
            checks={checks}
            {...editing}
            onClose={() => {
              setEditing(null);
              void qc.invalidateQueries({ queryKey: ["folder"] });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
function OpenUrl({
  onOpen,
  onClose,
}: {
  onOpen: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <Modal title="Open a pull request" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onOpen(url);
        }}
      >
        <label>
          Gitea pull request URL
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://git.example.com/team/project/pulls/42"
            required
          />
        </label>
        <p className="muted">
          Paste the PR URL, including a link to its Files tab.
        </p>
        <button className="primary" disabled={!url.trim()}>
          Open pull request <ArrowRight size={15} />
        </button>
      </form>
    </Modal>
  );
}
