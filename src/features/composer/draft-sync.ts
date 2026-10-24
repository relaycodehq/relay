// This window's half of the drafts its computer shares with phones (see
// shared/drafts): what's typed here goes to the main process a pause after
// the typing, and what changed elsewhere comes into the composers here. The
// composers keep reading and writing their own storage; this sits beside it.
import { useSyncExternalStore } from "react";
import { api } from "../../lib/api";
import {
  loadThreadDraft,
  localOnlyRecord,
  onThreadRecord,
  threadRecordIds,
} from "../../lib/thread-storage";
import { DRAFT_PREFIX, bodyOf, type ThreadDraft } from "../../lib/thread-draft";
import { attachedImages } from "../../../shared/image-refs";
import {
  draftBody,
  draftThread,
  hasExtras,
  reconcileDrafts,
  sameBody,
  type DraftBody,
  type DraftChange,
  type DraftExtras,
  type DraftWrite,
  type LocalDraft,
  type SharedDraft,
} from "../../../shared/drafts";
import {
  readDraftImageMetadata,
  onDraftImageMetadata,
  onDraftImagesSaved,
  type DraftImageMetadata,
} from "../images/draft-images";
import {
  draftSentAt,
  draftTaken,
  forgetNewThread,
  markDraftSent,
  setDraftBody,
} from "./drafts";

/** A composer's storage key for a shared draft key, and back. */
const composerKey = (key: string) => DRAFT_PREFIX + key;
const sharedKey = (composer: string) => composer.slice(DRAFT_PREFIX.length);
/** The thread record a draft key lives in. */
const recordOf = (key: string) =>
  key.startsWith("new:") ? key : key.split(":")[0];

const pauseMs = 400;
/** A send marks its thread this long before the composer empties. */
const sentWithinMs = 10_000;
const retryMs = 5_000;

/** The computer's copy of each draft, as last heard. */
const shared = new Map<string, SharedDraft>();
const sharedListeners = new Set<() => void>();
const tellShared = () => sharedListeners.forEach((notify) => notify());

// The rev each key last matched and whether it changed here since, in
// storage: thread windows share it, and a quit mid-pause pushes on next start.
const META = "relay-draft-sync";
type Meta = Record<string, { rev?: number; dirty?: number }>;
let metaRead: { raw: string | null; meta: Meta } = { raw: null, meta: {} };
function meta(): Meta {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(META);
  } catch {
    // Storage is a convenience here.
  }
  if (raw === metaRead.raw) return metaRead.meta;
  let parsed: Meta = {};
  try {
    const value: unknown = raw && JSON.parse(raw);
    if (value && typeof value === "object") parsed = value as Meta;
  } catch {
    // A malformed record starts over: every draft is pushed or taken again.
  }
  metaRead = { raw, meta: parsed };
  return parsed;
}
function setMeta(key: string, entry: { rev?: number; dirty?: number } | null) {
  const next = { ...meta() };
  if (entry && (entry.rev !== undefined || entry.dirty !== undefined))
    next[key] = entry;
  else delete next[key];
  try {
    localStorage.setItem(META, JSON.stringify(next));
  } catch {
    // Unsaved, the next start compares again.
  }
}

/** What this window last pushed or took for each key, to tell a change from none. */
const pushed = new Map<string, { body: DraftBody; extras?: DraftExtras }>();
/** Each composer's screenshots by token number, as last read. */
const images = new Map<string, (number | undefined)[]>();
/** Threads with edits waiting out the pause. */
const waiting = new Map<string, ReturnType<typeof setTimeout>>();
/** Threads whose push is on its way. */
const inFlight = new Set<string>();
// Set while this window writes what came from elsewhere, so it isn't pushed back.
let applying = false;
let started = false;
/** Live changes received while the initial draft snapshot is on its way. */
let catchingUp: Set<string> | undefined;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function compact(extras: DraftExtras): DraftExtras | undefined {
  const kept = Object.fromEntries(
    Object.entries(extras).filter(([, v]) => v !== undefined),
  ) as DraftExtras;
  return hasExtras(kept) ? kept : undefined;
}

