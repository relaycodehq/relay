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
} from "../lib/pull-board";
import { isRoomInvitation } from "../lib/pull-links";
import { useShortcut } from "../lib/shortcuts";
import { usePullReview } from "../lib/usePullReview";
import { usePullRoom } from "../lib/usePullRoom";
import { usePullSelection } from "../lib/usePullSelection";
import { usePullsRepo } from "../lib/usePullsRepo";
import { useSavedWorkspace } from "../lib/useSavedWorkspace";
import { useStoredFlag } from "../lib/useStoredFlag";
// In the order ReviewSurface imported them, so their stylesheets keep their place in the
// cascade. Its tea-signin.css now comes later, through ProjectShell's SignIn; nothing it
// overlaps with sits in between.
import { RoomPanel } from "./RoomPanel";
import { RoomInvitationDialog } from "./RoomInvitationDialog";
import { Loading, Modal } from "./ui";
import { PaneControls } from "./PaneControls";
import { ErrorToast, ReviewPanes } from "./ReviewPanes";
import { PullRequestsPage } from "./PullRequestsPage";
import { OpenPullUrl } from "./OpenPullUrl";
import type { SettingsCategory } from "./Settings";

const LocalFileEditor = lazy(() => import("./LocalFileEditor"));

/**
 * The Pull requests page: its board while no PR is open, else the PR's
 * review with its room. A PR whose repository is one of your projects opens
 * on that project's thread instead. The page reopens where it was left.
 */
export function PullsSurface({
  ref,
  account,
  projects,
  projectOf,
  onOpenInProject,
  onOpenProject,
  onAddProject,
  onLocation,
  onSettings,
  initialWorkspace,
  incomingLink,
}: {
  /** How the window title and sidebar leave a PR. */
  ref?: Ref<PullsPageHandle>;
  account: Account;
  projects: Project[];
  projectOf: (repo: Repo) => Project | undefined;
  onOpenInProject: (project: Project, ref: PullRef) => void;
  onOpenProject: (project: Project) => void;
  onAddProject: (repo?: Repo) => void;
  /** Where the page is, for the window title. */
  onLocation: (where: PullsLocation) => void;
  onSettings: (category?: SettingsCategory) => void;
  initialWorkspace: WorkspaceState;
  incomingLink?: { url: string };
}) {
  const [roomInvitationUrl, setRoomInvitationUrl] = useState<string>();
  const qc = useQueryClient();
  const selection = usePullSelection(
    initialWorkspace.pull,
    initialWorkspace.file,
    !!initialWorkspace.pull,
  );
  const { selected, file, restoring, select, deselect, selectFile } = selection;
  const room = usePullRoom(selected);
  const [query, setQuery] = useState(initialWorkspace.query),
    [state, setState] = useState(initialWorkspace.state),
    [repo, setRepo] = usePullsRepo(account.id),
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
  const review = usePullReview(selection, account.user.id, setError);
  const { pull } = review;
  /** A PR in one of your projects opens on its thread; any other one here. */
  const open = (r: PullRef) => {
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
    onLocation(pullsLocation(selected, pull.data?.title, repo, projectOf));
  }, [selected, repo, pull.data?.title]);
  const openUrl = async (url: string) => {
    try {
      if (isRoomInvitation(url)) {
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
    if (incomingLink?.url) void openUrl(incomingLink.url);
  }, [incomingLink]);
  useShortcut("pr-open", true, () => setUrlOpen((v) => !v));
  useShortcut("review-files", true, () => setFilesHidden((v) => !v));
  const localProject = selected ? projectOf(selected) : undefined;
  return (
    <>
      {!selected ? (
        <PullRequestsPage
          account={account}
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
          server={account.server}
          note={
            <LocalNote
              project={localProject}
              onOpenThread={(p) => onOpenInProject(p, selected)}
              onAdd={() => onAddProject(selected)}
            />
          }
          room={
            room.open &&
            pull.data &&
            !restoring && (
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
                path={review.current?.filename}
                target={room.targetFor(pull.data)}
                viewed={review.readCount}
                onClearTarget={room.clearTarget}
                onClose={() => {
                  room.setOpen(false);
                }}
                onSelect={selectFile}
                onLink={() => {
                  void api
                    .linkFolder(pull.data!)
                    .then(() => qc.invalidateQueries({ queryKey: ["folder"] }))
                    .catch(setError);
                }}
              />
            )
          }
          paneControls={
            <PaneControls
              filesHidden={filesHidden}
              onToggleFiles={() => setFilesHidden((v) => !v)}
              onRefresh={() => void review.refresh()}
              roomOpen={room.open}
              onToggleRoom={
                pull.data && !restoring
                  ? () => room.setOpen((v) => !v)
                  : undefined
              }
            />
          }
          onDiscuss={(target, p) => room.discuss(p, target)}
          onEditFile={(path, line) =>
            setEditing({ pull: pull.data!, path, line })
          }
          onError={setError}
        />
      )}
      {!!error && (
        <ErrorToast error={error} onDismiss={() => setError(undefined)} />
      )}
      {roomInvitationUrl && (
        <RoomInvitationDialog
          key={roomInvitationUrl}
          url={roomInvitationUrl}
          account={account}
          onClose={() => setRoomInvitationUrl(undefined)}
          onJoined={(ref) => {
            select(ref);
            room.setOpen(true);
            void qc.invalidateQueries({ queryKey: ["roomState"] });
            setRoomInvitationUrl(undefined);
          }}
        />
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

/** Whether the open PR's repository is cloned on this Mac, so it can open on its thread. */
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
          <span>Not on this Mac</span>
          <button onClick={onAdd}>Add its folder…</button>
        </>
      )}
    </span>
  );
}
