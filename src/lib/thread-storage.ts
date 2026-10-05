import type { ChatScope, ChatWorkspace } from "../../shared/projects";
import type { LineQuestion } from "../../shared/questions";
import type { WorkItem } from "../../shared/devops";
import type { CodeReference } from "../../shared/code-references";
import {
  CODE_REFS,
  DRAFT_PREFIX,
  FILE_CHIPS,
  PASTED_TEXTS,
  QUOTE_CHIPS,
  RECORD_PREFIX,
  REPLY,
  SCOPE,
  SELECTION,
  SKILL_CHIPS,
  WORKSPACE,
  WORK_ITEM,
  assembleLegacy,
  bodyOf,
  draftKeyOf,
  emptyThreadDraft,
  isThreadDraftEmpty,
  mergeLegacy,
  parseLegacyKey,
  parseThreadDraft,
  serializeThreadDraft,
  splitDraftKey,
  withBody,
  type ThreadDraft,
} from "./thread-draft";

export { DRAFT_PREFIX };

// Per thread, or per unsent `new:<project>[:<slot>]` one: the draft record,
// see thread-draft, and the composer's settings.
const SETTINGS = "composer-settings:";
// Per project: the thread it shows, and the unsent one it last showed.
const OPEN_THREAD = "relay-project-chat:",
  CURRENT_NEW_THREAD = "relay-new-thread:";

/** A thread's main draft, or with `reply` its side conversation's. */
export const threadDraftKey = draftKeyOf;
/** A composer's settings: a thread's, or `<thread>:<reply>` for a side conversation. */
export const composerSettingsKey = (key: string) => SETTINGS + key;

let migrated: Storage | undefined;
// A draft storage refused (full, or unavailable), kept so it isn't lost
// while the app runs, with the old keys it came from, still in storage.
const unwritten = new Map<string, { draft: ThreadDraft; legacy: string[] }>();
// The last record read per thread, so a keystroke or a render doesn't parse
// what hasn't changed.
const parsed = new Map<string, { raw: string; draft: ThreadDraft }>();

function readRecord(thread: string): ThreadDraft {
  const raw = localStorage.getItem(RECORD_PREFIX + thread);
  if (raw === null) {
    parsed.delete(thread);
    return emptyThreadDraft();
  }
  const hit = parsed.get(thread);
  if (hit?.raw === raw) return hit.draft;
  let draft: ThreadDraft;
  try {
    draft = parseThreadDraft(JSON.parse(raw));
  } catch {
    draft = emptyThreadDraft();
  }
  parsed.set(thread, { raw, draft });
  return draft;
}

/**
 * Writes `draft` as the thread's record, then drops the old keys it was
 * assembled from: only once it is saved, so a refused write loses nothing.
 */
function commit(thread: string, draft: ThreadDraft, legacy: string[]): void {
  const key = RECORD_PREFIX + thread;
  try {
    if (isThreadDraftEmpty(draft)) localStorage.removeItem(key);
    else {
      const raw = serializeThreadDraft(draft);
      if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw);
    }
    parsed.delete(thread);
  } catch {
    unwritten.set(thread, { draft, legacy });
    return;
  }
  unwritten.delete(thread);
  for (const old of legacy) localStorage.removeItem(old);
}

/**
 * Moves what the old keys kept into the thread records, once a launch. An
 * old key and a record for one thread are merged, see mergeLegacy.
 */
export function migrateDrafts() {
  if (migrated === localStorage) return;
  migrated = localStorage;
  const entries: [string, string][] = [];
  const keysOf = new Map<string, string[]>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const part = key && parseLegacyKey(key);
    const value = key && localStorage.getItem(key);
    if (!key || !part || value === null) continue;
    entries.push([key, value]);
    keysOf.set(part.thread, [...(keysOf.get(part.thread) ?? []), key]);
  }
  for (const [thread, draft] of assembleLegacy(entries))
    commit(
      thread,
      mergeLegacy(readRecord(thread), draft),
      keysOf.get(thread) ?? [],
    );
}

export function loadThreadDraft(thread: string): ThreadDraft {
  migrateDrafts();
  return unwritten.get(thread)?.draft ?? readRecord(thread);
}
export function saveThreadDraft(thread: string, draft: ThreadDraft) {
  migrateDrafts();
  commit(thread, draft, unwritten.get(thread)?.legacy ?? []);
}
const updateThreadDraft = (
  thread: string,
  change: (draft: ThreadDraft) => ThreadDraft,
) => saveThreadDraft(thread, change(loadThreadDraft(thread)));

/** The draft keys of the thread's composers that hold text. */
function textKeys(thread: string, draft: ThreadDraft): string[] {
  return [
    ...(draft.main.text.trim() ? [draftKeyOf(thread)] : []),
    ...Object.entries(draft.replies)
      .filter(([, body]) => body.text.trim())
      .map(([root]) => draftKeyOf(thread, root)),
  ];
}

/** Forgets the thread's draft altogether; the draft keys that had text. */
export function removeThreadDraft(thread: string): string[] {
  migrateDrafts();
  const had = textKeys(thread, loadThreadDraft(thread));
  for (const key of unwritten.get(thread)?.legacy ?? [])
    localStorage.removeItem(key);
  unwritten.delete(thread);
  parsed.delete(thread);
  localStorage.removeItem(RECORD_PREFIX + thread);
  return had;
}

/** A composer's text. */
export function readDraftText(key: string): string {
  const at = splitDraftKey(key);
  return at ? bodyOf(loadThreadDraft(at.thread), at.reply).text : "";
}
export function writeDraftText(key: string, text: string) {
  const at = splitDraftKey(key);
  if (at) updateThreadDraft(at.thread, (d) => withBody(d, at.reply, { text }));
}

