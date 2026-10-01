import type {
  DictationEvent,
  DictationModelState,
  DictationRequest,
} from "../../shared/dictation";
import type {
  PhoneDictation,
  PhoneDictationHeard,
} from "../../shared/remote";

/** This computer's speech engine, as phones use it; see ../dictation/service. */
export interface SpeechService {
  status(): DictationModelState["status"];
  /** A port to the engine, or nothing while the model isn't downloaded. */
  open(): SpeechPort | undefined;
}

/** Electron's MessagePortMain, as far as phones need it. */
interface SpeechPort {
  postMessage(message: DictationRequest): void;
  on(
    event: "message",
    listener: (message: { data: DictationEvent }) => void,
  ): unknown;
  start(): void;
  close(): void;
}

/** A phone that goes quiet this long (signal lost, app killed) loses its session. */
const quietMs = 10_000;
/** How long the last words may take to settle; the phone gives up at 15 s. */
const finalMs = 12_000;

interface Session {
  id: number;
  port: SpeechPort;
  heard: PhoneDictationHeard;
  error?: string;
  final?: (text: string | Error) => void;
  quiet?: NodeJS.Timeout;
}

const nothing: PhoneDictationHeard = {
  settled: "",
  tentative: "",
  loading: false,
};

/**
 * Phones dictating with this computer's speech engine, one session each. The
 * phone streams its microphone as calls, and each call's answer carries the
 * words heard so far, so no events need to find their way to one phone.
 */
export class PhoneDictations {
  private sessions = new Map<string, Session>();
  constructor(private speech: SpeechService) {}

  /** Audio reaches the engine before this returns, so chunks keep the order they came in. */
  handle(
    deviceId: string,
    request: PhoneDictation,
  ): PhoneDictationHeard | Promise<PhoneDictationHeard> {
    if (request.type === "start") return this.start(deviceId, request.id);
    const session = this.sessions.get(deviceId);
    if (!session || session.id !== request.id) {
      if (request.type === "cancel") return nothing;
      throw new Error("Dictation ended on the computer. Start it again.");
    }
    if (session.error) {
      this.end(deviceId, session);
      throw new Error(session.error);
    }
    if (request.type === "audio") {
      this.touch(deviceId, session);
      session.port.postMessage({
        type: "audio",
        id: session.id,
        samples: toSamples(request.pcm),
      });
      return session.heard;
    }
    if (request.type === "cancel") {
      session.port.postMessage({ type: "cancel", id: session.id });
      this.end(deviceId, session);
      return nothing;
    }
    return this.finish(deviceId, session);
  }

  /** Ends every session, e.g. when phone access turns off. */
  dispose() {
    for (const [deviceId, session] of this.sessions) {
      session.port.postMessage({ type: "cancel", id: session.id });
      this.end(deviceId, session);
    }
  }

  private start(deviceId: string, id: number) {
    const previous = this.sessions.get(deviceId);
    if (previous) {
      previous.port.postMessage({ type: "cancel", id: previous.id });
      this.end(deviceId, previous);
    }
    const status = this.speech.status();
    const port = status === "ready" ? this.speech.open() : undefined;
    if (!port)
      throw new Error(
        status === "unsupported"
          ? "Dictation isn't available on this computer."
          : status === "downloading"
            ? "The speech model is still downloading on the computer."
            : "Set up dictation in Relay on the computer first: Settings › Dictation.",
      );
    const session: Session = {
      id,
      port,
      heard: { settled: "", tentative: "", loading: true },
    };
    port.on("message", ({ data }) => this.receive(session, data));
    port.start();
    port.postMessage({ type: "start", id });
    this.sessions.set(deviceId, session);
    this.touch(deviceId, session);
    return session.heard;
  }

  private receive(session: Session, event: DictationEvent) {
    if (event.type === "ready")
      session.heard = { ...session.heard, loading: false };
    else if (event.type === "error") {
      session.error = event.message;
      session.final?.(new Error(event.message));
    } else if (event.id !== session.id) return;
    else if (event.type === "text")
      session.heard = {
        settled: event.settled,
        tentative: event.tentative,
        loading: false,
      };
    else if (event.type === "final") session.final?.(event.text);
  }

  private async finish(deviceId: string, session: Session) {
    clearTimeout(session.quiet);
    try {
      const text = await new Promise<string>((resolve, reject) => {
        // Keep what was heard if the engine never answers.
        const timer = setTimeout(
          () =>
            resolve(
              [session.heard.settled, session.heard.tentative]
                .filter(Boolean)
                .join(" "),
            ),
          finalMs,
        );
        session.final = (result) => {
          clearTimeout(timer);
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        session.port.postMessage({ type: "stop", id: session.id });
      });
      return { settled: text, tentative: "", loading: false };
    } finally {
      this.end(deviceId, session);
    }
  }

  private touch(deviceId: string, session: Session) {
    clearTimeout(session.quiet);
    session.quiet = setTimeout(() => {
      session.port.postMessage({ type: "cancel", id: session.id });
      this.end(deviceId, session);
    }, quietMs);
  }

  private end(deviceId: string, session: Session) {
    clearTimeout(session.quiet);
    // A new start ended a session still settling its last words.
    session.final?.(new Error("Dictation ended."));
    session.final = undefined;
    session.port.close();
    if (this.sessions.get(deviceId) === session) this.sessions.delete(deviceId);
  }
}

/** 16-bit little-endian PCM to the engine's float samples. */
function toSamples(pcm: string) {
  const bytes = Buffer.from(pcm, "base64");
  const samples = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < samples.length; i++)
    samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}
