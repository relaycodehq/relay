import { useCallback, useSyncExternalStore } from "react";
import type {
  ChatScope,
  ChatWorkspace,
  ChatSummary,
  Project,
  LinkedFolder,
} from "../../../shared/projects";
import {
  composerSettingsKey,
  currentNewThreadKey,
  draftKeysWithText,
  loadThreadDraft,
  moveDraftBody,
  readDraftText,
  removeThreadDraft,
  threadDraftKey,
  threadRecordIds,
  threadStorage,
  writeDraftBody,
  writeDraftText,
} from "../../lib/thread-storage";
import {
  DRAFT_PREFIX,
  RECORD_PREFIX,
  splitDraftKey,
  type DraftBody,
  type ReviewDraft,
  type ThreadDraft,
} from "../../lib/thread-draft";
import {
  draftImageCount,
  draftsWithImages,
  onDraftImageCount,
  readDraftImageCounts,
} from "../images/draft-images";

// Chat drafts live outside React state so a keystroke re-renders only the
// composer that shows the draft, not the whole conversation around it.
const listeners = new Map<string, Set<() => void>>();
// Told when a draft gains its first text or loses its last, not per keystroke.
const indexListeners = new Set<() => void>();
let index: string[] | undefined;

export const readDraft = readDraftText;

function reindex() {
  index = undefined;
  indexListeners.forEach((notify) => notify());
}

function changed(key: string, hadText: boolean, hasNow: boolean) {
  listeners.get(key)?.forEach((notify) => notify());
  if (hadText !== hasNow) reindex();
}

/** Something besides a new thread's text changed; it may have become a draft, or stopped being one. */
function changedRecord(id: string, wasDraft: boolean) {
  listeners.get(threadDraftKey(id))?.forEach((notify) => notify());
  if (wasDraft !== isReviewDraft(id)) reindex();
}

// A screenshot makes a draft as text does.
onDraftImageCount((key) => {
  listeners.get(key)?.forEach((notify) => notify());
  reindex();
});

export function writeDraft(key: string, value: string) {
  const had = !!readDraft(key).trim();
  writeDraftText(key, value);
  changed(key, had, !!value.trim());
}

// Told the thread whose draft went out from somewhere other than its
// composer, a phone's send through this computer, so a composer showing it
// drops the screenshots and attachments it holds from storage that's moved on.
const takenListeners = new Set<(thread: string) => void>();
export function onDraftTaken(listener: (thread: string) => void) {
  takenListeners.add(listener);
  return () => void takenListeners.delete(listener);
}
export const draftTaken = (thread: string) =>
  takenListeners.forEach((listener) => listener(thread));

/** Puts what another screen left in a composer: its text, its pills and, for a new thread, where it works. */
export function setDraftBody(
  key: string,
  body: DraftBody,
  workspace?: ChatWorkspace | null,
) {
  const had = !!readDraft(key).trim();
  writeDraftBody(key, body, workspace);
  changed(key, had, !!readDraft(key).trim());
}

// When each thread last had a draft go out, so Activity can tell a sent
// draft from one cleared away. Kept in storage and written before the draft
// empties, so a thread's own window tells the main one why its draft went.
const SENT = "relay-draft-sent";
const SENT_KEPT = 50;
let sentRead: { raw: string | null; marks: Record<string, number> } = {
  raw: null,
  marks: {},
};

function sentMarks(): Record<string, number> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SENT);
  } catch {
    // Storage is a convenience here.
  }
  if (raw === sentRead.raw) return sentRead.marks;
  let marks: Record<string, number> = {};
  try {
    const saved: unknown = raw && JSON.parse(raw);
    if (saved && typeof saved === "object")
      marks = saved as Record<string, number>;
  } catch {
    // A malformed record counts as no marks.
  }
  sentRead = { raw, marks };
  return marks;
}

/** Called before a thread's draft empties to go out. */
export function markDraftSent(chatId: string) {
  const marks = Object.entries({ ...sentMarks(), [chatId]: Date.now() })
    .sort(([, a], [, b]) => b - a)
    .slice(0, SENT_KEPT);
  try {
    localStorage.setItem(SENT, JSON.stringify(Object.fromEntries(marks)));
  } catch {
    // Activity then takes the draft as cleared rather than sent.
  }
}

export const draftSentAt = (chatId: string): number | undefined =>
  sentMarks()[chatId];

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

function useKeySubscription(key: string) {
  return useCallback(
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
}

/** Part of a thread's draft record, as it changes here or in another window. */
export function useDraftRecord<T extends string | number | boolean | undefined>(
  id: string,
  select: (draft: ThreadDraft) => T,
): T {
  const read = () => select(loadThreadDraft(id));
  return useSyncExternalStore(
    useKeySubscription(threadDraftKey(id)),
    read,
    read,
  );
}

export function useDraft(key: string): string {
  const read = () => readDraft(key);
  return useSyncExternalStore(useKeySubscription(key), read, read);
}

/** How many screenshots without a pill the draft holds. */
export function useDraftImageCount(key: string): number {
  return useSyncExternalStore(useKeySubscription(key), () =>
    draftImageCount(key),
  );
}

function readIndex(): string[] {
  let keys: string[];
  try {
    keys = draftKeysWithText(reviewSetUp);
  } catch {
    // Storage is a convenience here.
    keys = [];
  }
  return [...new Set([...keys, ...draftsWithImages()])].sort();
}
const draftKeys = () => (index ??= readIndex());

/**
 * A thread popped into its own window shares storage with this one: a draft
 * written, sent or cleared there shows here, and the other way round, so
 * neither composer keeps text the other already sent and saves it back.
 */
function heardFromOtherWindow(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith(RECORD_PREFIX)) return;
  // A null key is storage cleared altogether.
  const thread = event.key?.slice(RECORD_PREFIX.length);
  for (const [key, notify] of listeners)
    if (thread === undefined || splitDraftKey(key)?.thread === thread)
      notify.forEach((n) => n());
  const was = index;
  index = readIndex();
  if (was?.join("\n") !== index.join("\n"))
    indexListeners.forEach((notify) => notify());
}
if (typeof window !== "undefined")
  window.addEventListener("storage", heardFromOtherWindow);