/** Moves one composer's text and pills to another's, in one write each way. */
export function moveDraftBody(from: string, to: string) {
  const a = splitDraftKey(from),
    b = splitDraftKey(to);
  if (!a || !b) return;
  const body = bodyOf(loadThreadDraft(a.thread), a.reply);
  updateThreadDraft(b.thread, (d) => withBody(d, b.reply, body));
  updateThreadDraft(a.thread, (d) =>
    withBody(d, a.reply, { text: "", skills: {}, quotes: [], files: [] }),
  );
}

/** The draft keys of every composer with text. */
export function draftKeysWithText(): string[] {
  migrateDrafts();
  const keys: string[] = [];
  for (const [thread, { draft }] of unwritten)
    keys.push(...textKeys(thread, draft));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(RECORD_PREFIX)) continue;
    const thread = key.slice(RECORD_PREFIX.length);
    if (!unwritten.has(thread))
      keys.push(...textKeys(thread, readRecord(thread)));
  }
  return keys;
}

/** What a thread's main composer keeps besides its text and settings. */
export function threadStorage(id: string) {
  const read = () => loadThreadDraft(id);
  const edit = (change: Partial<ThreadDraft>) =>
    updateThreadDraft(id, (d) => ({ ...d, ...change }));
  return {
    /** The side conversation the composer was in. */
    reply: {
      load: () => read().replyRoot ?? null,
      save: (root: string | null) => edit({ replyRoot: root || undefined }),
    },
    selection: {
      load: (): LineQuestion | undefined => read().selection,
      save: (selection: LineQuestion | undefined) => edit({ selection }),
      clear: () => edit({ selection: undefined }),
    },
    workItem: {
      load: (): WorkItem | undefined => read().workItem,
      save: (workItem: WorkItem | undefined) => edit({ workItem }),
      clear: () => edit({ workItem: undefined }),
    },
    codeRefs: {
      load: (): CodeReference[] => [...read().codeRefs],
      save: (codeRefs: CodeReference[]) => edit({ codeRefs }),
      clear: () => edit({ codeRefs: [] }),
    },
    /** The scope an unsent thread was written for; the repository by default. */
    scope: {
      load: (): ChatScope => read().scope ?? { kind: "project" },
      save: (scope: ChatScope) => edit({ scope }),
      clear: () => edit({ scope: undefined }),
    },
    /** Where an unsent thread will work, when picked for it rather than left to its project. */
    workspace: {
      load: (fallback: ChatWorkspace): ChatWorkspace =>
        read().workspace ?? fallback,
      save: (workspace: ChatWorkspace, fallback: ChatWorkspace) =>
        edit({ workspace: workspace === fallback ? undefined : workspace }),
      clear: () => edit({ workspace: undefined }),
    },
    /** The branch typed for an unsent thread's worktree; none leaves it to Relay. */
    branch: {
      load: (): string => read().branch ?? "",
      save: (branch: string) => edit({ branch: branch || undefined }),
    },
  };
}

/** What the composer under `draftKey` needs to show its pills again. */
export function draftChips(draftKey: string) {
  const { thread, reply } = splitDraftKey(draftKey) ?? { thread: draftKey };
  const body = () => bodyOf(loadThreadDraft(thread), reply);
  const edit = (change: Parameters<typeof withBody>[2]) =>
    updateThreadDraft(thread, (d) => withBody(d, reply, change));
  return {
    /** Each skill token's label. */
    skills: {
      load: () => ({ ...body().skills }),
      save: (skills: Record<string, string>) => edit({ skills: { ...skills } }),
    },
    quotes: {
      load: () => [...body().quotes],
      save: (quotes: string[]) => edit({ quotes }),
    },
    files: {
      load: () => [...body().files],
      save: (files: string[]) => edit({ files }),
    },
  };
}

/** The thread a project shows; "" for its unsent one, null before any. */
export const openThread = {
  load: (projectId: string) => localStorage.getItem(OPEN_THREAD + projectId),
  save: (projectId: string, id: string | null) =>
    localStorage.setItem(OPEN_THREAD + projectId, id ?? ""),
};
export const currentNewThreadKey = (projectId: string) =>
  CURRENT_NEW_THREAD + projectId;

/**
 * Whose a key is: a thread (`new:` ones included), a project, or neither.
 * Besides the record, this knows the keys a draft was kept under before it
 * (see thread-draft), which a launch may still find.
 */
export function keyOwner(
  key: string,
): { thread: string } | { project: string } | undefined {
  for (const prefix of [OPEN_THREAD, CURRENT_NEW_THREAD])
    if (key.startsWith(prefix)) return { project: key.slice(prefix.length) };
  if (key.startsWith(RECORD_PREFIX))
    return key.length > RECORD_PREFIX.length
      ? { thread: key.slice(RECORD_PREFIX.length) }
      : undefined;
  for (const prefix of [SCOPE, WORKSPACE])
    if (key.startsWith(prefix))
      return { thread: "new:" + key.slice(prefix.length) };
  let rest = key;
  for (const prefix of [SKILL_CHIPS, QUOTE_CHIPS, FILE_CHIPS, PASTED_TEXTS])
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      if (!rest.startsWith(DRAFT_PREFIX)) return;
      break;
    }
  for (const prefix of [
    DRAFT_PREFIX,
    REPLY,
    SELECTION,
    WORK_ITEM,
    CODE_REFS,
    SETTINGS,
  ])
    if (rest.startsWith(prefix)) {
      const id = rest.slice(prefix.length);
      if (!id) return;
      return { thread: id.startsWith("new:") ? id : id.split(":")[0] };
    }
}
