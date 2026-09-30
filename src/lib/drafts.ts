import { useCallback, useSyncExternalStore } from "react";
import {
  chatScopeSchema,
  type ChatScope,
  type ChatSummary,
  type Project,
} from "../../shared/projects";

// Chat drafts live outside React state so a keystroke re-renders only the
// composer that shows the draft, not the whole conversation around it.
const listeners = new Map<string, Set<() => void>>();
// Told when a draft gains its first text or loses its last, not per keystroke.
const indexListeners = new Set<() => void>();
let index: string[] | undefined;

export const DRAFT_PREFIX = "chat-draft:";

export function readDraft(key: string): string {
  return localStorage.getItem(key) ?? "";
}

export function writeDraft(key: string, value: string) {
  const had = !!readDraft(key).trim();
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
  listeners.get(key)?.forEach((notify) => notify());
  if (had !== !!value.trim()) {
    index = undefined;
    indexListeners.forEach((notify) => notify());
  }
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
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX) && localStorage.getItem(key)?.trim())
        keys.push(key);
    }
  } catch {
    // Storage is a convenience here.
  }
  return (index = keys.sort());
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
const hasText = (id: string) => !!readDraft(DRAFT_PREFIX + id).trim();

const currentKey = (projectId: string) => "relay-new-thread:" + projectId;
/** The new thread a project last showed. */
export function currentNewThread(projectId: string): string {
  const saved = localStorage.getItem(currentKey(projectId));
  return saved && newThreadProject(saved) === projectId
    ? saved
    : newThreadId(projectId);
}
export const setCurrentNewThread = (projectId: string, id: string) =>
  localStorage.setItem(currentKey(projectId), id);

/** The scope an unsent thread was written for; the repository by default. */
const scopeKey = (id: string) => "relay-draft-scope:" + id.slice(4);
export function loadDraftScope(id: string): ChatScope {
  try {
    const stored = chatScopeSchema.safeParse(
      JSON.parse(localStorage.getItem(scopeKey(id)) || "null"),
    );
    return stored.success ? stored.data : { kind: "project" };
  } catch {
    return { kind: "project" };
  }
}
export const saveDraftScope = (id: string, scope: ChatScope) =>
  localStorage.setItem(scopeKey(id), JSON.stringify(scope));
export const clearDraftScope = (id: string) =>
  localStorage.removeItem(scopeKey(id));

/** What a sent or abandoned slot leaves behind; the base keeps its settings for the next one. */
export function forgetNewThread(id: string) {
  clearDraftScope(id);
  localStorage.removeItem("chat-reply:" + id);
  if (isSlot(id)) localStorage.removeItem("composer-settings:" + id);
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
  const prefix = "composer-settings:" + base + ":";
  const left: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix))
      left.push(key.slice("composer-settings:".length));
  }
  for (const id of left) if (!hasText(id)) forgetNewThread(id);
  const slot = newThreadId(projectId, Date.now().toString(36));
  // It starts on the settings the project's new threads have.
  const settings = localStorage.getItem("composer-settings:" + base);
  if (settings) localStorage.setItem("composer-settings:" + slot, settings);
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
