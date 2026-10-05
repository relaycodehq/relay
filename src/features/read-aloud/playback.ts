import { useSyncExternalStore } from "react";
import type { ReadAloudEvent } from "../../../shared/read-aloud";
import { api } from "../../lib/api";

/** The one reading going on, by the key of what is read (an answer's id). */
export type Reading =
  | { key: string; status: "loading" | "playing" }
  | { key: string; status: "failed"; error: string };

/** Audio starts this far ahead of now, so its first piece isn't clipped. */
const lead = 0.06;
const errorShown = 6000;

let reading: Reading | undefined;
const listeners = new Set<() => void>();
let context: AudioContext | undefined;
let listening = false;
// Ids outlive a reload of the window, so they don't start over at 1.
let nextId = Date.now() % 1e9;
let active:
  | {
      id: number;
      key: string;
      /** The main process said everything was sent. */
      ended: boolean;
      sources: Set<AudioBufferSourceNode>;
      /** When the next piece starts, in the context's time. */
      next: number;
    }
  | undefined;
let errorTimer: ReturnType<typeof setTimeout> | undefined;

function set(next: Reading | undefined) {
  reading = next;
  clearTimeout(errorTimer);
  if (next?.status === "failed")
    errorTimer = setTimeout(() => {
      if (reading === next) set(undefined);
    }, errorShown);
  for (const listener of listeners) listener();
}

export function useReading() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reading,
  );
}

/** Reads `markdown` aloud, ending whatever was being read. */
export function startReading(key: string, markdown: string) {
  stopReading();
  if (!listening) {
    listening = true;
    api.onReadAloud(heard);
  }
  context ??= new AudioContext();
  void context.resume();
  const current = {
    id: nextId++,
    key,
    ended: false,
    sources: new Set<AudioBufferSourceNode>(),
    next: 0,
  };
  active = current;
  set({ key, status: "loading" });
  api.readAloud(current.id, markdown).catch((error: unknown) => {
    if (active === current) fail(error);
  });
}

export function stopReading() {
  const current = active;
  if (!current) return;
  active = undefined;
  void api.stopReadAloud(current.id).catch(() => {});
  for (const source of current.sources) {
    source.onended = null;
    source.stop();
  }
  set(undefined);
  void context?.suspend();
}

function heard(event: ReadAloudEvent) {
  const current = active;
  if (!current || event.id !== current.id) return;
  if (event.type === "audio") {
    play(current, event.pcm, event.sampleRate);
    if (reading?.status === "loading")
      set({ key: current.key, status: "playing" });
  } else if (event.type === "end") {
    current.ended = true;
    if (event.error) fail(event.error);
    else if (!current.sources.size) finished();
  }
}

/** Queues a piece right after the one before it, so the voice has no seams. */
function play(
  current: NonNullable<typeof active>,
  pcm: Float32Array,
  sampleRate: number,
) {
  const ctx = context!;
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  // Behind (the voice came slower than it plays): pick up from now.
  const at = Math.max(current.next, ctx.currentTime + lead);
  source.start(at);
  current.next = at + buffer.duration;
  current.sources.add(source);
  source.onended = () => {
    current.sources.delete(source);
    if (active === current && current.ended && !current.sources.size)
      finished();
  };
}

function finished() {
  active = undefined;
  set(undefined);
  void context?.suspend();
}

function fail(error: unknown) {
  const key = active?.key;
  stopReading();
  if (key === undefined) return;
  set({
    key,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  });
}
