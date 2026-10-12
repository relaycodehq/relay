// Unsent composer text, per computer and composer, kept on the phone so
// leaving a thread, switching computers or Android closing the app doesn't
// lose it, and shared with the computer from `draftsBridge` on
// (shared/drafts): what's typed here goes a pause later, what's typed there
// comes into the composer here. Typing goes on offline; it goes once the
// computer is back, and a clash with an edit made there meanwhile keeps the
// later one, the other a tap away. Photos stay in memory only; one can be
// over a megabyte.
import { useEffect, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  draftBody,
  draftKeyPattern,
  hasExtras,
  phoneDevice,
  reconcileDrafts,
  sameBody,
  type DraftBody,
  type DraftChange,
  type DraftDevice,
  type DraftExtras,
  type DraftWrite,
  type LocalDraft,
  type SharedDraft,
} from "../../../shared/drafts";
import { draftsBridge, type RemoteOverview } from "../../../shared/remote";
import type { RemoteClient } from "../../../shared/remote-client";

/** A composer's copy here, and how it stands with the computer's. */
interface Copy extends LocalDraft {
  /** Sent through the computer, which drops it once it's done; hidden until then. */
  leaving?: number;
  /** What a send from here took, until the computer hears it went. */
  sent?: string;
}
interface Saved {
  copies: Record<string, Copy>;
  theirs: SharedDraft[];
  /** Each project's new thread being written here. */
  slots: Record<string, string>;
  device?: string;
}

const pauseMs = 400;
/** A send through the computer has this long before its copy shows again. */
const leavingMs = 120_000;
const storageKey = (computer: string) => `relay-drafts:${computer}`;
const legacyPrefix = "relay-draft:";
/** Kept on the phone alone: a key the computer wouldn't take. */
export const scratchDraftKey = "~scratch";
const shareable = (key: string) => draftKeyPattern.test(key);

const copies = new Map<string, Map<string, Copy>>();
const theirs = new Map<string, Map<string, SharedDraft>>();
const slots = new Map<string, Record<string, string>>();
const devices = new Map<string, string>();
const loading = new Map<string, Promise<void>>();
let link: { computer: string; call: RemoteClient["call"] } | undefined;

const held = new Set<string>();
const pushing = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const id = (computer: string, key: string) => `${computer}\n${key}`;

const listeners = new Set<() => void>();
const keyListeners = new Map<string, Set<() => void>>();
let version = 0;
function changed(computer: string, key?: string) {
  version++;
  if (key) keyListeners.get(id(computer, key))?.forEach((notify) => notify());
  listeners.forEach((notify) => notify());
  persist(computer);
}

const mine = (computer: string) => {
  let map = copies.get(computer);
  if (!map) copies.set(computer, (map = new Map()));
  return map;
};
const known = (computer: string) => {
  let map = theirs.get(computer);
  if (!map) theirs.set(computer, (map = new Map()));
  return map;
};

/** Reads the computer's drafts kept here, once; earlier builds kept text alone, per thread. */
function load(computer: string) {
  let pending = loading.get(computer);
  if (pending) return pending;
  pending = (async () => {
    const raw = await AsyncStorage.getItem(storageKey(computer)).catch(() => null);
    let saved: Partial<Saved> | undefined;
    try {
      saved = raw ? JSON.parse(raw) : undefined;
    } catch {
      saved = undefined;
    }
    const map = mine(computer);
    for (const [key, copy] of Object.entries(saved?.copies ?? {}))
      if (copy && typeof copy.body?.text === "string" && !map.has(key)) map.set(key, copy);
    for (const draft of saved?.theirs ?? []) known(computer).set(draft.key, draft);
    slots.set(computer, { ...saved?.slots, ...slots.get(computer) });
    if (saved?.device && !devices.has(computer)) devices.set(computer, saved.device);
    if (!raw) await adoptLegacy(computer);
    changed(computer);
  })();
  loading.set(computer, pending);
  return pending;
}

/** The text-only drafts of builds before sharing go to the first computer opened. */
async function adoptLegacy(computer: string) {
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) =>
    k.startsWith(legacyPrefix),
  );
  if (!keys.length) return;
  const map = mine(computer);
  for (const [storage, text] of await AsyncStorage.multiGet(keys).catch(() => [] as [string, string | null][])) {
    const key = storage.slice(legacyPrefix.length);
    if (!text?.trim() || map.has(key)) continue;
    // The one new thread they kept goes to whichever project the next new thread opens on.
    map.set(key === "new-thread" ? "~new-thread" : key, { body: { text }, dirty: Date.now() });
  }
  await AsyncStorage.multiRemove(keys).catch(() => {});
}

