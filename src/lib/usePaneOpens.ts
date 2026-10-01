import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  matchLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import type { QuestionTarget } from "../../shared/questions";
import type { Pull } from "../../shared/types";
import { api } from "./api";
import { changedTarget, fileTarget, type FileTarget } from "./file-link-target";
import type { NavigationLock } from "./navigation-lock";
import { requestChannel } from "./request-channel";
import type { TurnDiffTarget } from "./turn-diff";
import type { ShellNavigation } from "./useShellNavigation";
import type { ThreadFolder } from "./useThreadFolder";
import { NO_VIEWING, type ChatContext, type ThreadView } from "./useThreadView";
import type { PaneId } from "./workspace-panes";

export type PaneOpens = ReturnType<typeof usePaneOpens>;

/**
 * What the chat and the title bar ask the panes to show: a pane, a file in
 * Files, a change or a turn's diff in Changes; and the code the panes ask
 * the chat about.
 */
export function usePaneOpens(
  { project, panes, pull }: Pick<ShellNavigation, "project" | "panes" | "pull">,
  view: ThreadView,
  folder: ThreadFolder,
  lock: NavigationLock,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  // Files the chat asks the Files and Changes panes to show. One per project,
  // so a file asked for in one never opens in the next.
  const fileOpens = useMemo(() => requestChannel<FileTarget>(), [project?.id]);
  const changeReveals = useMemo(
    () => requestChannel<ProjectFileLink>(),
    [project?.id],
  );
  function openCode(next: "changes" | "files") {
    panes.show(next === "files" || project?.plain ? "files" : "changes");
  }
  function togglePane(id: PaneId) {
    const open = panes.layout.open[id];
    if (open && id === "files" && lock.blocked()) return;
    panes.setOpen(id, !open);
    if (open && id !== "chat") view.setViewing(NO_VIEWING);
  }
  function openTurnDiff(target: TurnDiffTarget) {
    view.showTurn(target);
    panes.show("changes");
  }
  function openInEditor(target: FileTarget) {
    if (lock.blocked()) return;
    fileOpens.send(target);
    panes.show("files");
  }
  function revealChange(target: ProjectFileLink) {
    changeReveals.send(target);
    view.closeTurn();
    panes.show("changes");
  }
  // A file clicked in the chat shows its diff in Changes (Review in a PR
  // thread), or opens in Files when it has none. A name that fits several
  // files lists them in Files.
  async function openChatFile(target: ProjectFileLink) {
    if (pull) return revealChange(target);
    const id = folder.where;
    try {
      const changes = project!.plain
        ? []
        : (folder.tree ?? (await api.projectWorkingTree(id))).changes.map(
            (c) => c.path,
          );
      const changed = changedTarget(target, changes);
      if (changed) return revealChange(changed);
      if (target.directory) return openInEditor(target);
      const found = matchLink(
        target,
        await qc.fetchQuery({
          queryKey: ["project-files", id],
          queryFn: () => api.projectFiles(id),
          staleTime: 5000,
        }),
      );
      // Ignored files (an agent's output folder) aren't in Git's list but are on disk.
      const onDisk =
        !found.length &&
        (await api.projectFileInfo(id, target.path).then(
          () => true,
          () => false,
        ));
      openInEditor(fileTarget(target, found, onDisk));
    } catch (e) {
      onError(e);
    }
  }
  /** Hands `context` to the chat's composer, showing the chat. */
  function ask(context: Omit<ChatContext, "id">) {
    view.setContext({ id: crypto.randomUUID(), ...context });
    panes.show("chat");
  }
  return {
    fileOpens,
    changeReveals,
    openCode,
    togglePane,
    openTurnDiff,
    openInEditor,
    revealChange,
    openChatFile,
    ask,
    /** Asks the chat about lines of `pr`'s diff. */
    askAbout(target: QuestionTarget, pr: Pull) {
      ask({
        text: `About ${target.path}:${target.start}${target.end !== target.start ? `–${target.end}` : ""} (${target.side === "deletions" ? "before PR" : "PR head"})\n\n`,
        selection: {
          ...target,
          head: pr.head.sha,
          base: pr.merge_base,
          question: "Explain this code.",
        },
      });
    },
  };
}
