import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChatSummary, Project } from "../../shared/projects";
import type { ThreadWindow } from "../../shared/thread-windows";
import { api } from "../lib/api";
import { onOpenThreadByIds } from "../lib/open-thread";
import { useStableCallback } from "../lib/useStableCallback";
import { projectChatsQuery } from "../lib/workspace-queries";
import { hasOwnWindow } from "../features/thread-windows/thread-windows";
import type { ShellNavigation } from "./useShellNavigation";
import type { useProjects } from "./useProjects";
import { useShellSpot } from "./shell-spot";

/** The thread and its project as they are now, either of them maybe only just added. */
async function lookUpThread(
  qc: QueryClient,
  projects: ReturnType<typeof useProjects>,
  t: ThreadWindow,
) {
  const listed = projects.data?.some((p) => p.id === t.projectId)
    ? projects.data
    : (await projects.refetch()).data;
  const p = listed?.find((p) => p.id === t.projectId);
  if (!p) return;
  const list = await qc.query({ ...projectChatsQuery(p.id), staleTime: 0 });
  const next = list.find((c) => c.id === t.chatId);
  return next && { p, next };
}

/**
 * Opening threads in this window: from the sidebar, by their ids, back from
 * their own window, or after their agent moved them to another project.
 */
export function useThreadOpening(
  nav: ShellNavigation,
  projects: ReturnType<typeof useProjects>,
  setError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const { navigate } = nav;
  const spotNow = useShellSpot(nav);
  /**
   * Opens `c`, or brings its own window up when it has one. Pass `fresh`
   * to show it in this window regardless.
   */
  function open(p: Project, c?: ChatSummary, fresh?: true | string) {
    if (c && !fresh && hasOwnWindow(c.id))
      void api.openThreadWindow(p.id, c.id).catch(setError);
    else navigate(p, c, fresh);
  }
  /** A thread known only by its ids, as Settings and Usage name one. Pass `here` to show it in this window regardless. */
  function openChatById(
    projectId: string,
    chatId: string,
    then?: () => void,
    here = false,
  ) {
    const p = projects.data?.find((p) => p.id === projectId);
    if (!p) return;
    void qc
      .query(projectChatsQuery(projectId))
      .then((list) => {
        const next = list.find((c) => c.id === chatId);
        if (!next) return;
        if (here) navigate(p, next);
        else open(p, next);
        then?.();
      })
      .catch(setError);
  }
  const loaded = !!projects.data;
  // A thread back from its own window shows here, even before its window
  // has finished closing; the one that opened this window waits for it to load.
  useEffect(() => {
    if (!loaded) return;
    const show = (t: ThreadWindow | null) =>
      t && openChatById(t.projectId, t.chatId, undefined, true);
    void api.takeOpenThread().then(show).catch(setError);
    return api.onOpenThread(show);
  }, [loaded]);
  const lookUpFresh = (t: ThreadWindow) => lookUpThread(qc, projects, t);
  // A thread its agent moved to another project goes along while it shows,
  // into a project the agent may have only just added.
  const followMoved = useStableCallback(async (t: ThreadWindow) => {
    const stillShown = () => spotNow().chatId === t.chatId;
    if (!stillShown()) return;
    const found = await lookUpFresh(t);
    if (found && stillShown()) navigate(found.p, found.next);
  });
  useEffect(
    () => api.onThreadMoved((t) => void followMoved(t).catch(setError)),
    [followMoved],
  );
  // One of another computer's threads, followed from here only just now.
  const openFresh = useStableCallback(async (t: ThreadWindow) => {
    const found = await lookUpFresh(t);
    if (found) open(found.p, found.next);
  });
  useEffect(
    () => onOpenThreadByIds((t) => void openFresh(t).catch(setError)),
    [openFresh],
  );
  return { open, openChatById };
}
