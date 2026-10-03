import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ChatSummary,
  ChatTriage,
  Project,
} from "../../../shared/projects";
import { nextAfterSettle, triaged } from "./activity";
import { api } from "../../lib/api";
import { errorMessage } from "./error-message";
import { forkThreadSettings } from "../agents/composer-settings";

export type ThreadMenuAction =
  | { kind: "new" }
  | { kind: "fork" }
  | { kind: "settle" }
  | { kind: "rename" }
  | { kind: "regenerate" }
  | { kind: "project-settings" }
  | { kind: "triage"; triage: ChatTriage };

export type ThreadActions = ReturnType<typeof useThreadActions>;

/**
 * What the sidebar does to a thread: opening, triage, naming and forking it.
 * Each change shows at once in every list holding the thread; a failure
 * goes to `setError`.
 */
export function useThreadActions({
  chatId,
  active,
  projects,
  scratch,
  open,
  onNew,
  onProjectSettings,
  setError,
}: {
  /** The open thread. */
  chatId: string | undefined;
  /** Activity's open threads, in order. */
  active: ChatSummary[];
  projects: Map<string, Project>;
  /** Scratchpad's projects, whose threads share one list. */
  scratch: Set<string>;
  open: (c: ChatSummary) => void;
  /** Opens a new thread in `p`. */
  onNew: (p: Project) => void;
  onProjectSettings: (projectId: string) => void;
  setError: (message: string | undefined) => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState<string>();
  /** Threads whose title is being generated again. */
  const [regenerating, setRegenerating] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const failed = (e: unknown) => setError(errorMessage(e));
  /** Every list holding it: its project's, and Scratchpad's for a scratch chat. */
  const patch = (c: ChatSummary, change: (c: ChatSummary) => ChatSummary) =>
    qc.setQueriesData<ChatSummary[]>({ queryKey: ["project-chats"] }, (list) =>
      list?.map((entry) => (entry.id === c.id ? change(entry) : entry)),
    );
  const refresh = (c: ChatSummary) =>
    qc.invalidateQueries({
      queryKey: scratch.has(c.projectId)
        ? ["project-chats"]
        : ["project-chats", c.projectId],
    });
  const triage = async (c: ChatSummary, action: ChatTriage) => {
    patch(c, (entry) => triaged(entry, action, Date.now()));
    try {
      await api.triageProjectChat(c.id, action);
    } catch (e) {
      failed(e);
    } finally {
      refresh(c);
    }
  };
  /** Settling the open thread moves on to its neighbour in activity, or a new thread. */
  const settle = (c: ChatSummary) => {
    if (c.id === chatId) {
      const next = nextAfterSettle(active, c.id);
      const p = projects.get(c.projectId);
      if (next) open(next);
      else if (p) onNew(p);
    }
    void triage(c, { kind: "settle" });
  };
  const rename = async (c: ChatSummary, title: string) => {
    patch(c, (entry) => ({ ...entry, title, renamed: true }));
    try {
      await api.renameProjectChat(c.id, title);
    } catch (e) {
      failed(e);
    } finally {
      void refresh(c);
    }
  };
  const regenerate = async (c: ChatSummary) => {
    setRegenerating((ids) => new Set(ids).add(c.id));
    setError(undefined);
    try {
      const named = await api.regenerateProjectChatTitle(c.id);
      patch(c, (entry) => ({
        ...entry,
        title: named.title,
        renamed: undefined,
      }));
    } catch (e) {
      failed(e);
    } finally {
      setRegenerating((ids) => {
        const next = new Set(ids);
        next.delete(c.id);
        return next;
      });
      void refresh(c);
    }
  };
  /** Forks from the latest answer and opens the fork on that answer's agent. */
  const fork = async (c: ChatSummary) => {
    setError(undefined);
    try {
      const forked = await api.forkProjectChat(c.id);
      forkThreadSettings(c.id, forked.id, forked.provider);
      await refresh(c);
      open(forked);
    } catch (e) {
      failed(e);
    }
  };
  return {
    open,
    triage,
    settle,
    /** The thread whose name is being typed. */
    renaming,
    setRenaming,
    rename,
    regenerating,
    /** Does what the thread's right-click menu picked. */
    act(c: ChatSummary, action: ThreadMenuAction) {
      const p = projects.get(c.projectId);
      switch (action.kind) {
        case "new":
          if (p) onNew(p);
          return;
        case "fork":
          return void fork(c);
        case "settle":
          return settle(c);
        case "rename":
          return setRenaming(c.id);
        case "regenerate":
          return void regenerate(c);
        case "project-settings":
          return onProjectSettings(c.projectId);
        case "triage":
          return void triage(c, action.triage);
      }
    },
  };
}
