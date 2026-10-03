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
import { pasteMarkdown, type PastedText } from "../../shared/pasted-texts";

/**
 * Everything a thread's composers keep for an unsent message, as one record
 * under `relay-draft:<thread>`, so what is written together reads back
 * together: the text and the pills in it, the side conversations' drafts, a
 * selected line, a work item, code references and, for an unsent thread, the
 * scope and workspace it was written for. Screenshots stay in IndexedDB, as
 * they are too big for localStorage.
 *
 * Before the record, each of these had a key of its own; `assembleLegacy`
 * reads them into one.
 */
export const DRAFT_VERSION = 1;

/** One composer's draft: the text, and what made the pills in it. */
export interface DraftBody {
  text: string;
  /** Each skill token's label. */
  skills: Record<string, string>;
  quotes: string[];
  files: string[];
}

export interface ThreadDraft {
  /** The thread's main composer. */
  main: DraftBody;
  /** Side conversations' composers, by the message they reply to. */
  replies: Record<string, DraftBody>;
  /** The side conversation the main composer was in. */
  replyRoot?: string;
  selection?: LineQuestion;
  workItem?: WorkItem;
  codeRefs: CodeReference[];
  /** The scope an unsent thread was written for. */
  scope?: ChatScope;
  /** Where an unsent thread will work, when picked for it. */
  workspace?: ChatWorkspace;
}

export const emptyBody = (): DraftBody => ({
  text: "",
  skills: {},
  quotes: [],
  files: [],
});
export const emptyThreadDraft = (): ThreadDraft => ({
  main: emptyBody(),
  replies: {},
  codeRefs: [],
});

const isBodyEmpty = (body: DraftBody) =>
  !body.text &&
  !Object.keys(body.skills).length &&
  !body.quotes.length &&
  !body.files.length;
export const isThreadDraftEmpty = (draft: ThreadDraft) =>
  isBodyEmpty(draft.main) &&
  !Object.keys(draft.replies).length &&
  draft.replyRoot === undefined &&
  !draft.selection &&
  !draft.workItem &&
  !draft.codeRefs.length &&
  !draft.scope &&
  draft.workspace === undefined;

export const bodyOf = (draft: ThreadDraft, reply?: string): DraftBody =>
  (reply ? draft.replies[reply] : draft.main) ?? emptyBody();

