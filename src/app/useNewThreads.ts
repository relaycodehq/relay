import { useState } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import { api } from "../lib/api";
import { sendDraft } from "../features/composer/draft-send";
import {
  clearDraftScope,
  freshNewThread,
  newThreadId,
  resetDraftScope,
  writeDraft,
} from "../features/composer/drafts";
import type { NavigationLock } from "../lib/navigation-lock";
import { threadDraftKey, threadStorage } from "../lib/thread-storage";
import {
  loadComposerSettings,
  saveComposerSettings,
} from "../features/agents/composer-settings";
import type { AddProjectPage } from "../features/add-project/AddProjectPalette";
import type { PreparedDraft } from "../features/memes/meme-setup";
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
    | "surface"
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
  /** The add-project palette shows, on this page. */
  const [adding, setAdding] = useState<AddProjectPage | false>(false);
  /** The paired computer the palette opens on, when asked for one. */
  const [addingOn, setAddingOn] = useState<string>();
  function addProject(page: AddProjectPage = "root", computerId?: string) {
    if (lock.blocked()) return;
    setPicking(false);
    setAddingOn(computerId);
    setAdding(page);
  }
  /** The palette added a project, or picked one there already: a new thread in it. */
  async function added(p: Project) {
    setAdding(false);
    try {
      await projects.refetch();
    } catch (e) {
      onError(e);
    }
    nav.setInbox(false);
    open(p);
  }
  /**
   * ⌘N and the sidebar's New thread ask for the project unless there's only
   * one; with none yet, the picker offers adding one or Scratchpad.
   */
  function pick() {
    if (lock.blocked()) return;
    // Pressed before the list loads, the picker fills in once it has.
    const real = projects.data?.filter((p) => !p.scratch);
    if (real?.length === 1) open(real[0]);
    else setPicking(true);
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
  /**
   * A Scratchpad thread on a draft written for it, its folders linked and its
   * agent and model picked, left for the user to read and send.
   */
  async function scratchDraft(prepare: () => Promise<PreparedDraft>) {
    if (lock.blocked()) return;
    try {
      const draft = await prepare();
      const p = await api.createScratch();
      await projects.refetch();
      // A slot of its own: the open draft, empty or not, keeps its composer.
      const id = newThreadId(p.id, Date.now().toString(36));
      clearDraftScope(id);
      writeDraft(threadDraftKey(id), draft.text);
      threadStorage(id).links.save(draft.links);
      const settings = loadComposerSettings(id);
      saveComposerSettings(id, {
        ...settings,
        provider: draft.provider,
        models: {
          ...settings.models,
          [draft.provider]: { choice: draft.choice },
        },
        frozen: true,
      });
      if (nav.navigate(p, undefined, id))
        requestAnimationFrame(() => requestAnimationFrame(() => focus()));
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
    resetDraftScope(id);
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
  return {
    picking,
    setPicking,
    adding,
    addingOn,
    setAdding,
    addProject,
    added,
    pick,
    scratch,
    scratchDraft,
    open,
    start,
  };
}
