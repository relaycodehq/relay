import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ChatSummary,
  ChatTriage,
  ChatTriageState,
  Project,
} from "../../../shared/projects";
import { triageState } from "../../../shared/chat-activity";
import { nextAfterSettle, triaged } from "./activity";
import { api } from "../../lib/api";
import { undos } from "../../lib/undo";
import { errorMessage } from "../../lib/error-message";
import { forkThreadSettings } from "../agents/composer-settings";

export type ThreadMenuAction =
  | { kind: "new" }
  | { kind: "fork" }
  | { kind: "settle" }
  | { kind: "rename" }
  | { kind: "regenerate" }
  | { kind: "reload" }
  | { kind: "detach" }
  | { kind: "project-settings" }
  | { kind: "triage"; triage: ChatTriage };

export type ThreadActions = ReturnType<typeof useThreadActions>;

/** Settling, archiving and snoozing are what ⌘Z can take back. */
const UNDOABLE = new Set<ChatTriage["kind"]>(["settle", "archive", "snooze"]);

/**
 * What the sidebar does to a thread: opening, triage, naming, forking it and
 * reloading its agent. Each change shows at once in every list holding the
 * thread; a failure goes to `setError`.
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
  /** Where the shell is by the time an undo runs. */
  const latest = useRef({ chatId, open });
  latest.current = { chatId, open };
  /**
   * Puts back the marks a thread had `before` the action that is `done`,
   * then `back` to it if the action had moved away.
   */
  const restore = async (
    c: ChatSummary,
    before: ChatTriageState,
    done: Promise<ChatSummary>,
    back?: () => void,
  ) => {
    const action: ChatTriage = {
      kind: "restore",
      from: triageState(await done),
      to: before,
    };
    patch(c, (entry) => triaged(entry, action, Date.now()));
    try {
      await api.triageProjectChat(c.id, action);
    } finally {
      refresh(c);
    }
    back?.();
  };
  const apply = async (
    c: ChatSummary,
    action: ChatTriage,
    back?: () => void,
  ) => {
    // Mark unread and auto-settle leave where the thread is alone, and with it any undo.
    const moves = action.kind !== "unread" && action.kind !== "auto-settle";
    const token = moves ? undos.claim([c.id]) : undefined;
    const before = triageState(c);
    patch(c, (entry) => triaged(entry, action, Date.now()));
    const done = api.triageProjectChat(c.id, action);
    if (token !== undefined && UNDOABLE.has(action.kind))
      undos.offer(token, [c.id], () => restore(c, before, done, back));
    try {
      await done;
    } catch (e) {
      if (token !== undefined) undos.drop(token);
      failed(e);
    } finally {
      refresh(c);
    }
  };
  const triage = (c: ChatSummary, action: ChatTriage) => apply(c, action);
  /**
   * Settling the open thread moves on to its neighbour in activity, or a new
   * thread; undoing it comes back unless you went elsewhere meanwhile.
   */
  const settle = (c: ChatSummary) => {
    let back: (() => void) | undefined;
    if (c.id === chatId) {
      const next = nextAfterSettle(active, c.id);
      const p = projects.get(c.projectId);
      if (next) open(next);
      else if (p) onNew(p);
      if (next || p)
        back = () => {
          if (latest.current.chatId === next?.id) latest.current.open(c);
        };
    }
    void apply(c, { kind: "settle" }, back);
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
  /** Threads whose agent is restarting on its conversation. */
  const [reloading, setReloading] = useState<ReadonlySet<string>>(new Set());
  const reload = async (c: ChatSummary) => {
    setReloading((ids) => new Set(ids).add(c.id));
    setError(undefined);
    try {
      await api.reloadProjectChatSession(c.id);
      void qc.invalidateQueries({ queryKey: ["provider-commands"] });
    } catch (e) {
      failed(e);
    } finally {
      setReloading((ids) => {
        const next = new Set(ids);
        next.delete(c.id);
        return next;
      });
    }
  };
  /** Takes a started thread out from under its lead, for good. */
  const detach = async (c: ChatSummary) => {
    setError(undefined);
    patch(c, (entry) => ({ ...entry, startedBy: undefined }));
    try {
      await api.detachProjectChat(c.id);
    } catch (e) {
      failed(e);
    } finally {
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
    reloading,
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
        case "reload":
          return void reload(c);
        case "detach":
          return void detach(c);
        case "project-settings":
          return onProjectSettings(c.projectId);
        case "triage":
          return void triage(c, action.triage);
      }
    },
  };
}