/** `draft` with one composer's body changed; an empty side conversation's is dropped. */
export function withBody(
  draft: ThreadDraft,
  reply: string | undefined,
  change: Partial<DraftBody>,
): ThreadDraft {
  const body = { ...bodyOf(draft, reply), ...change };
  if (!reply) return { ...draft, main: body };
  const { [reply]: _, ...rest } = draft.replies;
  return {
    ...draft,
    replies: isBodyEmpty(body) ? rest : { ...rest, [reply]: body },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const readSkills = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
const readStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const readSelection = (value: unknown) =>
  lineQuestionSchema.safeParse(value).data;
function readWorkItem(value: unknown): WorkItem | undefined {
  const item = value as WorkItem | null | undefined;
  return typeof item?.id === "number" && typeof item.title === "string"
    ? item
    : undefined;
}
const readCodeRefs = (value: unknown): CodeReference[] =>
  Array.isArray(value) ? value.filter(isCodeReference) : [];
const readScope = (value: unknown) => chatScopeSchema.safeParse(value).data;
const readWorkspace = (value: unknown) =>
  chatWorkspaceSchema.safeParse(value).data;
const readRoot = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

function readBody(value: unknown): DraftBody {
  if (!isRecord(value)) return emptyBody();
  return {
    text: typeof value.text === "string" ? value.text : "",
    skills: readSkills(value.skills),
    quotes: readStrings(value.quotes),
    files: readStrings(value.files),
  };
}

/** A saved record, keeping each part that reads and dropping the ones that don't. */
export function parseThreadDraft(saved: unknown): ThreadDraft {
  if (!isRecord(saved)) return emptyThreadDraft();
  const replies: Record<string, DraftBody> = {};
  if (isRecord(saved.replies))
    for (const [root, body] of Object.entries(saved.replies)) {
      const read = readBody(body);
      if (!isBodyEmpty(read)) replies[root] = read;
    }
  return {
    main: readBody(saved.main),
    replies,
    replyRoot: readRoot(saved.replyRoot),
    selection: readSelection(saved.selection),
    workItem: readWorkItem(saved.workItem),
    codeRefs: readCodeRefs(saved.codeRefs),
    scope: readScope(saved.scope),
    workspace: readWorkspace(saved.workspace),
  };
}

const bodyJson = (body: DraftBody) => ({
  ...(body.text ? { text: body.text } : {}),
  ...(Object.keys(body.skills).length ? { skills: body.skills } : {}),
  ...(body.quotes.length ? { quotes: body.quotes } : {}),
  ...(body.files.length ? { files: body.files } : {}),
});

export function serializeThreadDraft(draft: ThreadDraft): string {
  const replies = Object.fromEntries(
    Object.entries(draft.replies)
      .filter(([, body]) => !isBodyEmpty(body))
      .map(([root, body]) => [root, bodyJson(body)]),
  );
  return JSON.stringify({
    v: DRAFT_VERSION,
    ...(isBodyEmpty(draft.main) ? {} : { main: bodyJson(draft.main) }),
    ...(Object.keys(replies).length ? { replies } : {}),
    ...(draft.replyRoot !== undefined ? { replyRoot: draft.replyRoot } : {}),
    ...(draft.selection ? { selection: draft.selection } : {}),
    ...(draft.workItem ? { workItem: draft.workItem } : {}),
    ...(draft.codeRefs.length ? { codeRefs: draft.codeRefs } : {}),
    ...(draft.scope ? { scope: draft.scope } : {}),
    ...(draft.workspace !== undefined ? { workspace: draft.workspace } : {}),
  });
}

// What was kept per key before the record. The names are what drafts were
// saved under, so they stay as they are.
export const DRAFT_PREFIX = "chat-draft:",
  RECORD_PREFIX = "relay-draft:",
  REPLY = "chat-reply:",
  SELECTION = "chat-selection:",
  WORK_ITEM = "chat-work-item:",
  CODE_REFS = "chat-code-refs:",
  // An unsent thread's, without its `new:`.
  SCOPE = "relay-draft-scope:",
  WORKSPACE = "relay-draft-workspace:",
  // Kept per draft key, so a side conversation's composer had its own.
  SKILL_CHIPS = "skill-chips:",
  QUOTE_CHIPS = "quote-chips:",
  FILE_CHIPS = "file-chips:",
  // Pastes the released version kept beside the draft, before they were pills in it.
  PASTED_TEXTS = "pasted-texts:";

/**
 * A composer's draft key: a thread's `chat-draft:<id>`, or with a side
 * conversation `chat-draft:<id>:<reply>`. Thread ids hold no colons, and an
 * unsent `new:` id has no side conversations, so all of what follows its
 * prefix is the id.
 */
export const draftKeyOf = (thread: string, reply?: string | null) =>
  DRAFT_PREFIX + thread + (reply ? ":" + reply : "");
export function splitDraftKey(
  key: string,
): { thread: string; reply?: string } | undefined {
  if (!key.startsWith(DRAFT_PREFIX)) return;
  const id = key.slice(DRAFT_PREFIX.length);
  if (!id) return;
  const colon = id.startsWith("new:") ? -1 : id.indexOf(":");
  if (colon < 0) return { thread: id };
  return {
    thread: id.slice(0, colon),
    reply: id.slice(colon + 1) || undefined,
  };
}

type LegacyKind =
  | "text"
  | "skills"
  | "quotes"
  | "files"
  | "pastes"
  | "replyRoot"
  | "selection"
  | "workItem"
  | "codeRefs"
  | "scope"
  | "workspace";
/** Which thread and part of its draft one of the old keys held. */
export function parseLegacyKey(
  key: string,
): { thread: string; kind: LegacyKind; reply?: string } | undefined {
  for (const [prefix, kind] of [
    [SKILL_CHIPS, "skills"],
    [QUOTE_CHIPS, "quotes"],
    [FILE_CHIPS, "files"],
    [PASTED_TEXTS, "pastes"],
  ] as const)
    if (key.startsWith(prefix)) {
      const split = splitDraftKey(key.slice(prefix.length));
      return split && { ...split, kind };
    }
  const text = splitDraftKey(key);
  if (text) return { ...text, kind: "text" };
  for (const [prefix, kind] of [
    [REPLY, "replyRoot"],
    [SELECTION, "selection"],
    [WORK_ITEM, "workItem"],
    [CODE_REFS, "codeRefs"],
  ] as const)
    if (key.startsWith(prefix) && key.length > prefix.length)
      return { thread: key.slice(prefix.length), kind };
  for (const [prefix, kind] of [
    [SCOPE, "scope"],
    [WORKSPACE, "workspace"],
  ] as const)
    if (key.startsWith(prefix) && key.length > prefix.length)
      return { thread: "new:" + key.slice(prefix.length), kind };
}

function json(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The long pastes an earlier version kept beside a draft, as the pills they became. */
function pastesAsPills(saved: string): string {
  const value = json(saved);
  return (Array.isArray(value) ? value : [])
    .filter(
      (p): p is PastedText =>
        Number.isInteger(p?.n) && typeof p.text === "string",
    )
    .map(pasteMarkdown)
    .join("");
}

/**
 * The drafts the old keys held, one per thread. A part that doesn't read is
 * left out and the rest kept. Pastes go after the text, as they would have
 * been sent.
 */
export function assembleLegacy(
  entries: Iterable<readonly [key: string, value: string]>,
): Map<string, ThreadDraft> {
  const drafts = new Map<string, ThreadDraft>();
  const pastes = new Map<string, string>();
  for (const [key, value] of entries) {
    const part = parseLegacyKey(key);
    if (!part) continue;
    const { thread, kind, reply } = part;
    let draft = drafts.get(thread) ?? emptyThreadDraft();
    if (kind === "text") draft = withBody(draft, reply, { text: value });
    else if (kind === "skills")
      draft = withBody(draft, reply, { skills: readSkills(json(value)) });
    else if (kind === "quotes")
      draft = withBody(draft, reply, { quotes: readStrings(json(value)) });
    else if (kind === "files")
      draft = withBody(draft, reply, { files: readStrings(json(value)) });
    else if (kind === "pastes") {
      const pills = pastesAsPills(value);
      if (pills) pastes.set(draftKeyOf(thread, reply), pills);
    } else if (kind === "replyRoot")
      draft = { ...draft, replyRoot: readRoot(value) };
    else if (kind === "selection")
      draft = { ...draft, selection: readSelection(json(value)) };
    else if (kind === "workItem")
      draft = { ...draft, workItem: readWorkItem(json(value)) };
    else if (kind === "codeRefs")
      draft = { ...draft, codeRefs: readCodeRefs(json(value)) };
    else if (kind === "scope")
      draft = { ...draft, scope: readScope(json(value)) };
    else draft = { ...draft, workspace: readWorkspace(value) };
    drafts.set(thread, draft);
  }
  for (const [draftKey, pills] of pastes) {
    const { thread, reply } = splitDraftKey(draftKey)!;
    const draft = drafts.get(thread) ?? emptyThreadDraft();
    drafts.set(
      thread,
      withBody(draft, reply, {
        text: bodyOf(draft, reply).text.trimEnd() + pills,
      }),
    );
  }
  return drafts;
}

/**
 * The record with what the old keys held on top. Both exist when an older
 * build ran after the record was written, and what it saved is newer, so the
 * old keys win wherever they hold something and the record fills in the rest.
 */
export function mergeLegacy(
  record: ThreadDraft,
  legacy: ThreadDraft,
): ThreadDraft {
  const mergeBody = (a: DraftBody, b: DraftBody): DraftBody => ({
    text: b.text || a.text,
    skills: { ...a.skills, ...b.skills },
    quotes: b.quotes.length ? b.quotes : a.quotes,
    files: b.files.length ? b.files : a.files,
  });
  const replies = { ...record.replies };
  for (const [root, body] of Object.entries(legacy.replies))
    replies[root] = mergeBody(replies[root] ?? emptyBody(), body);
  return {
    main: mergeBody(record.main, legacy.main),
    replies,
    replyRoot: legacy.replyRoot ?? record.replyRoot,
    selection: legacy.selection ?? record.selection,
    workItem: legacy.workItem ?? record.workItem,
    codeRefs: legacy.codeRefs.length ? legacy.codeRefs : record.codeRefs,
    scope: legacy.scope ?? record.scope,
    workspace: legacy.workspace ?? record.workspace,
  };
}
