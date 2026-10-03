import { useCallback, useSyncExternalStore } from "react";
import type {
  ChatScope,
  ChatWorkspace,
  ChatSummary,
  Project,
} from "../../../shared/projects";
import {
  composerSettingsKey,
  currentNewThreadKey,
  draftKeysWithText,
  moveDraftBody,
  readDraftText,
  removeThreadDraft,
  threadDraftKey,
  threadStorage,
  writeDraftText,
} from "../../lib/thread-storage";
import { DRAFT_PREFIX } from "../../lib/thread-draft";

// Chat drafts live outside React state so a keystroke re-renders only the
// composer that shows the draft, not the whole conversation around it.
const listeners = new Map<string, Set<() => void>>();
// Told when a draft gains its first text or loses its last, not per keystroke.
const indexListeners = new Set<() => void>();
let index: string[] | undefined;

export const readDraft = readDraftText;

function changed(key: string, hadText: boolean, hasNow: boolean) {
  listeners.get(key)?.forEach((notify) => notify());
  if (hadText !== hasNow) {
    index = undefined;
    indexListeners.forEach((notify) => notify());
  }
}

export function writeDraft(key: string, value: string) {
  const had = !!readDraft(key).trim();
  writeDraftText(key, value);
  changed(key, had, !!value.trim());
}

/** Moves a composer's text and pills to another's, as when a draft follows its thread. */
export function moveDraft(from: string, to: string) {
  const hadFrom = !!readDraft(from).trim(),
    hadTo = !!readDraft(to).trim();
  moveDraftBody(from, to);
  changed(from, hadFrom, !!readDraft(from).trim());
  changed(to, hadTo, !!readDraft(to).trim());
}

/** Forgets a thread's draft altogether: text, pills and what it attached. */
export function dropThreadDraft(thread: string) {
  for (const key of removeThreadDraft(thread)) changed(key, true, false);
}

export function useDraft(key: string): string {
  const subscribe = useCallback(
    (notify: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(notify);
      return () => {
        set.delete(notify);
        if (!set.size) listeners.delete(key);
      };
    },
    [key],
  );
  return useSyncExternalStore(subscribe, () => readDraft(key));
}

function draftKeys(): string[] {
  if (index) return index;
  try {
    return (index = draftKeysWithText().sort());
  } catch {
    // Storage is a convenience here.
    return (index = []);
  }
}
const subscribeIndex = (notify: () => void) => {
  indexListeners.add(notify);
  return () => indexListeners.delete(notify);
};
/** The storage keys of every draft with text, sorted. */
export const useDraftKeys = () =>
  useSyncExternalStore(subscribeIndex, draftKeys);

/**
 * A project's unsent new threads: `new:<project>`, plus `new:<project>:<slot>`
 * for each one started while another still held text. Slots are creation
 * times, so they sort in the order they were started.
 */
export const newThreadId = (projectId: string, slot?: string) =>
  `new:${projectId}${slot ? ":" + slot : ""}`;
export function newThreadProject(id: string): string | undefined {
  const match = /^new:([^:]+)(?::[^:]+)?$/.exec(id);
  return match?.[1];
}
const isSlot = (id: string) => id.split(":").length === 3;
export const hasText = (id: string) => !!readDraft(threadDraftKey(id)).trim();

/** The new thread a project last showed. */
export function currentNewThread(projectId: string): string {
  const saved = localStorage.getItem(currentNewThreadKey(projectId));
  return saved && newThreadProject(saved) === projectId
    ? saved
    : newThreadId(projectId);
}
export const setCurrentNewThread = (projectId: string, id: string) =>
  localStorage.setItem(currentNewThreadKey(projectId), id);

/** The scope an unsent thread was written for; the repository by default. */
export const loadDraftScope = (id: string): ChatScope =>
  threadStorage(id).scope.load();
export const saveDraftScope = (id: string, scope: ChatScope) =>
  threadStorage(id).scope.save(scope);
/** Drops the scope and the workspace picked for it. */
export function clearDraftScope(id: string) {
  const { scope, workspace } = threadStorage(id);
  scope.clear();
  workspace.clear();
}

/** Where a project's new threads start unless one picks otherwise. */
export const projectWorkspace = (project: Pick<Project, "settings">) =>
  project.settings?.workspace ?? "checkout";
/** Where an unsent thread will work; where its project says by default. */
export const loadDraftWorkspace = (
  id: string,
  project: Pick<Project, "settings">,
): ChatWorkspace => threadStorage(id).workspace.load(projectWorkspace(project));
export const saveDraftWorkspace = (
  id: string,
  workspace: ChatWorkspace,
  project: Pick<Project, "settings">,
) => threadStorage(id).workspace.save(workspace, projectWorkspace(project));
export const clearDraftWorkspace = (id: string) =>
  threadStorage(id).workspace.clear();

/** What a sent or abandoned slot leaves behind; the base keeps its settings for the next one. */
export function forgetNewThread(id: string) {
  clearDraftScope(id);
  threadStorage(id).reply.save(null);
  if (isSlot(id)) {
    localStorage.removeItem(composerSettingsKey(id));
    dropThreadDraft(id);
  }
}

/**
 * Where a new thread in the project opens: its current one while that is
 * still empty, else a slot of its own, so drafts already written stay put.
 */
export function freshNewThread(projectId: string): string {
  const current = currentNewThread(projectId);
  if (!hasText(current)) return current;
  const base = newThreadId(projectId);
  if (!hasText(base)) return base;
  // Composers save their settings on sight; empty slots would pile up.
  const prefix = composerSettingsKey(base + ":");
  const left: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix))
      left.push(key.slice(composerSettingsKey("").length));
  }
  for (const id of left) if (!hasText(id)) forgetNewThread(id);
  const slot = newThreadId(projectId, Date.now().toString(36));
  // It starts on the settings the project's new threads have.
  const settings = localStorage.getItem(composerSettingsKey(base));
  if (settings) localStorage.setItem(composerSettingsKey(slot), settings);
  return slot;
}

export interface ActivityDraft {
  key: string;
  /** The thread's id, or the unsent thread's `new:` one. */
  id: string;
  project: Project;
  chat?: ChatSummary;
  /** Only a side conversation's reply holds text; it goes out from there. */
  reply: boolean;
}

/**
 * Activity's drafts, from `chat-draft:<chat>[:<reply>]` and
 * `chat-draft:new:<project>[:<slot>]` keys: one per thread, its main draft
 * first. The open thread's draft is on its own card already; an open new
 * thread's stays, so its card doesn't come and go as it's typed.
 */
export function activityDrafts(
  keys: string[],
  projects: Map<string, Project>,
  chats: Map<string, ChatSummary>,
  openChat: string | undefined,
): ActivityDraft[] {
  const drafts: ActivityDraft[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const id = key.slice(DRAFT_PREFIX.length);
    const projectId = newThreadProject(id);
    if (projectId) {
      const project = projects.get(projectId);
      if (project) drafts.push({ key, id, project, reply: false });
      continue;
    }
    const [chatId, reply] = id.split(":");
    const chat = chats.get(chatId);
    const project = chat && projects.get(chat.projectId);
    // Sorted keys put a thread's main draft before its replies.
    if (!project || chatId === openChat || seen.has(chatId)) continue;
    seen.add(chatId);
    drafts.push({ key, id: chatId, project, chat, reply: !!reply });
  }
  return drafts;
}
