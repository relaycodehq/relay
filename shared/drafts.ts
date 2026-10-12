import { z } from "zod";
import { chatWorkspaceSchema, type ChatWorkspace } from "./projects";

/**
 * Unsent drafts, one per composer, shared by every screen of one computer:
 * its own windows and its paired phones. The computer keeps them (Relay's
 * main process, electron/drafts) and tells the others of each change; each
 * screen types into its own copy and sends what it changed, naming the
 * version it changed. Two edits from the same version clash: the later one
 * wins and the other is kept on the draft, a tap away.
 *
 * Keys are the composer's: a thread's id, `<thread>:<reply root>` for a side
 * conversation, `new:<project>[:<slot>]` for one not started yet.
 */

/** This computer's own windows, or a paired phone by its device id. */
export type DraftDevice = "desktop" | `phone:${string}`;
export const phoneDevice = (deviceId: string): DraftDevice =>
  `phone:${deviceId}`;

/** A composer's text, and what makes the desktop's pills in it. */
export interface DraftBody {
  text: string;
  /** Each skill token's label. */
  skills?: Record<string, string>;
  quotes?: string[];
  files?: string[];
  /** Where a new thread will work, when picked for it. */
  workspace?: ChatWorkspace;
}

/**
 * What only the computer's composer holds of a draft. A phone shows that it's
 * there, and while any is, the phone's send goes through the computer, which
 * adds it.
 */
export interface DraftExtras {
  /** Its screenshots, by their `[Image #n]` token; 0 for one without. */
  screenshots?: number[];
  codeRefs?: number;
  selection?: true;
  workItem?: true;
  links?: number;
  /** A new thread written for a pull request or a review, not the repository. */
  scope?: "pr" | "review";
  /** A new thread's own branch name. */
  branch?: true;
}

export interface SharedDraft extends DraftBody {
  key: string;
  /** Bumped by every change the computer takes; a write names the one it was edited from. */
  rev: number;
  /** When it was last edited, on the clock of whoever edited it. */
  at: number;
  by: DraftDevice;
  /** Where it was started. */
  origin: DraftDevice;
  extras?: DraftExtras;
  /** What a clash replaced, until it's used or dropped. */
  other?: { text: string; by: DraftDevice; at: number };
}

export interface DraftWrite extends DraftBody {
  key: string;
  /** The rev it was edited from; 0 for a draft the writer hadn't seen. */
  base: number;
  at: number;
  /** The computer's own; a phone's write leaves them as they are. */
  extras?: DraftExtras;
  /** Emptied because this text went out, not cleared away. */
  sent?: string;
}

/** A change pushed to every screen; `draft` is null once it's gone. */
export interface DraftChange {
  key: string;
  draft: SharedDraft | null;
  /** It went out, from wherever. */
  sent?: true;
}

const id = "[A-Za-z0-9_-]{1,80}";
export const draftKeyPattern = new RegExp(
  `^(?:${id}(?::${id})?|new:${id}(?::[a-z0-9]{1,16})?)$`,
);
export const draftKeySchema = z.string().regex(draftKeyPattern);
/** Pastes keep a draft long; this is what fits a sent message and then some. */
export const maxDraftText = 200_000;
const deviceSchema = z.union([
  z.literal("desktop"),
  z.string().regex(/^phone:[A-Za-z0-9_-]{1,80}$/),
]) as z.ZodType<DraftDevice>;
const short = z.string().max(maxDraftText);
const extrasSchema = z
  .object({
    screenshots: z.array(z.number().int().min(0).max(999)).max(20).optional(),
    codeRefs: z.number().int().min(1).max(1000).optional(),
    selection: z.literal(true).optional(),
    workItem: z.literal(true).optional(),
    links: z.number().int().min(1).max(1000).optional(),
    scope: z.enum(["pr", "review"]).optional(),
    branch: z.literal(true).optional(),
  })
  .strict();
