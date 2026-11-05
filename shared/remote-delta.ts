/**
 * What changed since the last frame a phone got, so a streaming answer sends
 * its new words and calls instead of the whole answer every update, and a
 * thread list the threads that moved instead of all of them. Measured on the
 * 15 longest real answers: 69 KB per streaming frame whole, 1.4 KB as patches.
 * Both ends keep the last version per connection; see shared/remote-client
 * and electron/remote/link-sender.
 */
import type { ChatMessage } from "./projects";
import type { RemoteChatSummary } from "./remote";

/** Entries that differ from the last version, by index, and how long the list is now. */
export interface ListPatch<T> {
  length: number;
  items: [number, T][];
}

export interface MessagePatch {
  id: string;
  /** Fields that changed; those in `unset` went. */
  set?: Partial<ChatMessage>;
  unset?: (keyof ChatMessage)[];
  /** The body keeps its first `from` characters and goes on with `text`. */
  body?: { from: number; text: string };
  trace?: ListPatch<NonNullable<ChatMessage["trace"]>[number]>;
  activity?: ListPatch<NonNullable<ChatMessage["activity"]>[number]>;
}

export interface ChatsPatch {
  set: RemoteChatSummary[];
  remove: string[];
}

/**
 * Whether two JSON-like values hold the same data. Walks them instead of
 * serializing both: a streaming answer compares every step of its trace
 * each update, and two JSON.stringify calls a step cost more than sending
 * the answer whole.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  const was = a as Record<string, unknown>;
  const now = b as Record<string, unknown>;
  let keys = 0;
  for (const key in was) {
    if (!Object.hasOwn(now, key) || !same(was[key], now[key])) return false;
    keys++;
  }
  for (const _ in now) keys--;
  return keys === 0;
}

function listPatch<T>(was: readonly T[] = [], now: readonly T[]): ListPatch<T> {
  const items: [number, T][] = [];
  now.forEach((item, i) => {
    if (i >= was.length || !same(was[i], item)) items.push([i, item]);
  });
  return { length: now.length, items };
}

function applyList<T>(was: readonly T[] = [], patch: ListPatch<T>) {
  const list = was.slice(0, patch.length);
  for (const [i, item] of patch.items) list[i] = item;
  return list;
}

/** `next` as a patch on `prev`, the same message a moment earlier. */
export function diffMessage(
  prev: ChatMessage,
  next: ChatMessage,
): MessagePatch {
  const patch: MessagePatch = { id: next.id };
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<
    keyof ChatMessage
  >;
  for (const key of keys) {
    if (key === "body" || key === "trace" || key === "activity") continue;
    if (!(key in next)) (patch.unset ??= []).push(key);
    else if (!same(prev[key], next[key]))
      (patch.set ??= {})[key] = next[key] as never;
  }
  if (prev.body !== next.body) {
    let from = 0;
    // A streaming answer nearly always just grows: skip the scan then. A
    // slice compares natively, many times faster than startsWith or the loop.
    if (next.body.slice(0, prev.body.length) === prev.body)
      from = prev.body.length;
    const max = Math.min(prev.body.length, next.body.length);
    while (
      from < max &&
      prev.body.charCodeAt(from) === next.body.charCodeAt(from)
    )
      from++;
    // JSON readers such as Swift's reject a suffix starting with half an emoji.
    // Keep the UTF-16 offset, but start the replacement before the whole pair.
    if (
      from > 0 &&
      from < next.body.length &&
      next.body.charCodeAt(from - 1) >= 0xd800 &&
      next.body.charCodeAt(from - 1) <= 0xdbff &&
      next.body.charCodeAt(from) >= 0xdc00 &&
      next.body.charCodeAt(from) <= 0xdfff
    )
      from--;
    patch.body = { from, text: next.body.slice(from) };
  }
  for (const key of ["trace", "activity"] as const) {
    if (!next[key]) {
      if (prev[key]) (patch.unset ??= []).push(key);
    } else {
      const list = listPatch<unknown>(prev[key], next[key]);
      if (list.items.length || list.length !== prev[key]?.length)
        patch[key] = list as never;
    }
  }
  return patch;
}

export function applyMessagePatch(
  prev: ChatMessage,
  patch: MessagePatch,
): ChatMessage {
  const next = { ...prev, ...patch.set } as ChatMessage;
  for (const key of patch.unset ?? []) delete next[key];
  if (patch.body)
    next.body = prev.body.slice(0, patch.body.from) + patch.body.text;
  if (patch.trace) next.trace = applyList(prev.trace, patch.trace);
  if (patch.activity) next.activity = applyList(prev.activity, patch.activity);
  return next;
}

/** The order both ends keep a thread list in, so a patch needn't carry it. */
export const chatOrder = (a: RemoteChatSummary, b: RemoteChatSummary) =>
  b.updated - a.updated || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function diffChats(
  prev: readonly RemoteChatSummary[],
  next: readonly RemoteChatSummary[],
): ChatsPatch {
  const was = new Map(prev.map((c) => [c.id, c]));
  const ids = new Set(next.map((c) => c.id));
  return {
    set: next.filter((c) => !same(was.get(c.id), c)),
    remove: prev.flatMap((c) => (ids.has(c.id) ? [] : [c.id])),
  };
}

export function applyChatsPatch(
  prev: readonly RemoteChatSummary[],
  patch: ChatsPatch,
): RemoteChatSummary[] {
  const chats = new Map(prev.map((c) => [c.id, c]));
  for (const id of patch.remove) chats.delete(id);
  for (const c of patch.set) chats.set(c.id, c);
  return [...chats.values()].sort(chatOrder);
}
