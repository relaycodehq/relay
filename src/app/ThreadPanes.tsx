import { useState } from "react";
import {
  Files,
  GitCompareArrows,
  GitGraph,
  GitPullRequest,
} from "lucide-react";
import type { Project } from "../../shared/projects";
import type { QuestionTarget } from "../../shared/questions";
import type { Account, Pull, PullRef } from "../../shared/types";
import { useNavigationLock } from "../lib/navigation-lock";
import type { PaneOpens } from "./usePaneOpens";
import type { ThreadFolder } from "./useThreadFolder";
import type { ThreadView } from "../features/thread/useThreadView";
import { PullReviewPane } from "../features/review/PullReviewPane";
import { ProjectHistory } from "../features/changes/ProjectHistory";
import { ProjectChanges, ProjectFiles } from "./ProjectViews";
import { NO_SLOTS, PaneHeader, type PaneSlots } from "../ui/WorkspacePanes";

/**
 * The working tree's changes, or in a PR thread the PR's Review, which
 * needs the Git host connected.
 */
export function ThreadChanges({
  project,
  pull,
  folder: { where, detail },
  view,
  opens,
  review,
}: {
  project: Project;
  pull: PullRef | null;
  folder: ThreadFolder;
  view: ThreadView;
  opens: PaneOpens;
  review: {
    /** Who Relay reviews as on the project's host; null until signed in. */
    account: Account | null;
    github: boolean;
    onRecheck: () => void;
    /** Asks the PR's thread about lines of its diff. */
    onDiscuss: (target: QuestionTarget, pr: Pull) => void;
    onConnect: () => void;
  };
}) {
  const [slots, setSlots] = useState<PaneSlots>(NO_SLOTS);
  const editFile = (path: string, line?: number) =>
    opens.openInEditor({ path, line, directory: false });
  const reviewFile = pull
    ? `relay-project-review-file:${project.id}:${pull.number}`
    : "";
  return (
    <>
      <PaneHeader
        id="changes"
        icon={
          pull ? <GitPullRequest size={14} /> : <GitCompareArrows size={14} />
        }
        title={pull ? "Review" : "Changes"}
        detail={pull ? undefined : detail}
        onSlots={setSlots}
        onClose={() => opens.togglePane("changes")}
      />
      {pull ? (
        review.account && project.repository ? (
          <div className="project-review">
            <PullReviewPane
              key={`${project.id}:${pull.number}`}
              pull={pull}
              workspace={where}
              account={review.account}
              initialFile={localStorage.getItem(reviewFile)}
              slots={slots}
              onEditFile={editFile}
              reveals={opens.changeReveals}
              onPresence={(next) => {
                view.setViewing(next);
                if (next.path) localStorage.setItem(reviewFile, next.path);
              }}
              onDiscuss={review.onDiscuss}
            />
          </div>
        ) : (
          <div className="empty pane-empty">
            <GitPullRequest size={28} />
            {review.github ? (
              <>
                <h2>Sign in to GitHub</h2>
                <p>
                  Run <code>gh auth login</code> in a terminal; Relay reviews as
                  that login.
                </p>
                <button onClick={review.onRecheck}>Check again</button>
              </>
            ) : (
              <>
                <h2>No pull request host</h2>
                <p>
                  Relay reviews pull requests on GitHub and Gitea. This folder
                  has no github.com remote; for a Gitea one, connect Gitea.
                </p>
                <button onClick={review.onConnect}>Connect Gitea</button>
              </>
            )}
          </div>
        )
      ) : (
        <ProjectChanges
          key={where}
          where={where}
          slots={slots}
          onViewing={view.setViewing}
          onOpenFile={editFile}
          turn={view.turnDiff}
          onCloseTurn={() => view.closeTurn()}
          reveals={opens.changeReveals}
          onAsk={(code) => opens.ask({ text: "", code })}
        />
      )}
    </>
  );
}

/** The folder the thread works in, browsed and edited. */
export function ThreadFiles({
  project,
  folder: { where, detail, checks },
  view,
  opens,
}: {
  project: Project;
  folder: ThreadFolder;
  view: ThreadView;
  opens: PaneOpens;
}) {
  const { locked } = useNavigationLock();
  return (
    <>
      <PaneHeader
        id="files"
        icon={<Files size={14} />}
        title="Files"
        detail={detail}
        closeDisabled={locked}
        onClose={() => opens.togglePane("files")}
      />
      <ProjectFiles
        key={where}
        project={project}
        where={where}
        checks={checks}
        onViewing={view.setViewing}
        opens={opens.fileOpens}
      />
    </>
  );
}

/** The commit graph of the folder the thread works in. */
export function ThreadHistory({
  folder: { where, detail },
  opens,
}: {
  folder: ThreadFolder;
  opens: PaneOpens;
}) {
  const [slots, setSlots] = useState<PaneSlots>(NO_SLOTS);
  return (
    <>
      <PaneHeader
        id="history"
        icon={<GitGraph size={14} />}
        title="History"
        detail={detail}
        onSlots={setSlots}
        onClose={() => opens.togglePane("history")}
      />
      <ProjectHistory
        key={where}
        projectId={where}
        slots={slots}
        onOpenFile={(path) => opens.openInEditor({ path, directory: false })}
      />
    </>
  );
}