const bodyShape = {
  text: short,
  skills: z.record(z.string().max(200), z.string().max(200)).optional(),
  quotes: z.array(short).max(100).optional(),
  files: z.array(z.string().max(4096)).max(500).optional(),
  workspace: chatWorkspaceSchema.optional(),
};
export const draftWriteSchema = z
  .object({
    key: draftKeySchema,
    ...bodyShape,
    base: z.number().int().min(0),
    at: z.number().int().min(0),
    extras: extrasSchema.optional(),
    sent: short.optional(),
  })
  .strict();
export const sharedDraftSchema = z
  .object({
    key: draftKeySchema,
    ...bodyShape,
    rev: z.number().int().min(1),
    at: z.number().int().min(0),
    by: deviceSchema,
    origin: deviceSchema,
    extras: extrasSchema.optional(),
    other: z
      .object({ text: short, by: deviceSchema, at: z.number().int().min(0) })
      .strict()
      .optional(),
  })
  .strict();

/** The project of an unsent thread's draft. */
export const newDraftProject = (key: string) =>
  /^new:([^:]+)(?::[^:]+)?$/.exec(key)?.[1];
/** The thread a draft is in, and the side conversation if it's a reply's. */
export function draftThread(key: string) {
  if (key.startsWith("new:")) return undefined;
  const [chatId, root] = key.split(":");
  return { chatId, root };
}

export const hasExtras = (extras: DraftExtras | undefined) =>
  !!extras && Object.keys(extras).length > 0;