function persist(computer: string) {
  clearTimeout(saveTimers.get(computer));
  saveTimers.set(
    computer,
    setTimeout(() => {
      saveTimers.delete(computer);
      const saved: Saved = {
        copies: Object.fromEntries(mine(computer)),
        theirs: [...known(computer).values()],
        slots: slots.get(computer) ?? {},
        ...(devices.has(computer) ? { device: devices.get(computer) } : {}),
      };
      void AsyncStorage.setItem(storageKey(computer), JSON.stringify(saved)).catch(() => {});
    }, 300),
  );
}

/** Whether a draft's writer is this phone. */
export const isThisPhone = (computer: string, device: DraftDevice) =>
  devices.has(computer) && device === phoneDevice(devices.get(computer)!);

/** Which phone this is to the computer, to tell its own drafts from another phone's. */
export function draftsDevice(computer: string, deviceId: string) {
  devices.set(computer, deviceId);
  void load(computer);
}

/** Online with a fresh overview: lines the drafts here up with the computer's. */
export async function draftsOnline(computer: string, call: RemoteClient["call"], overview: RemoteOverview) {
  await load(computer);
  if ((overview.bridge ?? 1) < draftsBridge || !overview.drafts) {
    // A computer from before sharing: drafts stay here.
    if (link?.computer === computer) link = undefined;
    return;
  }
  link = { computer, call };
  const map = mine(computer);
  known(computer).clear();
  for (const draft of overview.drafts) known(computer).set(draft.key, draft);
  const local = new Map([...map].filter(([key, copy]) => shareable(key) && !leaving(copy)));
  const plan = reconcileDrafts(local, overview.drafts);
  for (const draft of plan.take) {
    const copy = map.get(draft.key);
    if (copy && leaving(copy)) continue;
    map.set(draft.key, { body: draftBody(draft), synced: draft.rev });
    keyListeners.get(id(computer, draft.key))?.forEach((notify) => notify());
  }
  for (const key of plan.drop) {
    map.delete(key);
    keyListeners.get(id(computer, key))?.forEach((notify) => notify());
  }
  // Gone from the computer meanwhile: a send through it is done.
  for (const [key, copy] of map) if (copy.leaving && !known(computer).has(key)) map.delete(key);
  changed(computer);
  for (const key of plan.push) void push(computer, key);
}

export function draftsOffline(computer: string) {
  if (link?.computer === computer) link = undefined;
}

/** A draft changed on the computer, or on another phone. */
export function draftHeard(computer: string, { key, draft }: DraftChange) {
  if (draft) known(computer).set(key, draft);
  else known(computer).delete(key);
  const map = mine(computer);
  const copy = map.get(key);
  const busy = copy?.dirty !== undefined || held.has(id(computer, key)) || pushing.has(id(computer, key));
  if (busy || (copy && leaving(copy) && draft)) return changed(computer);
  if (!draft) map.delete(key);
  else if (!copy || copy.synced !== draft.rev) map.set(key, { body: draftBody(draft), synced: draft.rev });
  changed(computer, key);
}

const leaving = (copy: Copy) => !!copy.leaving && Date.now() - copy.leaving < leavingMs;

/** An edit here: kept at once, sent a pause later. Ignored while a send holds the composer. */
export function editDraft(computer: string, key: string, change: Partial<DraftBody>) {
  if (held.has(id(computer, key))) return;
  const map = mine(computer);
  const copy = map.get(key);
  // One on its way out shows as empty; only something new typed replaces it.
  const shown = copy && !leaving(copy) ? copy.body : { text: "" };
  const body = draftBody({ ...shown, ...change });
  if (copy && sameBody(shown, body)) return;
  if (!copy && !body.text.trim()) return;
  map.set(key, { ...copy, body, dirty: Date.now(), leaving: undefined, sent: undefined });
  changed(computer);
  schedule(computer, key);
}

function schedule(computer: string, key: string) {
  if (!shareable(key)) return;
  const at = id(computer, key);
  clearTimeout(timers.get(at));
  timers.set(
    at,
    setTimeout(() => {
      timers.delete(at);
      void push(computer, key);
    }, pauseMs),
  );
}

async function push(computer: string, key: string) {
  const at = id(computer, key);
  const to = link;
  const copy = mine(computer).get(key);
  // Offline it stays as it is, edited, and goes once the computer is back.
  if (!to || to.computer !== computer || !copy || copy.dirty === undefined || held.has(at)) return;
  if (pushing.has(at)) return schedule(computer, key);
  pushing.add(at);
  const editedAt = copy.dirty;
  const write: DraftWrite = {
    key,
    ...draftBody(copy.body),
    base: copy.synced ?? 0,
    at: editedAt,
    ...(copy.sent !== undefined ? { sent: copy.sent } : {}),
  };
  try {
    const after = await to.call("saveDraft", write);
    settle(computer, key, after, editedAt);
  } catch {
    // Still edited: the next edit or reconnect sends it.
  } finally {
    pushing.delete(at);
  }
}