/** A thread record's composers, as shared keys, with what each holds. */
function localOf(thread: string): Map<string, LocalDraft> {
  const record = loadThreadDraft(thread);
  const fresh = thread.startsWith("new:");
  const out = new Map<string, LocalDraft>();
  const entry = (key: string, reply?: string) => {
    const body = bodyOf(record, reply);
    const shots = attachedImages(
      body.text,
      (images.get(composerKey(key)) ?? []).map((n) => ({ n })),
    ).map((i) => i.n ?? 0);
    const all = compact({
      screenshots: shots.length ? shots : undefined,
      ...(reply ? {} : mainExtras(record, fresh)),
    });
    // As Activity counts drafts: a scope or a selected line alone is none.
    const extras =
      body.text.trim() || all?.screenshots || all?.links ? all : undefined;
    out.set(key, {
      body: draftBody({
        ...body,
        ...(fresh && !reply && record.workspace
          ? { workspace: record.workspace }
          : {}),
      }),
      ...(extras ? { extras } : {}),
      ...syncState(key),
    });
  };
  entry(thread);
  for (const root of Object.keys(record.replies))
    entry(`${thread}:${root}`, root);
  return out;
}

function mainExtras(record: ThreadDraft, fresh: boolean): DraftExtras {
  return {
    codeRefs: record.codeRefs.length || undefined,
    selection: record.selection ? true : undefined,
    workItem: record.workItem ? true : undefined,
    links: record.links?.length || undefined,
    ...(fresh
      ? {
          scope:
            record.scope && record.scope.kind !== "project"
              ? record.scope.kind
              : undefined,
          branch: record.branch ? true : undefined,
          start: record.start ? true : undefined,
        }
      : {}),
  };
}

function syncState(key: string) {
  const entry = meta()[key];
  return {
    ...(entry?.rev !== undefined ? { synced: entry.rev } : {}),
    ...(entry?.dirty !== undefined ? { dirty: entry.dirty } : {}),
  };
}

/** Waits out the pause after an edit, then pushes what changed. */
function schedule(thread: string) {
  if (applying || localOnlyRecord(thread)) return;
  clearTimeout(waiting.get(thread));
  waiting.set(
    thread,
    setTimeout(() => {
      waiting.delete(thread);
      void flush(thread);
    }, pauseMs),
  );
}

/** The writes a thread's edits make: one per composer that changed. */
function changesOf(thread: string): DraftWrite[] {
  const local = localOf(thread);
  const keys = new Set(local.keys());
  for (const key of [...pushed.keys(), ...shared.keys()])
    if (recordOf(key) === thread) keys.add(key);
  const writes: DraftWrite[] = [];
  for (const key of keys) {
    const now = local.get(key) ?? { body: { text: "" } };
    const theirs = shared.get(key);
    const before =
      pushed.get(key) ??
      (theirs ? { body: draftBody(theirs), extras: theirs.extras } : undefined);
    const empty = !now.body.text.trim() && !hasExtras(now.extras);
    if (
      before
        ? sameBody(before.body, now.body) && same(before.extras, now.extras)
        : empty
    )
      continue;
    const chat = draftThread(key);
    const sentAt = chat && !chat.root ? draftSentAt(chat.chatId) : undefined;
    const sent =
      !!before?.body.text.trim() &&
      !now.body.text.trim() &&
      sentAt !== undefined &&
      Date.now() - sentAt < sentWithinMs;
    writes.push({
      key,
      ...now.body,
      base: meta()[key]?.rev ?? 0,
      at: Date.now(),
      ...(now.extras ? { extras: now.extras } : {}),
      ...(sent ? { sent: before!.body.text } : {}),
    });
  }
  return writes;
}

async function flush(thread: string) {
  if (inFlight.has(thread)) return schedule(thread);
  const writes = changesOf(thread);
  if (!writes.length) return;
  inFlight.add(thread);
  const at = Date.now();
  for (const write of writes) {
    setMeta(write.key, { rev: meta()[write.key]?.rev, dirty: at });
    pushed.set(write.key, {
      body: draftBody(write),
      ...(write.extras ? { extras: write.extras } : {}),
    });
  }
  try {
    const after = await api.writeSharedDrafts(writes);
    writes.forEach((write, i) => settle(write.key, after[i] ?? null));
  } catch (e) {
    console.warn("Couldn't share a draft with the computer:", e);
    setTimeout(() => schedule(thread), retryMs);
  } finally {
    inFlight.delete(thread);
  }
}

