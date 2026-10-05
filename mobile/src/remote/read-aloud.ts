// Read aloud on the phone: the paired desktop's voice, the phone's speaker.
// The desktop makes the audio and keeps it until the phone pulls it, a few
// seconds at a time, so a slow link pauses the reading instead of losing it.
import { useSyncExternalStore } from "react";
import { requireOptionalNativeModule } from "expo";
import type { RemoteClient } from "../../../shared/remote-client";

/** modules/relay-speaker; missing in Expo Go, on iOS, and in APKs from before read aloud. */
interface RelaySpeaker {
  start(sampleRate: number): Promise<void>;
  /** Resolves with how many seconds are queued and not yet heard. */
  write(pcm: string): Promise<number>;
  ahead(): Promise<number>;
  /** Resolves once everything queued has played, or the reading stopped. */
  finish(): Promise<void>;
  stop(): Promise<void>;
}
const speaker = requireOptionalNativeModule<RelaySpeaker>("RelaySpeaker");
export const phoneHasSpeaker = !!speaker;

/** Pulls again once less than this is left to play. */
const lead = 4;

export interface ReadAloudSnapshot {
  /** The message being read. */
  key?: string;
  /** No audio yet: the desktop is loading its voice or making the first words. */
  loading: boolean;
  error?: { key: string; message: string };
}

const listeners = new Set<() => void>();
let snapshot: ReadAloudSnapshot = { loading: false };

function set(next: Partial<ReadAloudSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export const useReadAloud = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );

type Call = RemoteClient["call"];

interface Reading {
  id: number;
  key: string;
  call: Call;
}

let nextId = Math.floor(Math.random() * 1e6);
let reading: Reading | undefined;
let errorTimer: ReturnType<typeof setTimeout> | undefined;

/** Reads `markdown` aloud, ending any reading before it. */
export async function startReadAloud(
  key: string,
  markdown: string,
  call: Call,
) {
  if (!speaker) return;
  stopReadAloud();
  clearTimeout(errorTimer);
  const current: Reading = { id: ++nextId, key, call };
  reading = current;
  set({ key, loading: true, error: undefined });
  try {
    await call("readAloud", { type: "start", id: current.id, markdown });
    let started = false;
    while (reading === current) {
      if (started && (await speaker.ahead()) > lead) {
        await sleep(250);
        continue;
      }
      const audio = await call("readAloud", { type: "pull", id: current.id });
      if (reading !== current) return;
      if (audio.pcm) {
        if (!started) await speaker.start(audio.sampleRate);
        started = true;
        // Stopped while the speaker opened; a newer reading opens its own.
        if (reading !== current) {
          if (!reading) void speaker.stop().catch(() => {});
          return;
        }
        await speaker.write(audio.pcm);
        if (snapshot.loading) set({ loading: false });
      }
      if (audio.done) {
        if (started) await speaker.finish();
        break;
      }
      if (!audio.pcm) await sleep(audio.loading ? 400 : 150);
    }
  } catch (error) {
    if (reading !== current) return;
    const message = error instanceof Error ? error.message : String(error);
    set({ error: { key, message } });
    errorTimer = setTimeout(() => set({ error: undefined }), 5000);
  }
  if (reading !== current) return;
  reading = undefined;
  void speaker.stop().catch(() => {});
  set({ key: undefined, loading: false });
}

export function stopReadAloud() {
  const current = reading;
  if (!current) return;
  reading = undefined;
  void speaker?.stop().catch(() => {});
  void current
    .call("readAloud", { type: "stop", id: current.id })
    .catch(() => {});
  set({ key: undefined, loading: false });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
