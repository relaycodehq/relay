import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatScope, ChatSummary, Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import { api } from "../lib/api";
import {
  loadComposerSettings,
  saveComposerSettings,
} from "../features/agents/composer-settings";
import { moveDraft, readDraft } from "../features/composer/drafts";
import type { NavigationLock } from "../lib/navigation-lock";
import { threadDraftKey } from "../lib/thread-storage";
import type { ShellNavigation } from "./useShellNavigation";
import { projectChatsQuery } from "../lib/workspace-queries";
import { sameSpot, useShellSpot } from "./shell-spot";

/** A project's thread about PR `number`; a PR has one per project. */
const threadOf = (chats: ChatSummary[] | undefined, number: number) =>
  chats?.find((c) => c.scope.kind === "pr" && c.scope.ref.number === number);

type PullNavigation = Pick<
  ShellNavigation,
  | "project"
  | "chats"
  | "chat"
  | "chatId"
  | "draftId"
  | "surface"
  | "pull"
  | "panes"
  | "navigate"
  | "openChat"
  | "setChatId"
>;

/** PR threads: found or made, and opened on the chat or beside the PR's Review. */
export function usePullThreads(
  nav: PullNavigation,
  lock: NavigationLock,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const { project, chats, panes } = nav;
  const spotNow = useShellSpot(nav);
  /**
   * A PR from the Pull requests page opens on its project's thread with the
   * Review beside it; opening it the first time makes that thread. Not once
   * the user went elsewhere meanwhile.
   */
  async function openInProject(p: Project, ref: PullRef) {
    if (!p.repository || lock.blocked()) return;
    const from = spotNow();
    // The project's spelling of its repository, which its threads use.
    const pr = {
      owner: p.repository.owner,
      name: p.repository.name,
      number: ref.number,
    };
    const chatsOf = () =>
      qc.query({ ...projectChatsQuery(p.id), staleTime: 0 });
    try {
      let thread = threadOf(await chatsOf(), pr.number);
      if (!thread) {
        thread = await api.createProjectChat(p.id, { kind: "pr", ref: pr });
        await chatsOf();
      }
      if (!sameSpot(spotNow(), from)) return;
      nav.navigate(p, thread);
      panes.show("changes");
    } catch (e) {
      onError(e);
    }
  }

  /** Makes a thread in the open project and opens it, unless the user went elsewhere meanwhile. */
  async function newChat(scope: ChatScope) {
    if (!project) return false;
    const from = spotNow();
    try {
      const next = await api.createProjectChat(project.id, scope);
      await qc.refetchQueries({ queryKey: ["project-chats", project.id] });
      if (!sameSpot(spotNow(), from)) return false;
      nav.openChat(next.id);
      return true;
    } catch (e) {
      onError(e);
      return false;
    }
  }

  /** The open project's thread about `ref`, on the chat; whether it opened. */
  async function open(ref: PullRef) {
    const existing = threadOf(chats.data, ref.number);
    if (existing) nav.openChat(existing.id);
    else if (!(await newChat({ kind: "pr", ref }))) return false;
    panes.show("chat");
    return true;
  }

  useReviewThreadStart(nav, lock, onError);
  return {
    open,
    /** The open project's thread about `ref`, beside its Review. */
    async review(ref: PullRef) {
      if (!project || lock.blocked()) return;
      if (await open(ref)) panes.show("changes");
    },
    openInProject,
  };
}

/**
 * Reviewing a PR from the new thread makes it that PR's thread, taking the
 * unsent message and composer settings along, so a review started without
 * messages has a thread to come back to. It opens, and takes them, only if
 * the user is still on that new thread.
 */
function useReviewThreadStart(
  nav: PullNavigation,
  lock: NavigationLock,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const { project, chats, chat, draftId, pull, panes } = nav;
  const spotNow = useShellSpot(nav);
  const startingReview = useRef(false);
  async function startReviewThread(ref: PullRef) {
    if (!project || startingReview.current) return;
    const existing = threadOf(chats.data, ref.number);
    if (existing) return nav.setChatId(existing.id);
    startingReview.current = true;
    const from = spotNow();
    try {
      const next = await api.createProjectChat(project.id, {
        kind: "pr",
        ref,
      });
      await qc.refetchQueries({ queryKey: ["project-chats", project.id] });
      // Gone elsewhere meanwhile: the new thread's draft stays where it was written.
      if (!sameSpot(spotNow(), from)) return;
      saveComposerSettings(next.id, loadComposerSettings(draftId));
      if (readDraft(threadDraftKey(draftId)))
        moveDraft(threadDraftKey(draftId), threadDraftKey(next.id));
      nav.setChatId(next.id);
    } catch (e) {
      onError(e);
    } finally {
      startingReview.current = false;
    }
  }

  const reviewOpen = panes.layout.open.changes;
  useEffect(() => {
    if (reviewOpen && pull && !chat && chats.data && !lock.locked)
      void startReviewThread(pull);
  }, [reviewOpen, pull?.number, chat?.id, !!chats.data]);
}
