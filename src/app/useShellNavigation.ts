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
import type { ThreadWindow } from "../../shared/thread-windows";

/** What the main pane shows: a project, the Pull requests page or Usage. */
export type Surface = "project" | "inbox" | "usage";

export type ShellNavigation = ReturnType<typeof useShellNavigation>;

/**
 * Where the shell is: a project and its open thread, or the project's unsent
 * one while none is, or the Pull requests page. A thread brings back the
 * panes it had open, and each project the thread it showed last.
 *
 * A thread's own window is `pinned` to it: it never leaves that thread nor
 * saves where it is, and anywhere else it's asked to go opens in the main
 * window.
 */
export function useShellNavigation(
  projects: Project[] | undefined,
  lock: NavigationLock,
  view: ThreadView,
  pinned?: ThreadWindow,
) {
  const [selected, setSelected] = useState(
      () => pinned?.projectId ?? localStorage.getItem("relay-project-id"),
    ),
    [chatId, setOpenChat] = useState<string | null>(pinned?.chatId ?? null);
  /** Somewhere a pinned window doesn't go: the main window shows it instead. */
  const elsewhere = (projectId: string, id?: string | null) => {
    if (id === pinned?.chatId) return;
    void api.openInMainWindow(projectId, id ?? undefined).catch(() => {});
  };
  const setChatId = (id: string | null) => {
    if (pinned) elsewhere(pinned.projectId, id);
    else setOpenChat(id);
  };
  const [draftScope, setDraftScope] = useState<ChatScope>({
    kind: "project",
  });
  /** Where the unsent thread will work, as its picker changes. */
  const [draftWorkspace, setDraftWorkspace] =
    useState<ChatWorkspace>("checkout");
  /** A page shown instead of a project: Pull requests or Usage. */
  const [surface, setSurface] = useState<Surface>(() => {
    if (pinned) return "project";
    const saved = localStorage.getItem("relay-surface");
    return saved === "inbox" || saved === "usage" ? saved : "project";
  });
  const inbox = surface === "inbox";
  const setInbox = (on: boolean) => setSurface(on ? "inbox" : "project");
  const project = pinned
    ? projects?.find((p) => p.id === pinned.projectId)
    : (projects?.find((p) => p.id === selected) ??
      projects?.find((p) => !p.scratch) ??
      projects?.[0]);
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
    if (pinned) panes.switchTo(pinned.chatId);
    else if (project) {
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
    if (!pinned) localStorage.setItem("relay-surface", surface);
  }, [surface]);
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
    if (pinned) {
      elsewhere(p.id, fresh ? null : next?.id);
      return false;
    }
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
    if (pinned) return elsewhere(pinned.projectId, id);
    // The turn and file the last thread showed don't carry over to another.
    if (id !== chatId) view.clear();
    setChatId(id);
    panes.switchTo(id);
  }
  /** A thread keeps the scope it started with; another one takes a new thread. */
  function newThreadIn(next: ChatScope) {
    if (lock.blocked() || pinned) return;
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
    surface,
    setSurface,
    /** The Pull requests page shows. */
    inbox,
    /** Shows the Pull requests page, or with false the project. */
    setInbox,
    panes,
    navigate,
    openChat,
    newThreadIn,
  };
}
