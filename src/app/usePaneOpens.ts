import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  matchLink,
  type ProjectFileLink,
} from "../../shared/project-file-links";
import type { QuestionTarget } from "../../shared/questions";
import type { Pull } from "../../shared/types";
import { api } from "../lib/api";
import { threadDraftKey } from "../lib/thread-storage";
import {
  changedTarget,
  fileTarget,
  type FileTarget,
} from "../features/files/file-link-target";
import type { NavigationLock } from "../lib/navigation-lock";
import { requestChannel } from "../lib/request-channel";
import type { TurnDiffTarget } from "../features/changes/turn-diff";
import type { ShellNavigation } from "./useShellNavigation";
import type { ThreadFolder } from "./useThreadFolder";
import {
  NO_VIEWING,
  type ChatContext,
  type ThreadView,
} from "../features/thread/useThreadView";
import type { PaneId } from "../lib/workspace-panes";
import type { PanelTabs, Surface } from "../features/panel/panel-tabs";

export type PaneOpens = ReturnType<typeof usePaneOpens>;

/**
 * What the chat and the title bar ask the panes to show: a pane, a surface
 * in the panel, a file in Files, a change or a turn's diff in Changes; and
 * the code the panes ask the chat about.
 */
export function usePaneOpens(
  {
    project,
    panes,
    pull,
    chatId,
    draftId,
    surface,
  }: Pick<
    ShellNavigation,
    "project" | "panes" | "pull" | "chatId" | "draftId" | "surface"
  >,
  panel: PanelTabs,
  view: ThreadView,
  folder: ThreadFolder,
  lock: NavigationLock,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  // A lookup belongs to the workspace and thread where it was clicked, even
  // when navigation returns there before its response arrives.
  const location = useMemo(
    () => ({}),
    [
      project?.id,
      folder.where,
      chatId,
      draftId,
      surface,
      pull?.server,
      pull?.owner,
      pull?.name,
      pull?.number,
    ],
  );
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Pending requests also belong to this location; a pane mounting after a
  // workspace switch mustn't consume the previous workspace's file.
  const fileOpens = useMemo(() => requestChannel<FileTarget>(), [location]);
  const changeReveals = useMemo(
    () => requestChannel<ProjectFileLink>(),
    [location],
  );
  /** Opens the panel with `surface` in front. */
  function openSurface(surface: Surface) {
    panel.show(surface);
    panes.show("panel");
  }
  function openCode(next: "changes" | "files") {
    if (next === "files" || project?.plain) openSurface("files");
    else panes.show("changes");
  }
  function togglePane(id: PaneId) {
    // A pane hidden behind a zoom reads as closed, so a click brings it back.
    const open = panes.visible.includes(id);
    // Closing the panel would unmount Files and its unsaved edit.
    if (open && id === "panel" && panel.has("files") && lock.blocked()) return;
    panes.setOpen(id, !open);
    if (open && id !== "chat") view.setViewing(NO_VIEWING);
  }
  function openTurnDiff(target: TurnDiffTarget) {
    request.current++;
    view.showTurn(target);
    panes.show("changes");
  }
  /** Shows `target` in Files; false when an unsaved edit holds the view. */
  function openInEditor(target: FileTarget) {
    request.current++;
    if (lock.blocked()) return false;
    fileOpens.send(target);
    openSurface("files");
    return true;
  }
  function revealChange(target: ProjectFileLink) {
    request.current++;
    changeReveals.send(target);
    view.closeTurn();
    panes.show("changes");
  }
  // A file clicked in the chat shows its diff in Changes (Review in a PR
  // thread), or opens in Files when it has none. A name that fits several
  // files lists them in Files. A file outside the project opens in Files too.
  async function openChatFile(target: ProjectFileLink) {
    const sequence = ++request.current;
    const isCurrent = () =>
      mounted.current &&
      currentLocation.current === location &&
      request.current === sequence;
    if (target.outside) return void openInEditor(target);
    if (pull) return revealChange(target);
    const id = folder.where;
    try {
      const changes = project!.plain
        ? []
        : (folder.tree ?? (await api.projectWorkingTree(id))).changes.map(
            (c) => c.path,
          );
      if (!isCurrent()) return;
      const changed = changedTarget(target, changes);
      if (changed) return revealChange(changed);
      if (target.directory) return void openInEditor(target);
      const found = matchLink(
        target,
        await qc.query({
          queryKey: ["project-files", id],
          queryFn: () => api.projectFiles(id),
          staleTime: 5000,
        }),
      );
      if (!isCurrent()) return;
      // Ignored files (an agent's output folder) aren't in Git's list but are on disk.
      const onDisk =
        !found.length &&
        (await api.projectFileInfo(id, target.path).then(
          () => true,
          () => false,
        ));
      if (isCurrent()) openInEditor(fileTarget(target, found, onDisk));
    } catch (e) {
      if (isCurrent()) onError(e);
    }
  }
  /** Hands `context` to the chat's composer, showing the chat. */
  function ask(context: Omit<ChatContext, "id">) {
    view.setContext({ id: crypto.randomUUID(), ...context });
    panes.show("chat");
  }
  return {
    draftKey: threadDraftKey(chatId ?? draftId),
    fileOpens,
    changeReveals,
    openCode,
    openSurface,
    togglePane,
    openTurnDiff,
    openInEditor,
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
