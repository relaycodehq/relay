import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectFileLink } from "../../shared/project-file-links";
import type { QuestionTarget } from "../../shared/questions";
import type { Pull } from "../../shared/types";
import { api } from "../lib/api";
import { threadDraftKey } from "../lib/thread-storage";
import type { FilesRequest } from "../features/files/file-link-target";
import { changeOpeners } from "./change-openers";
import { chatFileOpener } from "./chat-file-opener";
import type { NavigationLock } from "../lib/navigation-lock";
import { requestChannel } from "../lib/request-channel";
import {
  isEditorElsewhere,
  openInEditorWindow,
} from "../features/editor-windows/editor-windows";
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
 * in the panel, a file in Files, with its changes since the last commit, a
 * turn, the worktree's source branch or a commit's parent; in a PR thread,
 * a file of the PR in Review; and the code the panes ask the chat about.
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
  const fileOpens = useMemo(() => requestChannel<FilesRequest>(), [location]);
  const changeReveals = useMemo(
    () => requestChannel<ProjectFileLink>(),
    [location],
  );
  /** Opens the panel with `surface` in front. */
  function openSurface(surface: Surface) {
    panel.show(surface);
    panes.show("panel");
  }
  /** Files, with the folder's changes in its sidebar for "changes"; a PR thread's changes are its Review. */
  function openCode(next: "changes" | "files") {
    if (next === "changes" && pull) return panes.show("changes");
    if (editorElsewhere()) return raiseEditor();
    openSurface("files");
    if (next === "changes" && !project?.plain)
      fileOpens.send({ view: "changes" });
  }
  function togglePane(id: PaneId) {
    // A pane hidden behind a zoom reads as closed, so a click brings it back.
    const open = panes.visible.includes(id);
    // Closing the panel would unmount Files and its unsaved edit.
    if (open && id === "panel" && panel.has("files") && lock.blocked()) return;
    panes.setOpen(id, !open);
    if (open && id !== "chat") view.setViewing(NO_VIEWING);
  }
  /** A newer request, or leaving this workspace, makes an answer that arrives late go unused. */
  function startRequest() {
    const sequence = ++request.current;
    return () =>
      mounted.current &&
      currentLocation.current === location &&
      request.current === sequence;
  }
  /** The editor is in a window of its own, which comes forward in place of the Files pane. */
  const editorElsewhere = () => isEditorElsewhere(folder.where);
  function raiseEditor() {
    if (project)
      void api.openEditorWindow(project.id, folder.where).catch(onError);
  }
  /**
   * Shows `target` in Files, or in the editor's own window, which takes a
   * version as the file on disk; false when an unsaved edit holds the view.
   */
  function openInEditor(target: FilesRequest) {
    request.current++;
    if (editorElsewhere()) {
      if ("view" in target) raiseEditor();
      else {
        const file =
          "snapshot" in target
            ? { path: target.path, directory: false, snapshot: target.snapshot }
            : target;
        void openInEditorWindow(folder.where, file).catch(onError);
      }
      return true;
    }
    if (lock.blocked()) return false;
    fileOpens.send(target);
    openSurface("files");
    return true;
  }
  /** A PR thread's file, in its Review. */
  function revealInReview(target: ProjectFileLink) {
    request.current++;
    changeReveals.send(target);
    panes.show("changes");
  }
  const changes = changeOpeners({
    where: folder.where,
    openInEditor,
    startRequest,
    onError,
  });
  const openChatFile = chatFileOpener({
    project,
    where: folder.where,
    tree: folder.tree,
    inReview: !!pull,
    qc,
    openInEditor,
    revealInReview,
    startRequest,
    onError,
  });
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
    ...changes,
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
