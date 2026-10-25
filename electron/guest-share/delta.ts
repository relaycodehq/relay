import { createHash } from "node:crypto";
import type {
  GuestDelta,
  GuestMessage,
  GuestPageView,
} from "../../shared/guest-share";

/** What a guest's page already holds, by a hash of each part. */
export interface GuestBaseline {
  messages: Map<string, string>;
  order: string;
  files: string;
  suggestions: string;
  title: string;
  running: boolean;
}

const hash = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value)).digest("base64url");

// A snapshot's messages are the same objects for every guest and every tick
// until the thread changes, so each is hashed once.
const messageHashes = new WeakMap<GuestMessage, string>();

function messageHash(m: GuestMessage) {
  let known = messageHashes.get(m);
  if (known === undefined) messageHashes.set(m, (known = hash(m)));
  return known;
}

export function baselineOf(view: GuestPageView): GuestBaseline {
  return {
    messages: new Map(view.messages.map((m) => [m.id, messageHash(m)])),
    order: view.messages.map((m) => m.id).join(),
    files: hash(view.files),
    suggestions: hash(view.suggestions),
    title: view.title,
    running: view.running,
  };
}

/** A short name for a baseline, the same for the same page. */
export const baselineKey = (baseline: GuestBaseline) =>
  hash({ ...baseline, messages: [...baseline.messages] }).slice(0, 16);

/**
 * What changed on a guest's page since `before`: only the messages that are
 * new or different, so a streaming answer sends its own text and not the
 * whole thread again. Undefined when nothing did.
 */
export function guestDelta(
  before: GuestBaseline,
  view: GuestPageView,
): { delta: GuestDelta; after: GuestBaseline } | undefined {
  const after = baselineOf(view);
  const messages = view.messages.filter(
    (m) => before.messages.get(m.id) !== after.messages.get(m.id),
  );
  const filesChanged = before.files !== after.files;
  const suggestionsChanged = before.suggestions !== after.suggestions;
  const unchanged =
    !messages.length &&
    !filesChanged &&
    !suggestionsChanged &&
    before.order === after.order &&
    before.title === after.title &&
    before.running === after.running;
  if (unchanged) return undefined;
  return {
    delta: {
      title: view.title,
      running: view.running,
      order: view.messages.map((m) => m.id),
      messages,
      ...(filesChanged ? { files: view.files } : {}),
      ...(suggestionsChanged ? { suggestions: view.suggestions } : {}),
    },
    after,
  };
}

export const emptyBaseline = (): GuestBaseline => ({
  messages: new Map(),
  order: "",
  files: "",
  suggestions: "",
  title: "",
  running: false,
});
