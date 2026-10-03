import { useSyncExternalStore } from "react";
import type {
  DictationEvent,
  DictationModelState,
  DictationRequest,
} from "../../../../shared/dictation";
import { api } from "../../../lib/api";
import { startCapture, type Capture } from "./capture";
import { dictationMicrophone } from "./microphones";

/** Where the words go: the composer's editor. */
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
  /** The engine is still loading the model; audio waits for it. */
  loading: boolean;
  analyser?: AnalyserNode;
  error?: string;
}

const listeners = new Set<() => void>();
let snapshot: DictationSnapshot = { phase: "idle", loading: false };

function set(next: Partial<DictationSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const dictationSnapshot = () => snapshot;
export const useDictation = () =>
  useSyncExternalStore(subscribe, () => snapshot);

interface Session {
  id: number;
  target: DictationTarget;
  port?: MessagePort;
  capture?: Capture;
  stopRequested: boolean;
  heard: string;
  final?: (text: string) => void;
}

let sessionId = 0;
let session: Session | undefined;

// Electron's end of the port can take ports but not buffers in the transfer
// list, so samples are copied; that's 5 KB every 80 ms.
const send = (current: Session, request: DictationRequest) =>
  current.port?.postMessage(request);

/** Starts listening into `target`; resolves false when the model isn't downloaded. */
export async function startDictation(target: DictationTarget, owner: unknown) {
  if (snapshot.phase !== "idle") return true;
  if (modelState.status !== "ready") return false;
  const current: Session = {
    id: ++sessionId,
    target,
    stopRequested: false,
    heard: "",
  };
  session = current;
  set({
    phase: "starting",
    owner,
    loading: true,
    error: undefined,
    analyser: undefined,
  });
  try {
    if (!(await api.dictationMicrophone()))
      throw new Error(
        "Relay isn't allowed to use the microphone. Allow it in System Settings › Privacy & Security › Microphone.",
      );
    current.port = await openPort();
    current.port.onmessage = ({ data }: MessageEvent<DictationEvent>) =>
      receive(current, data);
    send(current, { type: "start", id: current.id });
    current.capture = await startCapture(
      dictationMicrophone() || undefined,
      (samples) => send(current, { type: "audio", id: current.id, samples }),
    );
  } catch (error) {
    if (session === current) {
      discard(current);
      set({ phase: "idle", error: describe(error) });
    }
    return true;
  }
  // Cancelled while the microphone was opening.
  if (session !== current) {
    void current.capture.stop().catch(() => {});
    current.port.close();
    return true;
  }
  target.begin();
  set({ phase: "listening", analyser: current.capture.analyser });
  if (current.stopRequested) void stopDictation();
  return true;
}

function receive(current: Session, event: DictationEvent) {
  if (session !== current) return;
  if (event.type === "ready") set({ loading: false });
  else if (event.type === "error") {
    discard(current);
    current.target.end(null);
    set({ phase: "idle", analyser: undefined, error: event.message });
  } else if (event.id !== current.id) return;
  else if (event.type === "text") {
    current.heard = [event.settled, event.tentative].filter(Boolean).join(" ");
    if (snapshot.phase === "listening" || snapshot.phase === "finishing")
      current.target.update(event.settled, event.tentative);
    if (snapshot.loading) set({ loading: false });
  } else if (event.type === "final") current.final?.(event.text);
}

/**
 * Finishes: the last words settle, then the text stays in the composer.
 * Resolves true once it's there.
 */
export async function stopDictation() {
  const current = session;
  if (!current) return false;
  if (snapshot.phase === "starting") {
    current.stopRequested = true;
    return false;
  }
  if (snapshot.phase !== "listening") return false;
  set({ phase: "finishing" });
  await current.capture?.stop();
  const text = await new Promise<string>((resolve) => {
    // Keep what was heard if the engine never answers.
    const timer = setTimeout(() => resolve(current.heard), 15_000);
    current.final = (text) => {
      clearTimeout(timer);
      resolve(text);
    };
    send(current, { type: "stop", id: current.id });
  });
  if (session !== current) return false;
  current.port?.close();
  session = undefined;
  current.target.end(text);
  set({ phase: "idle", owner: undefined, analyser: undefined, loading: false });
  return true;
}

/** Stops and takes the dictated words back out. */
export function cancelDictation() {
  const current = session;
  if (!current) return;
  const began =
    snapshot.phase === "listening" || snapshot.phase === "finishing";
  send(current, { type: "cancel", id: current.id });
  discard(current);
  if (began) current.target.end(null);
  set({ phase: "idle", owner: undefined, analyser: undefined, loading: false });
}

export const clearDictationError = () => set({ error: undefined });

function discard(current: Session) {
  if (session === current) session = undefined;
  void current.capture?.stop().catch(() => {});
  current.port?.close();
}

function openPort() {
  return new Promise<MessagePort>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data !== "relay:dictation-port" ||
        !event.ports[0]
      )
        return;
      done();
      resolve(event.ports[0]);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("The speech engine didn't start."));
    }, 10_000);
    window.addEventListener("message", onMessage);
    api.connectDictation().then(
      (connected) => {
        if (connected) return;
        done();
        reject(new Error("Download the speech model first."));
      },
      (error) => {
        done();
        reject(error);
      },
    );
  });
}

function describe(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "Relay isn't allowed to use the microphone.";
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      return "No microphone found. Plug one in or pick another in Settings › Dictation.";
    if (error.name === "NotReadableError")
      return "The microphone is busy in another app.";
  }
  return error instanceof Error ? error.message : String(error);
}

// The speech model, as the main process reports it.
let modelState: DictationModelState = { status: "missing" };
const modelListeners = new Set<() => void>();
let modelWatched = false;

function watchModel() {
  if (modelWatched || !window.relay) return;
  modelWatched = true;
  // A window whose main process predates dictation (reloaded, not restarted).
  if (typeof api.onDictationState !== "function") {
    modelState = { status: "unsupported" };
    return;
  }
  const update = (state: DictationModelState) => {
    modelState = state;
    for (const listener of modelListeners) listener();
  };
  api.onDictationState(update);
  void api.dictationState().then(update, () => {});
}

export const dictationModelState = () => modelState;
export function useDictationModel() {
  watchModel();
  return useSyncExternalStore(
    (listener) => {
      modelListeners.add(listener);
      return () => modelListeners.delete(listener);
    },
    () => modelState,
  );
}