/** The parts of a draft every screen carries, set apart from what the store adds. */
export function draftBody(from: DraftBody): DraftBody {
  return {
    text: from.text,
    ...(from.skills && Object.keys(from.skills).length
      ? { skills: from.skills }
      : {}),
    ...(from.quotes?.length ? { quotes: from.quotes } : {}),
    ...(from.files?.length ? { files: from.files } : {}),
    ...(from.workspace ? { workspace: from.workspace } : {}),
  };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const sameBody = (a: DraftBody, b: DraftBody) =>
  same(draftBody(a), draftBody(b));

/** Nothing typed and nothing held: no draft at all. */
const emptied = (body: DraftBody, extras: DraftExtras | undefined) =>
  !body.text.trim() && !hasExtras(extras);

/** The draft once `sent` went: what was typed after it stays, a rewrite stays whole. */
export function unsent(draft: string, sent: string) {
  const now = draft.trim();
  return now.startsWith(sent) ? now.slice(sent.length).trim() : draft;
}

/**
 * The draft as `write`, from `by`, leaves it; `rev` hands out the next rev.
 * Null when there's none left. `changed` is false when nothing moved, so
 * nobody needs telling.
 */
export function applyDraftWrite(
  current: SharedDraft | undefined,
  write: DraftWrite,
  by: DraftDevice,
  rev: () => number,
): { draft: SharedDraft | null; changed: boolean } {
  const body = draftBody(write);
  const extras =
    by === "desktop" ? compactExtras(write.extras) : current?.extras;
  const stale = !!current && write.base < current.rev;
  const make = (
    from: DraftBody,
    other: SharedDraft["other"],
    at = write.at,
    who = by,
  ): { draft: SharedDraft | null; changed: boolean } => {
    if (emptied(from, extras)) return { draft: null, changed: !!current };
    const next: SharedDraft = {
      key: write.key,
      ...draftBody(from),
      rev: 0,
      at,
      by: who,
      origin: current?.origin ?? by,
      ...(extras ? { extras } : {}),
      ...(other ? { other } : {}),
    };
    if (
      current &&
      sameBody(current, next) &&
      same(current.extras, next.extras) &&
      same(current.other, next.other)
    )
      return { draft: current, changed: false };
    return { draft: { ...next, rev: rev() }, changed: true };
  };
  if (write.sent !== undefined) {
    if (!stale) return make({ ...body, text: "" }, undefined);
    // Edited elsewhere after the version that went: what's new stays.
    const left = unsent(current.text, write.sent.trim());
    return make({ ...draftBody(current), text: left }, undefined, current.at);
  }
  if (!stale) return make(body, current?.other);
  if (sameBody(current, body))
    return make(current, current.other, current.at, current.by);
  // A clear never beats an edit it didn't see.
  if (!body.text.trim()) return make(current, current.other, current.at, current.by);
  if (write.at >= current.at)
    return make(body, { text: current.text, by: current.by, at: current.at });
  return make(
    current,
    { text: write.text, by, at: write.at },
    current.at,
    current.by,
  );
}

/** Swaps the draft's text with the version a clash replaced. */
export function swapOtherDraft(
  current: SharedDraft,
  rev: number,
): SharedDraft {
  if (!current.other) return current;
  return {
    ...current,
    text: current.other.text,
    other: { text: current.text, by: current.by, at: current.at },
    by: current.other.by,
    at: current.other.at,
    rev,
  };
}

export function dropOtherDraft(
  current: SharedDraft,
  rev: number,
): SharedDraft {
  const { other: _, ...rest } = current;
  return { ...rest, rev };
}

function compactExtras(extras: DraftExtras | undefined) {
  if (!extras) return undefined;
  const kept = Object.fromEntries(
    Object.entries(extras).filter(
      ([, v]) => v !== undefined && !(Array.isArray(v) && !v.length),
    ),
  ) as DraftExtras;
  return hasExtras(kept) ? kept : undefined;
}

/** A screen's copy of a draft, and how it stands with the computer's. */
export interface LocalDraft {
  body: DraftBody;
  /** The desktop's, which count as a draft without any text. */
  extras?: DraftExtras;
  /** The computer's rev it last matched. */
  synced?: number;
  /** When it was edited here without the computer taking it yet. */
  dirty?: number;
}

/**
 * What a screen does once it hears the computer's drafts, on start or on
 * reconnecting: `take` the computer's copy, `drop` its own once the computer
 * no longer has it (sent or cleared elsewhere), and `push` what changed here
 * meanwhile or never went.
 */
export function reconcileDrafts(
  local: ReadonlyMap<string, LocalDraft>,
  shared: readonly SharedDraft[],
): { take: SharedDraft[]; drop: string[]; push: string[] } {
  const take: SharedDraft[] = [],
    drop: string[] = [],
    push: string[] = [];
  const theirs = new Map(shared.map((d) => [d.key, d]));
  for (const [key, mine] of local) {
    const draft = theirs.get(key);
    const typed = !emptied(mine.body, mine.extras);
    if (mine.dirty !== undefined || (mine.synced === undefined && typed && !draft))
      push.push(key);
    else if (draft && mine.synced !== draft.rev) {
      // Never synced, but there: the same thing typed on both is no clash.
      if (mine.synced === undefined && typed && !sameBody(mine.body, draft))
        push.push(key);
      else take.push(draft);
    } else if (!draft && mine.synced !== undefined) drop.push(key);
  }
  for (const draft of shared) if (!local.has(draft.key)) take.push(draft);
  return { take, drop, push };
}

/** "2 screenshots, a code reference and a selected line", for a phone to say what stays on the computer. */
export function extrasSummary(extras: DraftExtras | undefined): string {
  if (!extras) return "";
  const count = (n: number, one: string, many = one + "s") =>
    n === 1 ? `a ${one}` : `${n} ${many}`;
  const parts = [
    extras.screenshots?.length && count(extras.screenshots.length, "screenshot"),
    extras.codeRefs && count(extras.codeRefs, "code reference"),
    extras.selection && "a selected line",
    extras.workItem && "a work item",
    extras.links && count(extras.links, "linked folder"),
    extras.scope === "pr" && "a pull request",
    extras.scope === "review" && "a review",
    extras.branch && "a branch name",
  ].filter((p): p is string => !!p);
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * A phone's send of a draft the desktop holds part of, for the desktop's
 * composer to add its part to and send; `chatId` is missing for a new thread.
 */
export interface HeldSend {
  id: string;
  key: string;
  chatId?: string;
  send: import("./projects").ProjectChatSend;
}
export type HeldSendResult = { chatId: string } | { error: string };