/** The computer took this window's write: `draft` is how it stands now. */
function settle(key: string, draft: SharedDraft | null) {
  remember(key, draft);
  // Typed again meanwhile: that push settles it next.
  if (waiting.has(recordOf(key))) {
    setMeta(key, { rev: draft?.rev, dirty: meta()[key]?.dirty });
    return;
  }
  setMeta(key, draft ? { rev: draft.rev } : null);
  // A clash went the other way, or what went left something behind.
  const mine = pushed.get(key);
  if (draft ? !mine || !sameBody(mine.body, draft) : mine?.body.text.trim())
    apply(key, draft, false);
  else pushed.set(key, draft ? kept(draft) : { body: { text: "" } });
}

const kept = (draft: SharedDraft) => ({
  body: draftBody(draft),
  ...(draft.extras ? { extras: draft.extras } : {}),
});

function remember(key: string, draft: SharedDraft | null) {
  catchingUp?.add(key);
  if (draft) shared.set(key, draft);
  else shared.delete(key);
  tellShared();
}

/** Something changed elsewhere: another window, a phone. Only the main window puts it in storage. */
function heard({ key, draft, sent }: DraftChange, takes: boolean) {
  const thread = recordOf(key);
  // Sent from elsewhere: what composers here hold of it went too.
  const taken = sent && !draft && !waiting.has(thread) && !inFlight.has(thread);
  const known = meta()[key];
  remember(key, draft);
  if (takes) take(key, draft, !!sent, known);
  if (taken) draftTaken(thread);
}

function take(
  key: string,
  draft: SharedDraft | null,
  sent: boolean,
  known: Meta[string] | undefined,
) {
  // This window's own, or older than what it has.
  if (draft && known?.rev !== undefined && known.rev >= draft.rev) return;
  if (!draft && known === undefined && !pushed.get(key)?.body.text.trim())
    return;
  // Edited here meanwhile: that push settles it, clash or not.
  if (known?.dirty !== undefined || waiting.has(recordOf(key))) return;
  apply(key, draft, sent);
}

/** Puts the computer's copy in the composer, as if it had been typed here. */
function apply(key: string, draft: SharedDraft | null, sent: boolean) {
  const composer = composerKey(key);
  const chat = draftThread(key);
  applying = true;
  try {
    if (draft)
      setDraftBody(
        composer,
        {
          text: draft.text,
          skills: draft.skills ?? {},
          quotes: draft.quotes ?? [],
          files: draft.files ?? [],
        },
        key.startsWith("new:") ? (draft.workspace ?? null) : undefined,
      );
    else {
      if (sent && chat && !chat.root) markDraftSent(chat.chatId);
      setDraftBody(composer, { text: "", skills: {}, quotes: [], files: [] });
      if (sent && key.startsWith("new:")) forgetNewThread(key);
    }
  } finally {
    applying = false;
  }
  setMeta(key, draft ? { rev: draft.rev } : null);
  pushed.set(key, draft ? kept(draft) : { body: { text: "" } });
  // What only this window knows changed with the text: a token gone takes its screenshot out.
  const extras = localOf(recordOf(key)).get(key)?.extras;
  if (!same(extras, draft?.extras ?? undefined) && (draft || hasExtras(extras)))
    schedule(recordOf(key));
}

function readImages(key: string, saved: DraftImageMetadata | undefined) {
  if (saved?.numbers.length) images.set(key, saved.numbers);
  else images.delete(key);
}

/**
 * Starts sharing this window's drafts; `takes` is for the main window, which
 * also puts what changed elsewhere into storage. Thread windows share that
 * storage, so they hear it from there.
 */
