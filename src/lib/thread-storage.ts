import {
  chatScopeSchema,
  chatWorkspaceSchema,
  type ChatScope,
  type ChatWorkspace,
} from "../../shared/projects";
import { lineQuestionSchema, type LineQuestion } from "../../shared/questions";
import type { WorkItem } from "../../shared/devops";
import {
  isCodeReference,
  type CodeReference,
} from "../../shared/code-references";
import { readJson } from "./persisted-store";

// Every localStorage key kept for one thread, or for an unsent
// `new:<project>[:<slot>]` one. The names predate this module and stay as
// they are: drafts are saved under them.
export const DRAFT_PREFIX = "chat-draft:";
const REPLY = "chat-reply:",
  SELECTION = "chat-selection:",
  WORK_ITEM = "chat-work-item:",
  CODE_REFS = "chat-code-refs:",
  SETTINGS = "composer-settings:",
  // An unsent thread's, without its `new:`.
  SCOPE = "relay-draft-scope:",
  WORKSPACE = "relay-draft-workspace:";
// Kept per draft key, so a side conversation's composer has its own.
const SKILL_CHIPS = "skill-chips:",
  QUOTE_CHIPS = "quote-chips:",
  FILE_CHIPS = "file-chips:",
  // Earlier versions kept pastes beside the draft; see useComposerDraft.
  PASTED_TEXTS = "pasted-texts:";
// Per project: the thread it shows, and the unsent one it last showed.
const OPEN_THREAD = "relay-project-chat:",
  CURRENT_NEW_THREAD = "relay-new-thread:";

/** A thread's main draft, or with `reply` its side conversation's. */
export const threadDraftKey = (id: string, reply?: string | null) =>
  DRAFT_PREFIX + id + (reply ? ":" + reply : "");
/** A composer's settings: a thread's, or `<thread>:<reply>` for a side conversation. */
export const composerSettingsKey = (key: string) => SETTINGS + key;

function slot<T>(
  key: string,
  parse: (saved: unknown) => T,
  isEmpty: (value: T) => boolean,
) {
  return {
    load: () => parse(readJson(key)),
    save(value: T) {
      if (isEmpty(value)) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    },
    clear: () => localStorage.removeItem(key),
  };
}

/** What a thread's main composer keeps besides its text and settings. */
export function threadStorage(id: string) {
  const unsent = id.slice("new:".length);
  return {
    /** The side conversation the composer was in. */
    reply: {
      load: () => localStorage.getItem(REPLY + id),
      save(root: string | null) {
        if (root) localStorage.setItem(REPLY + id, root);
        else localStorage.removeItem(REPLY + id);
      },
    },
    selection: slot<LineQuestion | undefined>(
      SELECTION + id,
      (saved) => lineQuestionSchema.safeParse(saved).data,
      (value) => !value,
    ),
    workItem: slot<WorkItem | undefined>(
      WORK_ITEM + id,
      (saved) => {
        const item = saved as WorkItem | null | undefined;
        return typeof item?.id === "number" && typeof item.title === "string"
          ? item
          : undefined;
      },
      (value) => !value,
    ),
    codeRefs: slot<CodeReference[]>(
      CODE_REFS + id,
      (saved) => (Array.isArray(saved) ? saved.filter(isCodeReference) : []),
      (value) => !value.length,
    ),
    /** The scope an unsent thread was written for; the repository by default. */
    scope: slot<ChatScope>(
      SCOPE + unsent,
      (saved) => chatScopeSchema.safeParse(saved).data ?? { kind: "project" },
      () => false,
    ),
    /** Where an unsent thread will work; the project folder by default. */
    workspace: {
      load: (): ChatWorkspace =>
        chatWorkspaceSchema.safeParse(localStorage.getItem(WORKSPACE + unsent))
          .data ?? "checkout",
      save(workspace: ChatWorkspace) {
        if (workspace === "checkout")
          localStorage.removeItem(WORKSPACE + unsent);
        else localStorage.setItem(WORKSPACE + unsent, workspace);
      },
    },
  };
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
/** What the composer under `draftKey` needs to show its pills again. */
export function draftChips(draftKey: string) {
  return {
    /** Each skill token's label. */
    skills: slot<Record<string, string>>(
      SKILL_CHIPS + draftKey,
      (saved) =>
        saved && typeof saved === "object" && !Array.isArray(saved)
          ? (saved as Record<string, string>)
          : {},
      (value) => !Object.keys(value).length,
    ),
    quotes: slot<string[]>(
      QUOTE_CHIPS + draftKey,
      (saved) => (isStrings(saved) ? saved : []),
      (value) => !value.length,
    ),
    files: slot<string[]>(
      FILE_CHIPS + draftKey,
      (saved) => (isStrings(saved) ? saved : []),
      (value) => !value.length,
    ),
  };
}
/** Pastes an earlier version kept beside the draft, taken out of storage. */
export function takeLegacyPastes(draftKey: string): string | null {
  const kept = localStorage.getItem(PASTED_TEXTS + draftKey);
  if (kept !== null) localStorage.removeItem(PASTED_TEXTS + draftKey);
  return kept;
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
 * Thread ids hold no colons; a `new:` id has no side conversations, so all
 * of what follows its prefix is the id.
 */
export function keyOwner(
  key: string,
): { thread: string } | { project: string } | undefined {
  for (const prefix of [OPEN_THREAD, CURRENT_NEW_THREAD])
    if (key.startsWith(prefix)) return { project: key.slice(prefix.length) };
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
