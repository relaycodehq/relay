import { useState } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import { api } from "../lib/api";
import { sendDraft } from "../features/composer/draft-send";
import {
  clearDraftScope,
  freshNewThread,
  writeDraft,
} from "../features/composer/drafts";
import type { NavigationLock } from "../lib/navigation-lock";
import { threadDraftKey } from "../lib/thread-storage";
import { sameSpot, useShellSpot } from "./shell-spot";
import type { ShellNavigation } from "./useShellNavigation";

/**
 * Starting threads from anywhere: ⌘N and its project picker, Scratchpad
 * chats, a thread on given text, and a project added to start in.
 */
export function useNewThreads(
  nav: Pick<
    ShellNavigation,
    | "project"
    | "chatId"
    | "draftId"
    | "inbox"
    | "setSelected"
    | "setInbox"
    | "navigate"
  >,
  projects: UseQueryResult<Project[]>,
  lock: NavigationLock,
  /** Focuses the open thread's composer. */
  focus: () => void,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const { project } = nav;
  const spotNow = useShellSpot(nav);
  /** ⌘N's picker shows. */
  const [picking, setPicking] = useState(false);
  async function addProject() {
    if (lock.blocked()) return;
    try {
      const p = await api.addProject();
      if (p) {
        await projects.refetch();
        nav.setSelected(p.id);
        nav.setInbox(false);
      }
    } catch (e) {
      onError(e);
    }
  }
  /** ⌘N and the sidebar's New thread ask for the project unless there's only one. */
  function pick() {
    if (lock.blocked()) return;
    const real = projects.data?.filter((p) => !p.scratch) ?? [];
    if (real.length === 1) open(real[0]);
    else if (real.length) setPicking(true);
    else void scratch();
  }
  /** ⌘⇧N: a chat about anything, in a folder of its own. */
  async function scratch() {
    if (lock.blocked()) return;
    try {
      const p = await api.createScratch();
      await projects.refetch();
      open(p);
    } catch (e) {
      onError(e);
    }
  }
  function open(p: Project) {
    if (!nav.navigate(p, undefined, true)) return;
    // After the new thread's composer mounts and a closing picker hands focus back.
    requestAnimationFrame(() => requestAnimationFrame(() => focus()));
  }
  /**
   * A new thread in the project folder on `text`: sent on the agent new
   * threads start with, or left as a draft to change first.
   */
  async function start(text: string, send: boolean) {
    if (!project || lock.blocked()) return;
    const from = spotNow();
    const id = freshNewThread(project.id);
    clearDraftScope(id);
    writeDraft(threadDraftKey(id), text);
    try {
      const sent =
        send &&
        (await sendDraft(qc, {
          key: threadDraftKey(id),
          id,
          project,
          reply: false,
        }));
      if (sent) {
        await qc.refetchQueries({ queryKey: ["project-chats", project.id] });
        // A send that takes a while must not pull the user off what they moved to.
        if (sameSpot(spotNow(), from)) nav.navigate(project, sent);
        return;
      }
    } catch (e) {
      onError(e);
    }
    if (sameSpot(spotNow(), from)) nav.navigate(project, undefined, id);
  }
  return { picking, setPicking, addProject, pick, scratch, open, start };
}
