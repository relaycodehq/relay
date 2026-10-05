import {
  maxReadAloudPull,
  type PhoneReadAloud,
  type PhoneReadAloudAudio,
} from "../../shared/remote";

/** What a reading hands back as it goes; see ../read-aloud/service. */
export type VoiceSpeech =
  | { type: "loading" }
  | { type: "audio"; pcm: Float32Array; sampleRate: number }
  | { type: "end"; error?: string };

/** This computer's voice, as phones use it. */
export interface VoiceService {
  /** Whether a voice is downloaded and ready to read. */
  ready(): boolean;
  /** Throws when there's no voice; ends any reading already going. */
  speak(
    markdown: string,
    sink: (speech: VoiceSpeech) => void,
  ): { stop(): void };
}

/** A phone that stops pulling this long (signal lost, app killed) loses its reading. */
const quietMs = 10_000;

interface Session {
  id: number;
  reading: { stop(): void };
  audio: Float32Array[];
  sampleRate: number;
  loading: boolean;
  ended: boolean;
  error?: string;
  quiet?: NodeJS.Timeout;
}

/**
 * Phones hearing answers in this computer's voice, one reading each. The
 * audio waits here until the phone pulls it, a few seconds at a time, as it
 * plays; the engine stays at most its own lead ahead of the phone.
 */
export class PhoneReadings {
  private sessions = new Map<string, Session>();
  constructor(private voice: VoiceService) {}

  handle(deviceId: string, request: PhoneReadAloud): PhoneReadAloudAudio {
    if (request.type === "start") return this.start(deviceId, request);
    const session = this.sessions.get(deviceId);
    if (!session || session.id !== request.id) {
      if (request.type === "stop") return idle;
      throw new Error("The reading ended on the computer.");
    }
    if (request.type === "stop") {
      this.end(deviceId, session);
      return idle;
    }
    this.touch(deviceId, session);
    const pcm = take(
      session,
      Math.round(session.sampleRate * maxReadAloudPull),
    );
    // A reading that failed hands over what it made, then the error.
    const done = session.ended && !session.audio.length && !session.error;
    if (session.ended && !session.audio.length && (done || !pcm)) {
      this.end(deviceId, session);
      if (!done) throw new Error(session.error);
    }
    return {
      pcm,
      sampleRate: session.sampleRate,
      loading: session.loading,
      done,
    };
  }

  dispose() {
    for (const [deviceId, session] of this.sessions)
      this.end(deviceId, session);
  }

  private start(
    deviceId: string,
    request: Extract<PhoneReadAloud, { type: "start" }>,
  ) {
    const previous = this.sessions.get(deviceId);
    if (previous) this.end(deviceId, previous);
    const session: Session = {
      id: request.id,
      reading: { stop() {} },
      audio: [],
      sampleRate: 24000,
      loading: false,
      ended: false,
    };
    this.sessions.set(deviceId, session);
    try {
      session.reading = this.voice.speak(request.markdown, (speech) => {
        if (speech.type === "loading") session.loading = true;
        else if (speech.type === "audio") {
          session.loading = false;
          session.sampleRate = speech.sampleRate;
          session.audio.push(speech.pcm);
        } else {
          session.ended = true;
          session.loading = false;
          if (speech.error) session.error = speech.error;
        }
      });
    } catch (error) {
      this.sessions.delete(deviceId);
      throw error;
    }
    this.touch(deviceId, session);
    return {
      pcm: "",
      sampleRate: session.sampleRate,
      loading: session.loading,
      done: false,
    };
  }

  private touch(deviceId: string, session: Session) {
    clearTimeout(session.quiet);
    session.quiet = setTimeout(() => this.end(deviceId, session), quietMs);
  }

  private end(deviceId: string, session: Session) {
    clearTimeout(session.quiet);
    if (!session.ended) session.reading.stop();
    session.ended = true;
    if (this.sessions.get(deviceId) === session) this.sessions.delete(deviceId);
  }
}

const idle: PhoneReadAloudAudio = {
  pcm: "",
  sampleRate: 24000,
  loading: false,
  done: true,
};

/** Up to `most` samples off the front of the queue, as 16-bit little-endian PCM in base64. */
function take(session: Session, most: number) {
  let length = 0;
  for (const a of session.audio) length += a.length;
  length = Math.min(length, most);
  if (!length) return "";
  const bytes = Buffer.alloc(length * 2);
  let at = 0;
  while (at < length) {
    const first = session.audio[0];
    const n = Math.min(first.length, length - at);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, first[i]));
      bytes.writeInt16LE(Math.round(s * 32767), (at + i) * 2);
    }
    at += n;
    if (n === first.length) session.audio.shift();
    else session.audio[0] = first.subarray(n);
  }
  return bytes.toString("base64");
}
