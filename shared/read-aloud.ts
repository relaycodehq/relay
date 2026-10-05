import type { DictationModelState } from "./dictation";

/**
 * Read aloud: an answer spoken by a text-to-speech model that runs on the
 * desktop. The engines themselves live in electron/read-aloud; this is what
 * the page and the phone see of them.
 */

/** Where an engine's download stands. */
export type ReadAloudModelState = Exclude<
  DictationModelState,
  { status: "unsupported" }
>;

export interface ReadAloudVoice {
  id: string;
  name: string;
  language: string;
}

export interface ReadAloudEngineInfo {
  id: string;
  name: string;
  /** Who made it and the weights' license. */
  credit: string;
  /** Where the weights' license can be read. */
  license?: string;
  /** Bytes its download takes. */
  size: number;
  /** The first is the default. */
  voices: ReadAloudVoice[];
  model: ReadAloudModelState;
}

export interface ReadAloudSettings {
  /** The engine answers are read with; the first downloaded one when unset. */
  engine?: string;
  /** The voice picked for each engine, by engine id; its first voice when unset. */
  voices: Record<string, string>;
  /** 1 is the engine's own pace. */
  speed: number;
}

export interface ReadAloudState {
  /** False where onnxruntime has no build for this system. */
  supported: boolean;
  engines: ReadAloudEngineInfo[];
  settings: ReadAloudSettings;
  /** The engine held in memory right now, if any; it goes after a few idle minutes. */
  loaded?: string;
}

export const readAloudSpeeds = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const defaultReadAloudSettings: ReadAloudSettings = {
  voices: {},
  speed: 1,
};

/** The engine and voice answers are read with now, if one is downloaded. */
export function readAloudChoice(state: ReadAloudState) {
  if (!state.supported) return undefined;
  const ready = state.engines.filter((e) => e.model.status === "ready");
  const engine =
    ready.find((e) => e.id === state.settings.engine) ??
    // The picked engine isn't downloaded yet: another one reads meanwhile.
    ready[0];
  if (!engine) return undefined;
  const picked = state.settings.voices[engine.id];
  const voice = engine.voices.find((v) => v.id === picked) ?? engine.voices[0];
  return voice && { engine, voice };
}

/** Desktop → page, for the reading the page asked for by `id`. */
export type ReadAloudEvent =
  /** The engine is loading its model; audio follows. */
  | { type: "loading"; id: number }
  /** The next piece of mono audio. */
  | { type: "audio"; id: number; pcm: Float32Array; sampleRate: number }
  /** Everything was read, it was stopped, or `error` says why it couldn't go on. */
  | { type: "end"; id: number; error?: string };
