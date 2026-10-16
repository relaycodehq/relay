import {
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import type {
  Account,
  Pull,
  PullRef,
  Repo,
  WorkspaceState,
} from "../../shared/types";
import { api } from "../lib/api";
import {
  pullsLocation,
  type PullsLocation,
  type PullsPageHandle,
} from "../features/pulls/pull-board";
import { useShortcut } from "../lib/shortcuts";
import { usePullReview } from "../features/review/usePullReview";
import { usePullSelection } from "../features/review/usePullSelection";
import { usePullsRepo } from "../features/pulls/usePullsRepo";
import { accountOn } from "../features/pulls/usePullHosts";
import { useSavedWorkspace } from "../features/pulls/useSavedWorkspace";
import { useStoredFlag } from "../lib/useStoredFlag";
// In the order ReviewSurface imported them, so their stylesheets keep their place in the
// cascade. Its tea-signin.css now comes later, through ProjectShell's SignIn; nothing it
// overlaps with sits in between.
import { Loading, Modal } from "../ui/ui";
import { PaneControls } from "../features/review/PaneControls";
import { ErrorToast, ReviewPanes } from "../features/review/ReviewPanes";
import { PullRequestsPage } from "../features/pulls/PullRequestsPage";
import { OpenPullUrl } from "../features/pulls/OpenPullUrl";

const LocalFileEditor = lazy(() => import("../features/files/editor/LocalFileEditor"));

/**
 * The Pull requests page: its board while no PR is open, else the PR's
 * review. A PR whose repository is one of your projects opens
 * on that project's thread instead. The page reopens where it was left.
 */
export function PullsSurface({
  ref,
  accounts,
  hostError,
  onRecheckHosts,
  projects,
  projectOf,
  onOpenInProject,
  onOpenProject,
  onAddProject,
  onLocation,
  initialWorkspace,
  incomingLink,
}: {
  /** How the window title and sidebar leave a PR. */
  ref?: Ref<PullsPageHandle>;
  /** Every host you're signed in to; never empty. */
  accounts: Account[];
  hostError?: unknown;
  onRecheckHosts: () => void;
  projects: Project[];
  projectOf: (repo: Repo) => Project | undefined;
  onOpenInProject: (project: Project, ref: PullRef) => void;
  onOpenProject: (project: Project) => void;
  onAddProject: (repo?: Repo) => void;
  /** Where the page is, for the window title. */
  onLocation: (where: PullsLocation) => void;
  initialWorkspace: WorkspaceState;
  incomingLink?: { url: string };
}) {
  const qc = useQueryClient();
  const selection = usePullSelection(
    initialWorkspace.pull,
    initialWorkspace.file,
    !!initialWorkspace.pull,
  );
  const { selected, file, select, deselect } = selection;
  const [query, setQuery] = useState(initialWorkspace.query),
    [state, setState] = useState(initialWorkspace.state),
    [repo, setRepo] = usePullsRepo(),
    [filesHidden, setFilesHidden] = useStoredFlag("relay-files-hidden"),
    [urlOpen, setUrlOpen] = useState(false),
    [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<{
    pull: Pull;
    path: string;
    line?: number;
  } | null>(null);
  useSavedWorkspace(
    {
      pull: selected,
      file,
      filter: initialWorkspace.filter,
      query,
      state,
    },
    setError,
  );
  // The open PR is reviewed as you on its host; without a sign-in there it
  // still opens, and says why it can't load.
  const account = accountOn(accounts, selected?.server) ?? accounts[0];
  const review = usePullReview(selection, account, setError);
  const { pull } = review;
  const giteaServer = accountOn(accounts, undefined)?.server;
  /** Refs saved before refs named their server are the Gitea account's. */
  const located = (r: PullRef): PullRef =>
    r.server || !giteaServer ? r : { ...r, server: giteaServer };
  /** A PR in one of your projects opens on its thread; any other one here. */
  const open = (ref: PullRef) => {
    const r = located(ref);
    const project = projectOf(r);
    if (project) onOpenInProject(project, r);
    else select(r);
  };
  useImperativeHandle(ref, () => ({
    go(target) {
      setRepo(target.to === "repo" ? target.repo : null);
      deselect();
    },
  }));
  useEffect(() => {
    onLocation(
      pullsLocation(
        selected && located(selected),
        pull.data?.title,
        repo,
        projectOf,
      ),
    );
  }, [selected, repo, pull.data?.title]);
  const openUrl = async (url: string) => {
    try {
      open(await api.parseUrl(url));
      setUrlOpen(false);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    if (incomingLink?.url) void openUrl(incomingLink.url);
  }, [incomingLink]);
  useShortcut("pr-open", true, () => setUrlOpen((v) => !v));
  useShortcut("review-files", true, () => setFilesHidden((v) => !v));
  const localProject = selected ? projectOf(located(selected)) : undefined;
  return (
    <>
      {!selected ? (
        <PullRequestsPage
          accounts={accounts}
          hostError={hostError}
          onRecheckHosts={onRecheckHosts}
          projects={projects}
          repo={repo}
          onRepo={setRepo}
          query={query}
          onQuery={setQuery}
          state={state}
          onState={setState}
          onOpen={(p) => open(p.ref)}
          onOpenUrl={() => setUrlOpen(true)}
          onOpenProject={onOpenProject}
          onAddProject={onAddProject}
        />
      ) : (
        <ReviewPanes
          review={review}
          selection={selection}
          selected={selected}
          filesHidden={filesHidden}
          onHideFiles={() => setFilesHidden(true)}
          bare={false}
          server={selected.server ?? account.server}
          note={
            <LocalNote
              project={localProject}
              onOpenThread={(p) => onOpenInProject(p, selected)}
              onAdd={() => onAddProject(located(selected))}
            />
          }
          paneControls={
            <PaneControls
              filesHidden={filesHidden}
              onToggleFiles={() => setFilesHidden((v) => !v)}
              onRefresh={() => void review.refresh()}
            />
          }
          onDiscuss={(_, p) => {
            // Lines are discussed in a PR thread, which needs the repository's project.
            const project = projectOf(p);
            if (project) onOpenInProject(project, p);
            else
              setError(
                new Error(
                  "Add this repository's folder as a project to discuss it in a thread.",
                ),
              );
          }}
          onEditFile={(path, line) =>
            setEditing({ pull: pull.data!, path, line })
          }
          onError={setError}
        />
      )}
      {!!error && (
        <ErrorToast error={error} onDismiss={() => setError(undefined)} />
      )}
      {urlOpen && (
        <OpenPullUrl onOpen={openUrl} onClose={() => setUrlOpen(false)} />
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
            checks={review.checks}
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

/** Whether the open PR's repository is cloned on this computer, so it can open on its thread. */
function LocalNote({
  project,
  onOpenThread,
  onAdd,
}: {
  project?: Project;
  onOpenThread: (project: Project) => void;
  onAdd: () => void;
}) {
  return (
    <span className="review-local-note">
      {project ? (
        <>
          <span>In {project.name}</span>
          <button onClick={() => onOpenThread(project)}>Open its thread</button>
        </>
      ) : (
        <>
          <span>Not cloned here</span>
          <button onClick={onAdd}>Add its folder…</button>
        </>
      )}
    </span>
  );
}
