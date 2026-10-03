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

/** A project's thread about PR `number`; a PR has one per project. */
const threadOf = (chats: ChatSummary[] | undefined, number: number) =>
  chats?.find((c) => c.scope.kind === "pr" && c.scope.ref.number === number);

/** PR threads: found or made, and opened on the chat or beside the PR's Review. */
export function usePullThreads(
  nav: Pick<
    ShellNavigation,
    | "project"
    | "chats"
    | "chat"
    | "draftId"
    | "pull"
    | "panes"
    | "navigate"
    | "openChat"
    | "setChatId"
  >,
  lock: NavigationLock,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const { project, chats, chat, draftId, pull, panes } = nav;
  /**
   * A PR from the Pull requests page opens on its project's thread with the
   * Review beside it; opening it the first time makes that thread.
   */
  async function openInProject(p: Project, ref: PullRef) {
    if (!p.repository || lock.blocked()) return;
    // The project's spelling of its repository, which its threads use.
    const pr = {
      owner: p.repository.owner,
      name: p.repository.name,
      number: ref.number,
    };
    const chatsOf = () =>
      qc.fetchQuery({
        queryKey: ["project-chats", p.id],
        queryFn: () => api.projectChats(p.id),
        staleTime: 0,
      });
    try {
      let thread = threadOf(await chatsOf(), pr.number);
      if (!thread) {
        thread = await api.createProjectChat(p.id, { kind: "pr", ref: pr });
        await chatsOf();
      }
      nav.navigate(p, thread);
      panes.show("changes");
    } catch (e) {
      onError(e);
    }
  }
  async function newChat(scope: ChatScope) {
    if (!project) return;
    try {
      const next = await api.createProjectChat(project.id, scope);
      await chats.refetch();
      nav.openChat(next.id);
      panes.show("chat");
      return next;
    } catch (e) {
      onError(e);
    }
  }
  /** The open project's thread about `ref`, on the chat. */
  async function open(ref: PullRef) {
    const existing = threadOf(chats.data, ref.number);
    if (existing) nav.openChat(existing.id);
    else await newChat({ kind: "pr", ref });
    panes.show("chat");
  }
  /**
   * Reviewing a PR from the new thread makes it that PR's thread, taking the
   * unsent message and composer settings along, so a review started without
   * messages has a thread to come back to.
   */
  const startingReview = useRef(false);
  async function startReviewThread(ref: PullRef) {
    if (!project || startingReview.current) return;
    const existing = threadOf(chats.data, ref.number);
    if (existing) return nav.setChatId(existing.id);
    startingReview.current = true;
    const from = draftId;
    try {
      const next = await api.createProjectChat(project.id, {
        kind: "pr",
        ref,
      });
      saveComposerSettings(next.id, loadComposerSettings(from));
      if (readDraft(threadDraftKey(from)))
        moveDraft(threadDraftKey(from), threadDraftKey(next.id));
      await chats.refetch();
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
  return {
    open,
    /** The open project's thread about `ref`, beside its Review. */
    async review(ref: PullRef) {
      if (!project || lock.blocked()) return;
      await open(ref);
      panes.show("changes");
    },
    openInProject,
  };
}