/** The computer took a write: `after` is how the draft stands now. */
function settle(computer: string, key: string, after: SharedDraft | null, editedAt: number) {
  if (after) known(computer).set(key, after);
  else known(computer).delete(key);
  const map = mine(computer);
  const copy = map.get(key);
  if (!copy) return changed(computer);
  // Typed again meanwhile: the next push goes from this version.
  if (copy.dirty !== editedAt) {
    copy.synced = after?.rev ?? copy.synced;
    schedule(computer, key);
    return changed(computer);
  }
  if (!after) {
    map.delete(key);
    return changed(computer, key);
  }
  const lost = !sameBody(copy.body, after);
  map.set(key, { body: draftBody(after), synced: after.rev });
  changed(computer, lost ? key : undefined);
}

/** A send is taking the composer's text: edits wait until it went or came back. */
export function holdDraft(computer: string, key: string) {
  held.add(id(computer, key));
}
/** The send came back: the composer has its text again, as the copy still has. */
export function releaseDraft(computer: string, key: string) {
  held.delete(id(computer, key));
}
/**
 * The send went. Through the computer, it drops the draft itself once it's
 * done; otherwise this tells it the text went, so what was typed there since stays.
 */
export function draftWent(computer: string, key: string, text: string, throughComputer: boolean) {
  held.delete(id(computer, key));
  // The next new thread in its project starts a draft of its own.
  const own = slots.get(computer);
  if (own && Object.values(own).includes(key))
    slots.set(computer, Object.fromEntries(Object.entries(own).filter(([, slot]) => slot !== key)));
  const map = mine(computer);
  const copy = map.get(key);
  if (!copy) return;
  if (throughComputer) {
    // Kept until the computer drops it, in case the send comes back; the composer has moved on.
    map.set(key, { ...copy, leaving: Date.now() });
    return changed(computer);
  }
  // Never reached the computer, and can't now: nothing there to tell.
  else if (!shareable(key) || (copy.synced === undefined && link?.computer !== computer)) map.delete(key);
  else {
    map.set(key, { body: { text: "" }, synced: copy.synced, dirty: Date.now(), sent: text });
    void push(computer, key);
  }
  changed(computer, key);
}

/** Swaps in the version a clash kept, or with `drop` lets it go. */
export async function resolveOther(computer: string, key: string, drop: boolean) {
  const to = link;
  if (!to || to.computer !== computer) throw new Error("Wait for your computer to come back.");
  const at = id(computer, key);
  clearTimeout(timers.get(at));
  timers.delete(at);
  await push(computer, key);
  const after = await to.call("draftOther", key, drop);
  if (after) {
    known(computer).set(key, after);
    mine(computer).set(key, { body: draftBody(after), synced: after.rev });
  }
  changed(computer, key);
}

/** The key a project's new thread is written under here, a fresh one once the last went. */
export function newThreadDraftKey(computer: string, projectId: string): string {
  const own = slots.get(computer) ?? {};
  const kept = own[projectId];
  if (kept) return kept;
  const key = `new:${projectId}:${Date.now().toString(36)}`;
  slots.set(computer, { ...own, [projectId]: key });
  // An earlier build's one new thread goes to the first project opened.
  const legacy = mine(computer).get("~new-thread");
  if (legacy) {
    mine(computer).delete("~new-thread");
    mine(computer).set(key, { body: legacy.body, dirty: Date.now() });
    schedule(computer, key);
  }
  persist(computer);
  return key;
}
/** Opens this one for its project: one started on the computer, picked from the list. */
export function pickNewThreadDraft(computer: string, projectId: string, key: string) {
  slots.set(computer, { ...slots.get(computer), [projectId]: key });
  persist(computer);
}
/** What's typed follows the new thread to another project. */
export function moveDraft(computer: string, from: string, to: string) {
  const map = mine(computer);
  const copy = map.get(from);
  if (!copy?.body.text.trim()) return;
  const there = map.get(to)?.body.text.trim();
  editDraft(computer, to, {
    ...copy.body,
    text: there && there !== copy.body.text.trim() ? `${there}\n\n${copy.body.text.trim()}` : copy.body.text,
  });
  editDraft(computer, from, { text: "" });
}

