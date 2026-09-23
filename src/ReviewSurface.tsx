import type { PaneSlots } from "./components/WorkspacePanes";
import { RoomPanel } from "./components/RoomPanel";
import { RelayMark } from "./components/RelayMark";
import { RoomInvitationDialog } from "./components/RoomInvitationDialog";
import { parseRoomInvitation, roomProtocol } from "../shared/rooms";
import type { QuestionTarget } from "../shared/questions";
import type { SettingsCategory } from "./components/Settings";
import { useProjectChecks } from "./lib/useProjectChecks";
import { useReviewProgress } from "./lib/useReviewProgress";
import { shouldResumeReview } from "./lib/resumeReview";
import {
  GroupedFileList,
  type FileSelection,
} from "./components/GroupedFileList";
import { TriageControls } from "./components/TriageControls";
import { isAnalyzing } from "../shared/triage";
import { useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpRight,
  Check,
  FileCode2,
  FolderGit2,
  GitPullRequest,
  Inbox,
  Link2,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { api } from "./lib/api";
import { linksTo, type ProjectFileLink } from "./lib/project-file-links";
import type {
  Account,
  Bootstrap,
  ChangedFile,
  Issue,
  Progress,
  PullRef,
  Pull,
  WorkspaceState,
} from "../shared/types";
import { revisionOf } from "../shared/types";
import {
  Avatar,
  ErrorBox,
  IconButton,
  Loading,
  Modal,
  relativeDate,
} from "./components/ui";
import { PaneResizer } from "./components/PaneResizer";
import { PaneControls } from "./components/PaneControls";
import { ReviewWorkspace } from "./components/ReviewWorkspace";
const LocalFileEditor = lazy(() => import("./components/LocalFileEditor"));
const labels: Record<string, string> = {
  review_requested: "Needs my review",
  assigned: "Assigned to me",
  created: "Created by me",
  all: "All pull requests",
};
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
  account,
  onSettings,
  pendingUrl,
  initialWorkspace,
  incomingLink,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  embedded?: {
    ref: PullRef;
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
  account: Account;
  onSettings: (category?: SettingsCategory) => void;
  pendingUrl?: string;
  initialWorkspace: WorkspaceState;
  incomingLink?: { url: string };
}) {
  const [roomInvitationUrl, setRoomInvitationUrl] = useState<string>();
  const [roomOpen, setRoomOpen] = useState(
    () => localStorage.getItem("relay-room-open") === "true",
  );
  const [roomTarget, setRoomTarget] = useState<{
    key: string;
    value: QuestionTarget;
  } | null>(null);
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState(
    !embedded && !!initialWorkspace.pull && !pendingUrl,
  );
  const [filter, setFilter] = useState(initialWorkspace.filter),
    [query, setQuery] = useState(initialWorkspace.query),
    [search, setSearch] = useState(initialWorkspace.query),
    [state, setState] = useState(initialWorkspace.state),
    [selected, setSelected] = useState<PullRef | null>(
      embedded?.ref ?? initialWorkspace.pull,
    ),
    [fileSelection, setFileSelection] = useState<FileSelection>({
      path: initialWorkspace.file,
      reveal: true,
    }),
    [requestsHidden, setRequestsHidden] = useState(
      () => localStorage.getItem("relay-requests-hidden") === "true",
    ),
    [filesHidden, setFilesHidden] = useState(
      () => localStorage.getItem("relay-files-hidden") === "true",
    ),
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
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A project's review pane keeps its own place; only the inbox's is saved.
    if (embedded) return;
    const workspace = { pull: selected, file, filter, query, state };
    // The inbox remounts from the bootstrap snapshot, so keep that current too.
    qc.setQueryData<Bootstrap>(
      ["bootstrap"],
      (boot) => boot && { ...boot, workspace },
    );
    void api.saveWorkspace(workspace).catch(setError);
  }, [selected, file, filter, query, state]);
  useEffect(() => {
    localStorage.setItem("relay-requests-hidden", String(requestsHidden));
    localStorage.setItem("relay-files-hidden", String(filesHidden));
  }, [requestsHidden, filesHidden]);
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
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const inbox = useInfiniteQuery({
    queryKey: ["inbox", filter, search, state],
    queryFn: ({ pageParam }) => api.search(filter, search, state, pageParam),
    enabled: !embedded,
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
  });
  const pulls = inbox.data?.pages.flatMap((p) => p.items) ?? [];
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
      ...progress.drafts.map((d) => d.path),
      ...progress.marks.map((m) => m.path),
    ]);
    return (analysisResult?.groups ?? [])
      .map((group) => ({
        ...group,
        paths: group.paths.filter((path) => !excluded.has(path)),
      }))
      .filter((group) => group.paths.length >= 2);
  }, [analysisResult, commentPaths, progress.drafts, progress.marks]);
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
      select(await api.parseUrl(url));
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
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (!e.metaKey && !e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setUrlOpen((v) => !v);
      }
      if (!embedded && key === "f") {
        e.preventDefault();
        setRequestsHidden(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (key === "b" && !e.repeat) {
        e.preventDefault();
        if (e.shiftKey) setRequestsHidden((v) => !v);
        else setFilesHidden((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const refresh = async () => {
    navigation.current++;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["inbox"] }),
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
      requestsHidden={requestsHidden}
      filesHidden={filesHidden}
      onToggleRequests={() => setRequestsHidden((v) => !v)}
      onToggleFiles={() => setFilesHidden((v) => !v)}
      roomOpen={roomOpen}
      onToggleRoom={
        pull.data && !restoring
          ? () =>
              setRoomOpen((v) => {
                localStorage.setItem("relay-room-open", String(!v));
                return !v;
              })
          : undefined
      }
    />
  );
  return (
    <>
      <aside
        id="requests-sidebar"
        className="sidebar"
        aria-label="Workspace"
        hidden={!!embedded || requestsHidden}
      >
        <PaneResizer pane="sidebar" initial={280} min={230} max={380} />
        <header className="titlebar sidebar-titlebar">
          <span className="traffic-space" />
          <IconButton
            label="Hide pull requests"
            onClick={() => setRequestsHidden(true)}
          >
            <PanelLeft size={18} />
          </IconButton>
        </header>
        <div className="workspace-label">
          <RelayMark size={28} />
          <strong>Relay</strong>
        </div>
        <div className="section-label">WORKSPACE</div>
        <nav>
          {Object.entries(labels).map(([value, label]) => {
            const Icon =
              value === "review_requested"
                ? Inbox
                : value === "assigned"
                  ? UserRound
                  : value === "created"
                    ? GitPullRequest
                    : FolderGit2;
            return (
              <button
                key={value}
                className={`nav-row ${filter === value ? "selected" : ""}`}
                onClick={() => {
                  setFilter(value as WorkspaceState["filter"]);
                }}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <button className="nav-row open-link" onClick={() => setUrlOpen(true)}>
          <Link2 size={17} />
          <span>Open PR by URL</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="sidebar-divider" />
        <section className="sidebar-pulls" aria-label="Pull requests">
          <div className="section-label pull-section-title">
            <span>PULL REQUESTS</span>
            <IconButton
              label="Refresh pull requests"
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} className={inbox.isFetching ? "spin" : ""} />
            </IconButton>
          </div>
          <div className="pr-controls">
            <div className="search-field">
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Search pull requests"
                placeholder="Search pull requests"
                value={query}
                maxLength={500}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘F</kbd>
            </div>
            <div className="segmented">
              {(["open", "closed", "all"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setState(v)}
                  className={state === v ? "active" : ""}
                >
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="pr-list-meta">
            <span>{labels[filter]}</span>
            <span>
              {inbox.data?.pages[0].total ?? pulls.length}
              {inbox.hasNextPage ? "+" : ""}
            </span>
          </div>
          <div className="pr-list">
            {inbox.isPending && <Loading text="Finding your pull requests…" />}
            {inbox.error && (
              <ErrorBox
                error={inbox.error}
                retry={() => void inbox.refetch()}
              />
            )}
            <InboxList items={pulls} selected={selected} onSelect={select} />
            {!inbox.isPending && !inbox.error && !pulls.length && (
              <div className="empty inbox-empty">
                <Inbox size={27} />
                <strong>
                  {search ? "No matches" : "You’re all caught up"}
                </strong>
                <span>
                  {search
                    ? "Try a different search."
                    : "Try Assigned to me or All pull requests."}
                </span>
              </div>
            )}
            {inbox.hasNextPage && (
              <button
                className="load-more"
                disabled={inbox.isFetchingNextPage}
                onClick={() => void inbox.fetchNextPage()}
              >
                {inbox.isFetchingNextPage
                  ? "Loading…"
                  : "Load more pull requests"}
              </button>
            )}
          </div>
        </section>
        <footer className="account-footer">
          <Avatar name={account.user.login} />
          <div>
            <strong>{account.user.full_name || account.user.login}</strong>
            <small>
              <span className="dot green" />
              {new URL(account.server).host}
            </small>
          </div>
          <IconButton label="Settings" onClick={() => onSettings()}>
            <Settings2 size={17} />
          </IconButton>
        </footer>
      </aside>
      <section
        id="files-sidebar"
        className={`files-pane ${!embedded && requestsHidden ? "is-first-pane" : ""}`}
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
                  file && triage.data?.result?.incompleteFiles?.includes(file),
                )}
              />
            )}
            <div className="files-context" hidden={!!embedded}>
              <span title={`${selected.owner}/${selected.name}`}>
                {selected.owner}/{selected.name}
              </span>
              <span>
                {readCount}/{pull.data?.changed_files ?? allFiles.length} viewed
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
                      ...p.drafts.map((d) => d.path),
                      ...p.marks.map((m) => m.path),
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
                    {files.isFetchingNextPage ? "Loading…" : "Load more files"}
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
          <span className="dot green" />
          Connected to Gitea
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
          firstPane={requestsHidden && filesHidden}
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
            localStorage.setItem("relay-room-open", "false");
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
      <main
        className={`review-main ${!embedded && requestsHidden && filesHidden && !(roomOpen && pull.data && !restoring) ? "is-first-pane" : ""}`}
      >
        {(!selected || pull.error || !pull.data || restoring) && (
          <header className="titlebar empty-titlebar">
            <span>Your review workspace</span>
            <div className="toolbar-actions">
              {paneControls}
              <IconButton label="Open settings" onClick={() => onSettings()}>
                <Settings2 size={16} />
              </IconButton>
            </div>
          </header>
        )}
        {!selected ? (
          <>
            <div className="empty welcome-empty">
              <div className="empty-illustration">
                <GitPullRequest size={35} />
                <span>
                  <Check size={15} />
                </span>
              </div>
              <h2>A fresh pair of eyes.</h2>
              <p>
                Choose a pull request to see what changed.
                <br />
                We’ll keep your place while you review.
              </p>
              <button onClick={() => setUrlOpen(true)}>
                <Link2 size={15} /> Open a pull request <kbd>⌘K</kbd>
              </button>
            </div>
          </>
        ) : pull.error ? (
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
            onSettings={() => onSettings()}
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
            onCommentPaths={setCommentPaths}
            onError={setError}
            onRefresh={refresh}
            onSelectFile={selectFile}
            onFileViewed={advanceUnread}
            paneControls={paneControls}
            slots={embedded?.slots}
            onEditFile={(path, line) =>
              embedded?.onEditFile
                ? embedded.onEditFile(path, line)
                : setEditing({ pull: pull.data!, path, line })
            }
          />
        )}
      </main>
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
            localStorage.setItem("relay-room-open", "true");
            void qc.invalidateQueries({ queryKey: ["roomState"] });
            setRoomInvitationUrl(undefined);
          }}
        />
      )}
      {urlOpen && (
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
function InboxList({
  items,
  selected,
  onSelect,
}: {
  items: Issue[];
  selected: PullRef | null;
  onSelect: (r: PullRef) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 110,
    overscan: 5,
  });
  return (
    <div ref={parent} className="inbox-virtual">
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((v) => {
          const pr = items[v.index],
            repo = pr.repository;
          return (
            <button
              key={pr.id}
              ref={virtual.measureElement}
              data-index={v.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start}px)`,
              }}
              className={`pr-item ${selected?.number === pr.number && selected.owner === repo.owner && selected.name === repo.name ? "active" : ""}`}
              onClick={() =>
                onSelect({
                  owner: repo.owner,
                  name: repo.name,
                  number: pr.number,
                })
              }
            >
              <div className="pr-item-top">
                <span>{repo.full_name}</span>
                <time>{relativeDate(pr.updated_at)}</time>
              </div>
              <div className="pr-item-title">
                <GitPullRequest size={15} />
                <strong>{pr.title}</strong>
              </div>
              <div className="pr-item-bottom">
                <span>
                  #{pr.number} · {pr.user.login}
                </span>
                {pr.comments > 0 && (
                  <span>
                    <MessageSquare size={12} />
                    {pr.comments}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
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
