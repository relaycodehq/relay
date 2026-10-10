import { api } from "../../lib/api";
import { customFileId, type SoundId } from "../../../shared/sounds";
import { soundOutput, synths } from "./synth";

let context: AudioContext | undefined;
let sleep: ReturnType<typeof setTimeout> | undefined;
/** A running context keeps an audio thread busy even in silence. */
const sleepAfterMs = 4000;
/** Decoded custom files, by file id; a failed decode is forgotten so the next play retries. */
const decoded = new Map<string, Promise<AudioBuffer>>();

/** Starts the audio engine and keeps it up for at least `forMs`. */
function wake(forMs = sleepAfterMs) {
  context ??= new AudioContext();
  if (context.state !== "running") void context.resume();
  clearTimeout(sleep);
  sleep = setTimeout(() => void context?.suspend(), forMs);
  return context;
}

/** Where a custom sound's file comes from: the API in the window, the push itself in the menubar's player. */
type Bytes = (fileId: string) => Promise<Uint8Array>;

function decode(ctx: AudioContext, fileId: string, bytes: Bytes) {
  let buffer = decoded.get(fileId);
  if (!buffer) {
    buffer = bytes(fileId)
      // decodeAudioData takes the buffer over, so it gets a copy of its own.
      .then((bytes) => ctx.decodeAudioData(bytes.slice().buffer));
    buffer.catch(() => decoded.delete(fileId));
    decoded.set(fileId, buffer);
  }
  return buffer;
}

/** Forgets a custom file's decoded audio, once it's gone. */
export function forgetSound(fileId: string) {
  decoded.delete(fileId);
}

/** Plays `sound` at `volume` (0 to 1). */
export async function playSound(
  sound: SoundId,
  volume: number,
  bytes: Bytes = (fileId) => api.customSoundBytes(fileId),
) {
  const ctx = wake();
  const level = ctx.createGain();
  level.gain.value = volume;
  level.connect(ctx.destination);
  const fileId = customFileId(sound);
  if (!fileId) {
    synths[sound as keyof typeof synths]?.(
      ctx,
      soundOutput(ctx, level),
      ctx.currentTime + 0.03,
    );
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = await decode(ctx, fileId, bytes);
  source.connect(level);
  source.start();
  wake(source.buffer.duration * 1000 + sleepAfterMs);
}

/** How long a file plays, in seconds; throws when it isn't audio the window can decode. */
export async function soundLength(bytes: Uint8Array) {
  const ctx = wake();
  const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
  return buffer.duration;
}
