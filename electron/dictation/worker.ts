// Runs in an Electron utility process: the model holds over a gigabyte, and a
// native crash here takes down only dictation.
import type { MessagePortMain } from "electron";
import type { DictationEvent, DictationRequest } from "../../shared/dictation";
import { loadSherpaEngine } from "./sherpa-engine";
import { Transcriber, type SpeechEngine } from "./transcriber";

export type WorkerCommand = {
  type: "load";
  dir: string;
  sherpa: string;
  threads: number;
};
export type WorkerNotice =
  | { type: "loaded" }
  | { type: "failed"; message: string }
  /** Whether a session is running, for the idle unload. */
  | { type: "busy"; busy: boolean };

const parent = process.parentPort;
let engine: Promise<SpeechEngine> | undefined;
let sessions = 0;
const notify = (notice: WorkerNotice) => parent.postMessage(notice);

parent.on("message", ({ data, ports }) => {
  const command = data as WorkerCommand | { type: "port" };
  if (command.type === "load" && !engine) {
    const sherpa = require(command.sherpa);
    engine = loadSherpaEngine(sherpa, command.dir, command.threads);
    engine.then(
      () => notify({ type: "loaded" }),
      (error) =>
        notify({ type: "failed", message: String(error?.message ?? error) }),
    );
  } else if (command.type === "port" && ports[0]) serve(ports[0]);
});

function serve(port: MessagePortMain) {
  const send = (event: DictationEvent) => port.postMessage(event);
  let current:
    | { id: number; transcriber?: Transcriber; queued: Float32Array[] }
    | undefined;
  const finish = () => {
    current = undefined;
    notify({ type: "busy", busy: --sessions > 0 });
  };
  engine?.then(
    () => send({ type: "ready" }),
    (error) =>
      send({ type: "error", message: String(error?.message ?? error) }),
  );
  port.on("message", ({ data }) => {
    void handle(data as DictationRequest | null).catch((error) =>
      send({ type: "error", message: String(error?.message ?? error) }),
    );
  });
  const handle = async (request: DictationRequest | null) => {
    if (!request) return;
    if (request.type === "start") {
      if (current) finish();
      const session: NonNullable<typeof current> = {
        id: request.id,
        queued: [],
      };
      current = session;
      notify({ type: "busy", busy: ++sessions > 0 });
      try {
        const ready = await engine!;
        if (current !== session) return;
        session.transcriber = new Transcriber(ready, (settled, tentative) =>
          send({ type: "text", id: session.id, settled, tentative }),
        );
        // Audio said while the model was still loading.
        for (const samples of session.queued.splice(0))
          session.transcriber.push(samples);
      } catch (error) {
        send({
          type: "error",
          id: session.id,
          message: String((error as Error)?.message ?? error),
        });
        if (current === session) finish();
      }
      return;
    }
    if (!current || request.id !== current.id) return;
    const session = current;
    if (request.type === "audio") {
      if (session.transcriber) session.transcriber.push(request.samples);
      else session.queued.push(request.samples);
    } else if (request.type === "cancel") finish();
    else if (request.type === "stop") {
      finish();
      // Stopping while the model loads still transcribes what was said.
      const transcriber = session.transcriber ?? (await startLate(session));
      const text = transcriber ? await transcriber.stop() : "";
      send({ type: "final", id: session.id, text });
    }
  };
  port.start();
}

async function startLate(session: { queued: Float32Array[] }) {
  const ready = await engine!.catch(() => undefined);
  if (!ready) return;
  const transcriber = new Transcriber(ready, () => {});
  for (const samples of session.queued) transcriber.push(samples);
  return transcriber;
}