export function startDraftSync({ takes }: { takes: boolean }) {
  // A dev reload ahead of a restart runs this page on the old preload, which can't share.
  if (started || !api.onSharedDraft) return;
  started = true;
  onThreadRecord(schedule);
  // Another window pushes its own; this one only needs the numbers.
  onDraftImageMetadata(readImages);
  onDraftImagesSaved((key) => {
    if (key.startsWith(DRAFT_PREFIX)) schedule(recordOf(sharedKey(key)));
  });
  api.onSharedDraft((change) => heard(change, takes));
  // Mid-pause on the way out: the next start pushes it.
  window.addEventListener("beforeunload", () => {
    for (const thread of waiting.keys())
      for (const write of changesOf(thread))
        setMeta(write.key, { rev: meta()[write.key]?.rev, dirty: Date.now() });
  });
  const lineUp = (retry: boolean) => {
    void catchUp(takes).catch((e) => {
      console.warn("Couldn't read the computer's drafts:", e);
      // A failed screenshot read must not masquerade as an empty draft.
      // Try startup once more, including a fresh computer snapshot.
      if (retry) setTimeout(() => lineUp(false), retryMs);
    });
  };
  lineUp(true);
}

/** Lines this window's drafts up with the computer's, as Relay starts. */
async function catchUp(takes: boolean) {
  const changed = (catchingUp = new Set<string>());
  try {
    const metadata = await readDraftImageMetadata();
    for (const [key, value] of metadata) readImages(key, value);
    const keys = [...metadata.keys()];
    const list = await api.sharedDrafts();
    // The snapshot can predate a write or live event received while awaiting it.
    // Keep those changes, including removals, rather than restoring the old copy.
    for (const draft of list)
      if (!changed.has(draft.key)) shared.set(draft.key, draft);
    tellShared();
    if (!takes) return;
    const threads = new Set([
      ...threadRecordIds(),
      ...keys
        .filter((k) => k.startsWith(DRAFT_PREFIX))
        .map((k) => recordOf(sharedKey(k))),
      ...Object.keys(meta()).map(recordOf),
    ]);
    const local = new Map<string, LocalDraft>();
    for (const thread of threads)
      if (!localOnlyRecord(thread))
        for (const [key, draft] of localOf(thread)) local.set(key, draft);
    // Gone from storage altogether, it still was synced.
    for (const key of Object.keys(meta()))
      if (!local.has(key))
        local.set(key, { body: { text: "" }, ...syncState(key) });
    const plan = reconcileDrafts(local, [...shared.values()]);
    for (const draft of plan.take) apply(draft.key, draft, false);
    for (const key of plan.drop) apply(key, null, false);
    const taken = new Set([...plan.take.map((d) => d.key), ...plan.drop]);
    for (const [key, mine] of local)
      if (
        !taken.has(key) &&
        mine.synced !== undefined &&
        mine.dirty === undefined
      )
        pushed.set(key, {
          body: mine.body,
          ...(mine.extras ? { extras: mine.extras } : {}),
        });
    for (const thread of new Set(plan.push.map(recordOf))) void flush(thread);
  } finally {
    catchingUp = undefined;
  }
}

const subscribe = (notify: () => void) => {
  sharedListeners.add(notify);
  return () => void sharedListeners.delete(notify);
};

/** The computer's copy of a composer's draft, by the composer's storage key. */
export const useSharedDraft = (composer: string): SharedDraft | undefined =>
  useSyncExternalStore(subscribe, () => shared.get(sharedKey(composer)));

/**
 * Swaps in the version a clash kept, or with `drop` lets it go, once this
 * window's own edits are in.
 */
export async function resolveOther(composer: string, drop: boolean) {
  const key = sharedKey(composer);
  const thread = recordOf(key);
  clearTimeout(waiting.get(thread));
  waiting.delete(thread);
  await flush(thread);
  const draft = await api.sharedDraftOther(key, drop);
  remember(key, draft);
  apply(key, draft, false);
}

/**
 * Runs `change` without pushing what it writes: a send through this page
 * clears what it held, and the computer drops the draft itself.
 */
export async function quietly<T>(change: () => Promise<T>): Promise<T> {
  applying = true;
  try {
    return await change();
  } finally {
    applying = false;
  }
}
