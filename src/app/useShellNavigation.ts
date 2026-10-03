import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ChatScope,
  ChatSummary,
  ChatWorkspace,
  Project,
} from "../../shared/projects";
import { api } from "../lib/api";
import {
  clearDraftScope,
  currentNewThread,
  freshNewThread,
  loadDraftScope,
  saveDraftScope,
  setCurrentNewThread,
} from "../features/composer/drafts";
import type { NavigationLock } from "../lib/navigation-lock";
import { openThread } from "../lib/thread-storage";
import type { ThreadView } from "../features/thread/useThreadView";
import { useWorkspacePanes } from "../lib/workspace-panes";

export type ShellNavigation = ReturnType<typeof useShellNavigation>;

/**
 * Where the shell is: a project and its open thread, or the project's unsent
 * one while none is, or the Pull requests page. A thread brings back the
 * panes it had open, and each project the thread it showed last.
 */
export function useShellNavigation(
  projects: Project[] | undefined,
  lock: NavigationLock,
  view: ThreadView,
) {
  const [selected, setSelected] = useState(() =>
      localStorage.getItem("relay-project-id"),
    ),
    [chatId, setChatId] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<ChatScope>({
    kind: "project",
  });
  /** Where the unsent thread will work, as its picker changes. */
  const [draftWorkspace, setDraftWorkspace] =
    useState<ChatWorkspace>("checkout");
  /** The Pull requests page shows instead of a project. */
  const [inbox, setInbox] = useState(
    () => localStorage.getItem("relay-surface") === "inbox",
  );
  const project =
    projects?.find((p) => p.id === selected) ??
    projects?.find((p) => !p.scratch) ??
    projects?.[0];
  // Which of the project's unsent threads shows while no thread is open.
  const draftId = project ? currentNewThread(project.id) : "";
  const panes = useWorkspacePanes(chatId ?? draftId);
  const [restoredProject, setRestoredProject] = useState<string>();
  const chats = useQuery({
    queryKey: ["project-chats", project?.id],
    queryFn: () => api.projectChats(project!.id),
    enabled: !!project,
  });
  const chat = chats.data?.find((c) => c.id === chatId);
  // A PR thread reviews its PR; any other thread shows the working tree.
  const scope = chat?.scope ?? draftScope;
  const pull = scope.kind === "pr" ? scope.ref : null;
  useEffect(() => {
    if (project) {
      localStorage.setItem("relay-project-id", project.id);
      const saved = openThread.load(project.id);
      setChatId(saved || null);
      setDraftScope(loadDraftScope(currentNewThread(project.id)));
      panes.switchTo(saved || currentNewThread(project.id));
      view.closeTurn();
      setRestoredProject(project.id);
    }
  }, [project?.id]);
  useEffect(() => {
    if (project && project.id === restoredProject)
      saveDraftScope(draftId, draftScope);
  }, [draftScope, draftId, restoredProject]);
  useEffect(() => {
    localStorage.setItem("relay-surface", inbox ? "inbox" : "project");
  }, [inbox]);
  useEffect(() => {
    if (project && project.id === restoredProject)
      openThread.save(project.id, chatId);
  }, [project?.id, chatId, restoredProject]);
  /**
   * Opens `next`, or with `fresh` one of the project's unsent threads: a new
   * one on the repository, or with a draft's id that draft, in the scope it
   * was written for.
   */
  function navigate(
    p: Project,
    next?: ChatSummary,
    fresh: boolean | string = false,
  ) {
    if (lock.blocked()) return false;
    if (fresh || next) openThread.save(p.id, next?.id ?? null);
    if (fresh) {
      const id = fresh === true ? freshNewThread(p.id) : fresh;
      // Switching projects restores the saved scope, so a fresh thread drops it.
      if (fresh === true) clearDraftScope(id);
      setCurrentNewThread(p.id, id);
      setDraftScope(loadDraftScope(id));
      if (!next) panes.switchTo(id, fresh === true);
    }
    setSelected(p.id);
    if (next || fresh) setChatId(next?.id ?? null);
    if (next) panes.switchTo(next.id);
    setInbox(false);
    view.clear();
    return true;
  }
  /** Opens a thread with the panes it had open when it was last on screen. */
  function openChat(id: string) {
    // The turn and file the last thread showed don't carry over to another.
    if (id !== chatId) view.clear();
    setChatId(id);
    panes.switchTo(id);
  }
  /** A thread keeps the scope it started with; another one takes a new thread. */
  function newThreadIn(next: ChatScope) {
    if (lock.blocked()) return;
    // From a thread it starts afresh, not in a draft written for something else.
    if (chat && project)
      setCurrentNewThread(project.id, freshNewThread(project.id));
    setChatId(null);
    setDraftScope(next);
  }
  return {
    /** The project last chosen, which `project` falls back from while it's gone. */
    selected,
    setSelected,
    project,
    chats,
    chatId,
    setChatId,
    chat,
    draftId,
    draftScope,
    draftWorkspace,
    setDraftWorkspace,
    scope,
    pull,
    inbox,
    setInbox,
    panes,
    navigate,
    openChat,
    newThreadIn,
  };
}
