// Dictation on the phone: its microphone, the paired desktop's speech engine.
// The audio goes over the encrypted link in 80 ms chunks, and each chunk's
// answer carries the words heard so far, as the desktop's composer shows them.
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { RemoteClient } from "../../../shared/remote-client";
import type { PhoneDictationHeard } from "../../../shared/remote";

/** modules/relay-mic; missing in Expo Go, on iOS, and in APKs from before dictation. */
interface RelayMic {
  getPermission(): Promise<{ granted: boolean }>;
  /** Opens Android's prompt, which sends the app to the background for a moment. */
  requestPermission(): Promise<{ granted: boolean }>;
  start(): Promise<void>;
  /** Resolves with how many chunks went out in all, the last one included. */
  stop(): Promise<number>;
  addListener(
    event: "onAudio",
    listener: (chunk: { pcm: string; power: number }) => void,
  ): { remove(): void };
}
const mic = requireOptionalNativeModule<RelayMic>("RelayMic");
export const phoneHasMic = !!mic;

/** Where the words go: the composer's text. */
export interface DictationTarget {
  begin(): void;
  /** Everything heard so far; `tentative` may still change. */
  update(settled: string, tentative: string): void;
  /** The final text, or null to take the words back out. */
  end(text: string | null): void;
}

export interface DictationSnapshot {
  phase: "idle" | "starting" | "listening" | "finishing";
  /** Which composer is dictating, or last tried to (for its error). */
  owner?: unknown;
  /** The desktop is still loading the model; the audio waits for it there. */
  loading: boolean;
  error?: string;
}

const listeners = new Set<() => void>();
let snapshot: DictationSnapshot = { phase: "idle", loading: false };

function set(next: Partial<DictationSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export const dictationSnapshot = () => snapshot;
export const useDictation = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );

// Loudness goes to the waveform alone, so the composer doesn't redraw 12 times a second.
const levelListeners = new Set<(level: number) => void>();
export function onDictationLevel(listener: (level: number) => void) {
  levelListeners.add(listener);
  return () => void levelListeners.delete(listener);
}

/**
 * Loudness 0–1 from a chunk's mean square. The phone's speech source has no
 * gain control, so speech sits lower than on the desktop; this puts it near
 * the middle, as the desktop's waveform does.
 */
function loudness(power: number) {
  const db = 10 * Math.log10(power + 1e-10);
  return Math.min(1, Math.max(0, (db + 55) / 38)) ** 1.8;
}

type Call = RemoteClient["call"];

interface Session {
  id: number;
  target: DictationTarget;
  call: Call;
  stopRequested: boolean;
  /** Everything heard so far, kept if the link drops. */
  heard: string;
  /** Chunks the microphone handed over. */
  received: number;
  /** The newest answer shown, by the order its chunk went out. */
  shown: number;
  audio?: { remove(): void };
}

let nextId = Math.floor(Math.random() * 1e6);
let session: Session | undefined;

/** Starts listening into `target`. */
export async function startDictation(
  target: DictationTarget,
  owner: unknown,
  call: Call,
) {
  if (!mic || snapshot.phase !== "idle") return;
  const current: Session = {
    id: ++nextId,
    target,
    call,
    stopRequested: false,
    heard: "",
    received: 0,
    shown: 0,
  };
  session = current;
  set({ phase: "starting", owner, loading: true, error: undefined });
  let loading = true;
  try {
    const allowed =
      (await mic.getPermission()).granted ||
      (await mic.requestPermission()).granted;
    if (!allowed)
      throw new Error(
        "Relay isn't allowed to use the microphone. Allow it in Android's settings for Relay.",
      );
    ({ loading } = await call("dictate", { type: "start", id: current.id }));
    if (session !== current) return cancelRemote(current);
    current.audio = mic.addListener("onAudio", (chunk) =>
      receive(current, chunk),
    );
    await mic.start();
  } catch (error) {
    if (session === current) {
      discard(current);
      set({ phase: "idle", loading: false, error: describe(error) });
    }
    return;
  }
  // Cancelled while the microphone was opening.
  if (session !== current) {
    current.audio?.remove();
    void mic.stop().catch(() => {});
    return;
  }
  target.begin();
  set({ phase: "listening", loading });
  if (current.stopRequested) void stopDictation();
}

function receive(current: Session, chunk: { pcm: string; power: number }) {
  const order = ++current.received;
  const level = loudness(chunk.power);
  for (const listener of levelListeners) listener(level);
  current
    .call("dictate", { type: "audio", id: current.id, pcm: chunk.pcm })
    .then(
      (heard) => show(current, order, heard),
      (error) => fail(current, error),
    );
}

function show(current: Session, order: number, heard: PhoneDictationHeard) {
  if (session !== current || order < current.shown) return;
  current.shown = order;
  current.heard = [heard.settled, heard.tentative].filter(Boolean).join(" ");
  if (snapshot.phase === "listening" || snapshot.phase === "finishing")
    current.target.update(heard.settled, heard.tentative);
  if (snapshot.loading !== heard.loading) set({ loading: heard.loading });
}

/** The link dropped or the engine failed: keep the words heard so far. */
function fail(current: Session, error: unknown) {
  // Finishing hears the same failure from its own call.
  if (session !== current || snapshot.phase === "finishing") return;
  discard(current);
  if (snapshot.phase === "listening") current.target.end(current.heard || null);
  set({ phase: "idle", loading: false, error: describe(error) });
}

/**
 * Finishes: the last words settle on the desktop, then the text stays in the
 * composer. Resolves true once it's there.
 */
export async function stopDictation() {
  const current = session;
  if (!current || !mic) return false;
  if (snapshot.phase === "starting") {
    current.stopRequested = true;
    return false;
  }
  if (snapshot.phase !== "listening") return false;
  set({ phase: "finishing" });
  const total = await mic.stop().catch(() => current.received);
  // The last chunk's event can still be on its way in.
  for (let wait = 0; current.received < total && wait < 25; wait++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  current.audio?.remove();
  let text = current.heard,
    error: string | undefined;
  try {
    text = (await current.call("dictate", { type: "stop", id: current.id }))
      .settled;
  } catch (e) {
    error = describe(e);
  }
  if (session !== current) return false;
  session = undefined;
  current.target.end(text || null);
  set({ phase: "idle", owner: undefined, loading: false, error });
  return true;
}

/** Stops and takes the dictated words back out. */
export function cancelDictation() {
  const current = session;
  if (!current) return;
  const began =
    snapshot.phase === "listening" || snapshot.phase === "finishing";
  discard(current);
  cancelRemote(current);
  if (began) current.target.end(null);
  set({ phase: "idle", owner: undefined, loading: false });
}

export const clearDictationError = () => set({ error: undefined });

function discard(current: Session) {
  if (session === current) session = undefined;
  current.audio?.remove();
  void mic?.stop().catch(() => {});
}

function cancelRemote(current: Session) {
  void current
    .call("dictate", { type: "cancel", id: current.id })
    .catch(() => {});
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Android takes the microphone away in the background; keep what was said.
// Not while starting: the permission prompt backgrounds the app too.
AppState.addEventListener("change", (state) => {
  if (state === "background" && snapshot.phase === "listening")
    void stopDictation();
});
