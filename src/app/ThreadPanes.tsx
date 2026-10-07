import { useCallback, useState } from "react";
import { GitCompareArrows, GitPullRequest, X } from "lucide-react";
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
import {
  NO_SLOTS,
  PaneHeader,
  paneDrag,
  type PaneSlots,
} from "../ui/WorkspacePanes";
import { PaneTabs } from "../ui/PaneTabs";
import { IconButton } from "../ui/ui";
import type { PanelTabs } from "../features/panel/panel-tabs";
import {
  SURFACE_ICONS,
  SURFACE_LABELS,
  SurfacePicker,
} from "../features/panel/SurfacePicker";
import {
  closeTerminal,
  terminalFor,
} from "../features/terminal/thread-terminals";
import { terminalLabel } from "../features/terminal/TerminalDrawer";
import { TerminalView } from "../features/terminal/TerminalView";

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

/**
 * The third pane: the surfaces the thread opened as tabs, or the picker.
 * Files and History stay mounted behind other tabs, so an unsaved edit and
 * where the history was scrolled survive a look at a terminal.
 */
export function ThreadPanel({
  project,
  chatId,
  folder: { where, detail, checks },
  view,
  opens,
  panel,
}: {
  project: Project;
  chatId: string | null;
  folder: ThreadFolder;
  view: ThreadView;
  opens: PaneOpens;
  panel: PanelTabs;
}) {
  const { locked } = useNavigationLock();
  const [historySlots, setHistorySlots] = useState<PaneSlots>(NO_SLOTS);
  const historyTitle = useCallback(
      (title: HTMLElement | null) => setHistorySlots((s) => ({ ...s, title })),
      [],
    ),
    historyActions = useCallback(
      (actions: HTMLElement | null) =>
        setHistorySlots((s) => ({ ...s, actions })),
      [],
    );
  const front = panel.front;
  let terminals = 0;
  const tabs = panel.tabs.map((tab) => ({
    key: tab.key,
    icon: SURFACE_ICONS[tab.surface],
    label:
      tab.surface === "terminal"
        ? terminalLabel(terminals++)
        : SURFACE_LABELS[tab.surface],
    closeDisabled: tab.surface === "files" && locked,
  }));
  const close = (key: string) => {
    const tab = panel.tabs.find((t) => t.key === key);
    if (tab?.slot) closeTerminal(project.id, chatId, tab.slot);
    panel.close(key);
  };
  const folderShown =
    front?.surface === "files" || front?.surface === "history";
  return (
    <>
      <header className="pane-header panel-header" {...paneDrag("panel")}>
        <PaneTabs
          tabs={tabs}
          front={front?.key ?? null}
          onFront={panel.bring}
          onClose={close}
          add={
            panel.tabs.length
              ? {
                  label: "Open another surface",
                  active: !front,
                  onClick: panel.pick,
                }
              : undefined
          }
        />
        <div
          className="pane-title-slot"
          ref={historyTitle}
          hidden={front?.surface !== "history"}
        />
        {folderShown && detail && (
          <small className="pane-header-detail" title={detail.title}>
            {detail.text}
          </small>
        )}
        <div
          className="pane-header-actions"
          ref={historyActions}
          hidden={front?.surface !== "history"}
        />
        <IconButton
          label="Close panel"
          disabled={locked && panel.has("files")}
          onClick={() => opens.togglePane("panel")}
        >
          <X size={15} />
        </IconButton>
      </header>
      {!front && <SurfacePicker plain={project.plain} onPick={panel.show} />}
      {panel.has("files") && (
        <div className="panel-body" hidden={front?.surface !== "files"}>
          <ProjectFiles
            key={where}
            project={project}
            where={where}
            checks={checks}
            onViewing={view.setViewing}
            opens={opens.fileOpens}
          />
        </div>
      )}
      {panel.has("history") && !project.plain && (
        <div className="panel-body" hidden={front?.surface !== "history"}>
          <ProjectHistory
            key={where}
            projectId={where}
            slots={historySlots}
            onOpenFile={(path) =>
              opens.openInEditor({ path, directory: false })
            }
          />
        </div>
      )}
      {front?.slot !== undefined && (
        <TerminalView
          key={front.key}
          terminal={terminalFor(project.id, chatId, front.slot)}
        />
      )}
    </>
  );
}