const subscribeIndex = (notify: () => void) => {
  void readDraftImageCounts();
  indexListeners.add(notify);
  return () => indexListeners.delete(notify);
};
/** The storage keys of every draft with text or a screenshot, or set up as a deep review, sorted. */
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
/**
 * An unsent thread with a deep review set up in it, which is a draft before
 * it has any text. Only opening the setup doesn't make one.
 */
export const reviewSetUp = (id: string, draft: ThreadDraft) =>
  !!newThreadProject(id) && draft.scope?.kind === "review" && !!draft.review;
const isReviewDraft = (id: string) => reviewSetUp(id, loadThreadDraft(id));
export const hasDraft = (id: string) =>
  !!readDraft(threadDraftKey(id)).trim() ||
  !!draftImageCount(threadDraftKey(id)) ||
  !!loadDraftLinks(id).length ||
  isReviewDraft(id);

/** The project's unsent deep review: the one it shows, else the newest. */
export function reviewDraftIn(projectId: string): string | undefined {
  const current = currentNewThread(projectId);
  if (isReviewDraft(current)) return current;
  const at = (id: string) => loadThreadDraft(id).review?.at ?? 0;
  return threadRecordIds()
    .filter((id) => newThreadProject(id) === projectId && isReviewDraft(id))
    .sort((a, b) => at(a) - at(b))
    .at(-1);
}

/** Changes an unsent deep review's setup, target or note. */
export function updateReviewDraft(id: string, change: Partial<ReviewDraft>) {
  const was = isReviewDraft(id);
  threadStorage(id).review.update(change);
  changedRecord(id, was);
}

/** The new thread a project last showed. */
export function currentNewThread(projectId: string): string {
  const saved = localStorage.getItem(currentNewThreadKey(projectId));
  return saved && newThreadProject(saved) === projectId
    ? saved
    : newThreadId(projectId);
}
export const setCurrentNewThread = (projectId: string, id: string) =>
  localStorage.setItem(currentNewThreadKey(projectId), id);

export const loadDraftLinks = (id: string): LinkedFolder[] =>
  threadStorage(id).links.load();

/** The scope an unsent thread was written for; the repository by default. */
export const loadDraftScope = (id: string): ChatScope =>
  threadStorage(id).scope.load();
export function saveDraftScope(id: string, scope: ChatScope) {
  const was = isReviewDraft(id);
  // A review set up and then switched away from waits there, its note
  // included, for Deep review to be picked again; only × or Start drops it.
  threadStorage(id).scope.save(scope);
  changedRecord(id, was);
}
/**
 * Drops the scope and the workspace picked for it, as for a fresh thread in
 * the slot. A review set aside there stays for Deep review to be picked again.
 */
export function resetDraftScope(id: string) {
  const was = isReviewDraft(id);
  threadStorage(id).scope.clear();
  clearDraftWorkspace(id);
  changedRecord(id, was);
}
/** Drops the scope, the workspace picked for it and any review set up. */
export function clearDraftScope(id: string) {
  const was = isReviewDraft(id);
  threadStorage(id).scope.clear();
  threadStorage(id).review.clear();
  clearDraftWorkspace(id);
  changedRecord(id, was);
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
export function clearDraftWorkspace(id: string) {
  threadStorage(id).workspace.clear();
  threadStorage(id).branch.save("");
  threadStorage(id).start.save(undefined);
}
/** The branch typed for an unsent thread's worktree, when it will work in one. */
export const draftWorktreeBranch = (
  id: string,
  project: Pick<Project, "settings">,
) =>
  loadDraftWorkspace(id, project) === "worktree"
    ? threadStorage(id).branch.load().trim() || undefined
    : undefined;
/** Where an unsent thread's worktree starts, when it will work in one picked off something else. */
export const draftWorktreeStart = (
  id: string,
  project: Pick<Project, "settings">,
) =>
  loadDraftWorkspace(id, project) === "worktree"
    ? threadStorage(id).start.load()
    : undefined;

/** What a sent or abandoned slot leaves behind; the base keeps its settings for the next one. */
export function forgetNewThread(id: string) {
  threadStorage(id).links.clear();
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
  if (!hasDraft(current)) return current;
  const base = newThreadId(projectId);
  if (!hasDraft(base)) return base;
  // Composers save their settings on sight; empty slots would pile up.
  const prefix = composerSettingsKey(base + ":");
  const left: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix))
      left.push(key.slice(composerSettingsKey("").length));
  }
  for (const id of left) if (!hasDraft(id)) forgetNewThread(id);
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
 * first. The open thread's is listed too, so its card rises as it's typed.
 */
export function activityDrafts(
  keys: string[],
  projects: Map<string, Project>,
  chats: Map<string, ChatSummary>,
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
    if (!project || seen.has(chatId)) continue;
    seen.add(chatId);
    drafts.push({ key, id: chatId, project, chat, reply: !!reply });
  }
  return drafts;
}
