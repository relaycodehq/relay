// Runs in an Electron utility process: a model holds hundreds of megabytes,
// and a native crash here takes down only read aloud.
import type * as Ort from "onnxruntime-node";
import { engineById } from "./catalog";
import type { ReadAloudModel } from "./engine";
import { Stretch } from "./stretch";

export type WorkerCommand =
  | { type: "init"; ort: string; threads: number }
  | {
      type: "speak";
      id: number;
      engine: string;
      dir: string;
      voice: string;
      speed: number;
      chunks: string[];
    }
  | { type: "stop"; id: number };

export type WorkerNotice =
  | { type: "loading"; id: number }
  /** The engine now held in memory, or none after a failed load. */
  | { type: "loaded"; engine?: string }
  | { type: "audio"; id: number; pcm: Float32Array; sampleRate: number }
  | { type: "end"; id: number; error?: string }
  /** Whether something is being read, for the idle unload. */
  | { type: "busy"; busy: boolean };

/** Audio is handed on in pieces of at least this long, so IPC isn't per engine frame. */
const pieceSeconds = 0.1;
/** Synthesis waits rather than run further than this ahead of playback. */
const aheadSeconds = 20;

const parent = process.parentPort;
const notify = (notice: WorkerNotice) => parent.postMessage(notice);
let ort: typeof Ort | undefined;
let threads = 1;
let loaded: { engine: string; model: Promise<ReadAloudModel> } | undefined;
let current:
  { id: number; controller: AbortController; done: Promise<void> } | undefined;

parent.on("message", ({ data }) => {
  const command = data as WorkerCommand;
  if (command.type === "init") {
    ort = require(command.ort);
    threads = command.threads;
  } else if (command.type === "speak") {
    const previous = current;
    previous?.controller.abort();
    const controller = new AbortController();
    const session = { id: command.id, controller, done: Promise.resolve() };
    current = session;
    notify({ type: "busy", busy: true });
    session.done = (async () => {
      await previous?.done;
      let error: string | undefined;
      try {
        if (!controller.signal.aborted) await speak(command, controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          error = e instanceof Error ? e.message : String(e);
      }
      notify({ type: "end", id: command.id, ...(error ? { error } : {}) });
      if (current === session) {
        current = undefined;
        notify({ type: "busy", busy: false });
      }
    })();
  } else if (command.type === "stop") {
    if (current?.id === command.id) current.controller.abort();
  }
});

async function modelFor(engine: string, dir: string, id: number) {
  if (loaded?.engine === engine) return loaded.model;
  if (loaded) {
    // One engine in memory at a time.
    const old = loaded.model;
    loaded = undefined;
    await old.then((m) => m.release()).catch(() => {});
  }
  const definition = engineById(engine);
  if (!definition)
    throw new Error(`Relay doesn't know the voice engine ${engine}.`);
  if (!ort) throw new Error("onnxruntime didn't load.");
  notify({ type: "loading", id });
  const model = definition.load(ort, dir, threads);
  loaded = { engine, model };
  try {
    await model;
  } catch (e) {
    if (loaded?.model === model) loaded = undefined;
    notify({ type: "loaded" });
    throw e;
  }
  notify({ type: "loaded", engine });
  return model;
}

async function speak(
  command: Extract<WorkerCommand, { type: "speak" }>,
  signal: AbortSignal,
) {
  const model = await modelFor(command.engine, command.dir, command.id);
  const { sampleRate } = model;
  const stretch = new Stretch(command.speed, sampleRate);
  const piece = Math.round(sampleRate * pieceSeconds);
  let pending: Float32Array[] = [];
  let pendingLength = 0;
  let sent = 0;
  let started = 0;
  const send = (force: boolean) => {
    if (!pendingLength || (!force && pendingLength < piece)) return;
    const pcm = new Float32Array(pendingLength);
    let at = 0;
    for (const p of pending) {
      pcm.set(p, at);
      at += p.length;
    }
    pending = [];
    pendingLength = 0;
    started ||= performance.now();
    sent += pcm.length;
    notify({ type: "audio", id: command.id, pcm, sampleRate });
  };
  const add = (pcm: Float32Array) => {
    if (signal.aborted || !pcm.length) return;
    // Engines may reuse their buffer for the next frame.
    pending.push(pcm.slice());
    pendingLength += pcm.length;
    send(false);
  };

  for (const chunk of command.chunks) {
    const ahead = sent / sampleRate - (performance.now() - started) / 1000;
    if (started && ahead > aheadSeconds)
      await sleep((ahead - aheadSeconds) * 1000, signal);
    if (signal.aborted) return;
    await model.speak(
      chunk,
      command.voice,
      (pcm) => add(stretch.push(pcm)),
      signal,
    );
    if (signal.aborted) return;
    send(true);
  }
  add(stretch.flush());
  send(true);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
