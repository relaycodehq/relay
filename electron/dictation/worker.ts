// Runs in an Electron utility process: the model holds over a gigabyte, and a
// native crash here takes down only dictation.
import { join } from "node:path";
import type { MessagePortMain } from "electron";
import type * as Ort from "onnxruntime-node";
import type { DictationEvent, DictationRequest } from "../../shared/dictation";
import { loadParakeet } from "./parakeet";
import { Transcriber, type SpeechEngine } from "./transcriber";
import { loadSilero, type VoiceDetector } from "./voice-detector";

export type WorkerCommand = {
  type: "load";
  dir: string;
  /** onnxruntime-node's bundle, beside Relay's (see build-electron.mjs). */
  ort: string;
  threads: number;
};

export type WorkerNotice =
  | { type: "loaded" }
  | { type: "failed"; message: string }
  /** Whether a session is running, for the idle unload. */
  | { type: "busy"; busy: boolean };

/**
 * The model, shared by every session, and a voice detector for each: the
 * desktop and a phone may dictate at once, and a detector keeps state.
 */
interface SpeechModel extends SpeechEngine {
  detector(): VoiceDetector;
}

async function loadModel(ort: typeof Ort, dir: string, threads: number) {
  const [parakeet, detector] = await Promise.all([
    loadParakeet(ort, dir, threads),
    loadSilero(ort, join(dir, "silero_vad.onnx")),
  ]);
  return { decode: parakeet.decode, detector } satisfies SpeechModel;
}

const parent = process.parentPort;
let engine: Promise<SpeechModel> | undefined;
let sessions = 0;
const notify = (notice: WorkerNotice) => parent.postMessage(notice);
const message = (error: unknown) =>
  String((error as Error | undefined)?.message ?? error);

parent.on("message", ({ data, ports }) => {
  const command = data as WorkerCommand | { type: "port" };
  if (command.type === "load" && !engine) {
    engine = loadModel(require(command.ort), command.dir, command.threads);
    engine.then(
      () => notify({ type: "loaded" }),
      (error) => notify({ type: "failed", message: message(error) }),
    );
  } else if (command.type === "port" && ports[0]) serve(ports[0]);
});

interface Session {
  id: number;
  transcriber?: Transcriber;
  detect?: VoiceDetector;
  /**
   * Everything asked of the session, in order: the detector carries state
   * from one stretch of audio to the next, and audio said while the model
   * was still loading waits here.
   */
  steps: Promise<void>;
  /** Cancelled, replaced or failed: what's still queued is dropped. */
  over: boolean;
}

function serve(port: MessagePortMain) {
  const send = (event: DictationEvent) => port.postMessage(event);
  let current: Session | undefined;
  const finish = () => {
    current = undefined;
    notify({ type: "busy", busy: --sessions > 0 });
  };
  const then = (session: Session, step: () => Promise<void> | void) => {
    session.steps = session.steps
      .then(() => (session.over ? undefined : step()))
      .catch((error) => {
        session.over = true;
        send({ type: "error", id: session.id, message: message(error) });
        if (current === session) finish();
      });
  };
  engine?.then(
    () => send({ type: "ready" }),
    (error) => send({ type: "error", message: message(error) }),
  );
  port.on("message", ({ data }) => {
    const request = data as DictationRequest | null;
    if (!request) return;
    if (request.type === "start") {
      if (current) {
        current.over = true;
        finish();
      }
      const session: Session = {
        id: request.id,
        steps: Promise.resolve(),
        over: false,
      };
      current = session;
      notify({ type: "busy", busy: ++sessions > 0 });
      then(session, async () => {
        const model = await engine!;
        session.detect = model.detector();
        session.transcriber = new Transcriber(model, (settled, tentative) =>
          send({ type: "text", id: session.id, settled, tentative }),
        );
      });
      return;
    }
    if (!current || request.id !== current.id) return;
    const session = current;
    if (request.type === "audio")
      then(session, async () =>
        session.transcriber!.push(
          request.samples,
          await session.detect!(request.samples),
        ),
      );
    else if (request.type === "cancel") {
      session.over = true;
      finish();
    } else if (request.type === "stop") {
      finish();
      // Stopping while the model loads still transcribes what was said.
      then(session, async () =>
        send({
          type: "final",
          id: session.id,
          text: await session.transcriber!.stop(),
        }),
      );
    }
  });
  port.start();
}
