import type { ChatScope, ChatSummary, Project } from "../../../shared/projects";
import type { TurnDiffTarget } from "../changes/turn-diff";
import { LinksControl } from "../linked-folders/LinksControl";
import type { ThreadLinks } from "../linked-folders/useThreadLinks";
import { NewThreadBranch } from "./NewThreadBranch";
import { NewWorkspacePicker } from "./NewWorkspacePicker";
import { StartedThreadBranch } from "./StartedThreadBranch";
import type { ThreadWorktree } from "./useThreadWorktree";
import { WorkspaceControl } from "./WorktreeControls";

/** The project checkout's branch, and whether switching it is held off. */
export interface ProjectCheckout {
  branch?: string | null;
  locked: boolean;
}

/**
 * The branch the thread works on. Picking one says where it works: before
 * the first message for the thread to start there, after it to move there.
 */
function ThreadBranch({
  project,
  worktree,
  checkout,
  unsent,
  disabled,
  onStartThread,
}: {
  project: Project;
  worktree: ThreadWorktree;
  checkout: ProjectCheckout;
  /** A thread of the project's own not started yet, which picks where it works. */
  unsent: boolean;
  disabled: boolean;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  // A folder without Git has no branch to show or switch.
  if (project.plain) return null;
  if (unsent)
    return (
      <NewThreadBranch
        project={project}
        worktree={worktree}
        checkout={checkout}
        disabled={disabled}
        onStartThread={onStartThread}
      />
    );
  // The deleted worktree's row asks where to carry on; its branch name would be stale.
  if (worktree.unavailable) return null;
  // Its name comes with the thread's title, a moment after sending.
  if (worktree.naming) return null;
  return (
    <StartedThreadBranch
      project={project}
      worktree={worktree}
      checkout={checkout}
      disabled={disabled}
      onStartThread={onStartThread}
    />
  );
}

/** The folder the thread works in: the project's checkout or a worktree. */
function ThreadFolder({
  chat,
  project,
  scope,
  worktree,
  checkout,
  running,
  busy,
  onOpenTurnDiff,
  onError,
}: {
  chat?: ChatSummary;
  project: Project;
  scope: ChatScope;
  worktree: ThreadWorktree;
  checkout: ProjectCheckout;
  running: boolean;
  busy: boolean;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  onError: (error: unknown) => void;
}) {
  // A PR or a review has its own; a folder without Git has no worktrees; a
  // project on another computer works in its folder there.
  if (scope.kind !== "project" || project.plain || project.computer)
    return null;
  if (!chat)
    return (
      <NewWorkspacePicker
        project={project}
        worktree={worktree}
        checkoutBranch={checkout.branch}
        disabled={busy}
      />
    );
  return (
    <WorkspaceControl
      chat={chat}
      worktree={worktree}
      running={running}
      busy={busy}
      onOpenTurnDiff={onOpenTurnDiff}
      onError={onError}
    />
  );
}

/** Where the thread works: its folder, its branch and the folders linked to it. */
export function ThreadWhere({
  chat,
  project,
  scope,
  worktree,
  checkout,
  links,
  running,
  busy,
  disabled,
  onOpenTurnDiff,
  onStartThread,
  onProjectSettings,
  onError,
}: {
  chat?: ChatSummary;
  project: Project;
  scope: ChatScope;
  worktree: ThreadWorktree;
  checkout: ProjectCheckout;
  links: ThreadLinks;
  running: boolean;
  /** Sending; the pickers wait for it. */
  busy: boolean;
  /** An answer is coming or sending is held off, so the branch stays put. */
  disabled: boolean;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
  onProjectSettings: () => void;
  onError: (error: unknown) => void;
}) {
  return (
    <>
      <ThreadFolder
        chat={chat}
        project={project}
        scope={scope}
        worktree={worktree}
        checkout={checkout}
        running={running}
        busy={busy}
        onOpenTurnDiff={onOpenTurnDiff}
        onError={onError}
      />
      <ThreadBranch
        project={project}
        worktree={worktree}
        checkout={checkout}
        unsent={!chat && scope.kind === "project" && !project.computer}
        disabled={disabled}
        onStartThread={onStartThread}
      />
      {!project.computer && (
        <LinksControl
          links={links}
          empty={!chat}
          onProjectSettings={onProjectSettings}
          onError={onError}
        />
      )}
    </>
  );
}