/** What the composer shows; nothing for one on its way out through the computer. */
export function draftText(computer: string, key: string) {
  const copy = mine(computer).get(key);
  return copy && !leaving(copy) ? copy.body.text : "";
}

/** Where a new thread's draft will work, as picked here or on the computer. */
export function useDraftWorkspace(computer: string | undefined, key: string | undefined) {
  return useSyncExternalStore(subscribe, () =>
    computer && key ? (mine(computer).get(key)?.body.workspace ?? known(computer).get(key)?.workspace) : undefined,
  );
}

/** Loads `key`'s draft into the composer, keeps it saved as it changes, and follows changes from the computer. */
export function useDraft(
  computer: string | undefined,
  key: string | undefined,
  text: string,
  setText: Dispatch<SetStateAction<string>>,
) {
  const loaded = useRef<string>(undefined);
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  });
  useEffect(() => {
    if (!computer || !key) return;
    let live = true;
    const at = id(computer, key);
    void load(computer).then(() => {
      if (!live) return;
      const saved = draftText(computer, key).trim();
      // Text put in before the saved draft arrived (a queued message taken back) goes after it.
      if (saved)
        setText((typed) => (typed.trim() && typed.trim() !== saved ? `${saved}\n\n${typed.trim()}` : saved));
      loaded.current = at;
    });
    const set = keyListeners.get(at) ?? new Set();
    keyListeners.set(at, set);
    const follow = () => {
      if (loaded.current !== at) return;
      const now = draftText(computer, key);
      if (now !== latest.current) setText(now);
    };
    set.add(follow);
    return () => {
      live = false;
      set.delete(follow);
      if (!set.size) keyListeners.delete(at);
      loaded.current = undefined;
    };
  }, [computer, key, setText]);
  useEffect(() => {
    if (!computer || !key || loaded.current !== id(computer, key)) return;
    editDraft(computer, key, { text });
  }, [computer, key, text]);
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/** The computer's copy of a draft: where it started, what it holds there, a version a clash kept. */
export function useSharedDraft(computer: string | undefined, key: string | undefined): SharedDraft | undefined {
  return useSyncExternalStore(subscribe, () => (computer && key ? known(computer).get(key) : undefined));
}

/** A draft as a list shows it. */
export interface ListedDraft {
  key: string;
  text: string;
  /** Where it was started, from this phone's point of view. */
  from: "here" | "computer" | "phone";
  /** What the computer holds of it, a screenshot alone being a draft too. */
  extras?: DraftExtras;
  at: number;
}

let listed: { version: number; computer?: string; drafts: Map<string, ListedDraft> } = {
  version: -1,
  drafts: new Map(),
};
function listOf(computer: string | undefined) {
  if (listed.version === version && listed.computer === computer) return listed.drafts;
  const drafts = new Map<string, ListedDraft>();
  if (computer) {
    const me = devices.get(computer);
    const from = (origin: DraftDevice | undefined): ListedDraft["from"] =>
      !origin || (me && origin === phoneDevice(me)) ? "here" : origin === "desktop" ? "computer" : "phone";
    const there = known(computer);
    for (const [key, copy] of mine(computer)) {
      if (!shareable(key) || leaving(copy)) continue;
      const draft = there.get(key);
      const extras = draft?.extras;
      if (!copy.body.text.trim() && !hasExtras(extras)) continue;
      drafts.set(key, {
        key,
        text: copy.body.text,
        from: from(draft?.origin),
        ...(extras ? { extras } : {}),
        at: copy.dirty ?? draft?.at ?? 0,
      });
    }
  }
  listed = { version, computer, drafts };
  return drafts;
}

/** Every draft of the computer's worth listing, by key. */
export function useDrafts(computer: string | undefined): ReadonlyMap<string, ListedDraft> {
  return useSyncExternalStore(subscribe, () => listOf(computer));
}

/** The draft a thread's row shows: its main conversation's, else a side one's. */
export function threadDraft(drafts: ReadonlyMap<string, ListedDraft>, chatId: string) {
  const main = drafts.get(chatId);
  if (main) return main;
  for (const [key, draft] of drafts) if (key.startsWith(`${chatId}:`)) return draft;
}

/** A computer forgotten takes its drafts here with it. */
export function forgetDrafts(computer: string) {
  copies.delete(computer);
  theirs.delete(computer);
  slots.delete(computer);
  devices.delete(computer);
  loading.delete(computer);
  if (link?.computer === computer) link = undefined;
  clearTimeout(saveTimers.get(computer));
  saveTimers.delete(computer);
  void AsyncStorage.removeItem(storageKey(computer)).catch(() => {});
  version++;
  listeners.forEach((notify) => notify());
}
