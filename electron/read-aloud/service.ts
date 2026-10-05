import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import {
  defaultReadAloudSettings,
  readAloudChoice,
  readAloudSpeeds,
  type ReadAloudModelState,
  type ReadAloudSettings,
  type ReadAloudState,
} from "../../shared/read-aloud";
import {
  downloadModel,
  modelComplete,
  modelReceived,
} from "../util/model-files";
import { engineById, engineList } from "./catalog";
import type { ReadAloudEngine } from "./engine";
import { speakableChunks } from "./speakable";
import type { WorkerCommand, WorkerNotice } from "./worker";

/** The model's memory goes back to the system this long after the last reading. */
const idleUnload =
  (process.env.RELAY_TEST_DATA &&
    Number(process.env.RELAY_TEST_READ_ALOUD_IDLE_MS)) ||
  3 * 60_000;

// Native files can't load from inside the asar; they ship unpacked beside it.
const unpacked = (path: string) =>
  path.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
const ortDir = unpacked(join(__dirname, "onnxruntime"));
const ortBinaries = join(
  ortDir,
  "bin",
  "napi-v6",
  process.platform,
  process.arch,
);

/** What a reading hands back as it goes. */
export type Speech =
  | { type: "loading" }
  | { type: "audio"; pcm: Float32Array; sampleRate: number }
  /** The last event: read to the end, stopped, or `error` says why not. */
  | { type: "end"; error?: string };

export interface ReadAloudSettingsStore {
  get(): ReadAloudSettings | undefined;
  save(settings: ReadAloudSettings): Promise<void>;
}

export class ReadAloud {
  readonly supported = existsSync(ortBinaries);
  private models = new Map<string, ReadAloudModelState>();
  private downloads = new Map<string, AbortController>();
  private worker?: UtilityProcess;
  private loaded?: string;
  private sessions = new Map<
    number,
    { engine: string; sink: (speech: Speech) => void }
  >();
  private nextId = 1;
  private idle?: NodeJS.Timeout;

  constructor(
    private userData: string,
    private settingsStore: ReadAloudSettingsStore,
    private emit: (state: ReadAloudState) => void,
  ) {
    void this.refresh();
  }

  get current(): ReadAloudState {
    return {
      supported: this.supported,
      engines: engineList().map((engine) => ({
        id: engine.id,
        name: engine.name,
        credit: engine.credit,
        size: engine.files.reduce((sum, file) => sum + file.size, 0),
        voices: engine.voices,
        model: this.models.get(engine.id) ?? { status: "missing" },
      })),
      settings: this.settings(),
      ...(this.loaded ? { loaded: this.loaded } : {}),
    };
  }

  private changed() {
    this.emit(this.current);
  }

  private dir(engine: ReadAloudEngine) {
    return join(this.userData, "models", engine.id);
  }

  private setModel(engine: ReadAloudEngine, state: ReadAloudModelState) {
    this.models.set(engine.id, state);
    this.changed();
  }

  private async refresh() {
    for (const engine of engineList()) {
      if (this.downloads.has(engine.id)) continue;
      if (await modelComplete(this.dir(engine), engine.files))
        this.models.set(engine.id, { status: "ready" });
      else {
        const received = await modelReceived(this.dir(engine), engine.files);
        this.models.set(engine.id, {
          status: "missing",
          ...(received ? { received } : {}),
        });
      }
    }
    this.changed();
  }

  settings(): ReadAloudSettings {
    return { ...defaultReadAloudSettings, ...this.settingsStore.get() };
  }

  async saveSettings(next: ReadAloudSettings) {
    const known = (id: string) => !!engineById(id);
    const settings: ReadAloudSettings = {
      ...(next.engine && known(next.engine) ? { engine: next.engine } : {}),
      voices: Object.fromEntries(
        Object.entries(next.voices).filter(([engine, voice]) =>
          engineById(engine)?.voices.some((v) => v.id === voice),
        ),
      ),
      // The nearest offered speed, so a hand-edited value can't make it crawl.
      speed: readAloudSpeeds.reduce((best, s) =>
        Math.abs(s - next.speed) < Math.abs(best - next.speed) ? s : best,
      ),
    };
    await this.settingsStore.save(settings);
    this.changed();
    return this.current;
  }

  async download(id: string) {
    const engine = this.engine(id);
    if (this.downloads.has(id) || this.models.get(id)?.status === "ready")
      return this.current;
    const controller = new AbortController();
    this.downloads.set(id, controller);
    const dir = this.dir(engine);
    const total = engine.files.reduce((sum, file) => sum + file.size, 0);
    let shown = 0;
    this.setModel(engine, {
      status: "downloading",
      received: await modelReceived(dir, engine.files),
      total,
    });
    try {
      await downloadModel(dir, engine.files, controller.signal, (received) => {
        // About two hundred updates over the whole download.
        if (received - shown < total / 200 && received < total) return;
        shown = received;
        this.setModel(engine, { status: "downloading", received, total });
      });
      this.setModel(engine, { status: "ready" });
    } catch (error) {
      const received = await modelReceived(dir, engine.files);
      this.setModel(
        engine,
        controller.signal.aborted
          ? { status: "missing", received }
          : {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
              received,
              total,
            },
      );
    } finally {
      this.downloads.delete(id);
    }
    return this.current;
  }

  cancelDownload(id: string) {
    this.downloads.get(id)?.abort();
  }

  async remove(id: string) {
    const engine = this.engine(id);
    this.downloads.get(id)?.abort();
    const inUse =
      this.loaded === id ||
      [...this.sessions.values()].some((s) => s.engine === id);
    if (inUse) this.stopWorker("The voice was deleted.");
    await rm(this.dir(engine), { recursive: true, force: true });
    this.setModel(engine, { status: "missing" });
    return this.current;
  }

  private engine(id: string) {
    const engine = engineById(id);
    if (!engine) throw new Error(`Relay doesn't know the voice engine ${id}.`);
    return engine;
  }

  /** Whether a voice is downloaded and can read now. */
  ready() {
    return this.supported && !!readAloudChoice(this.current);
  }

  /**
   * Reads an answer's markdown aloud with the chosen engine and voice. One
   * reading at a time, across the desktop and the phone: starting one ends
   * the one before.
   */
  speak(markdown: string, sink: (speech: Speech) => void) {
    const choice = readAloudChoice(this.current);
    if (!choice)
      throw new Error(
        this.supported
          ? "Download a voice in Settings → Read aloud first."
          : "Read aloud isn't available on this computer.",
      );
    const engine = this.engine(choice.engine.id);
    const id = this.nextId++;
    const chunks = speakableChunks(markdown);
    if (!chunks.length) {
      queueMicrotask(() => sink({ type: "end" }));
      return { stop() {} };
    }
    const worker = this.startWorker();
    this.sessions.set(id, { engine: engine.id, sink });
    worker.postMessage({
      type: "speak",
      id,
      engine: engine.id,
      dir: this.dir(engine),
      voice: choice.voice.id,
      speed: this.settings().speed,
      chunks,
    } satisfies WorkerCommand);
    return {
      stop: () => {
        if (this.sessions.has(id))
          this.worker?.postMessage({
            type: "stop",
            id,
          } satisfies WorkerCommand);
      },
    };
  }

  private startWorker() {
    if (this.worker) {
      this.touch(false);
      return this.worker;
    }
    const worker = utilityProcess.fork(
      join(__dirname, "read-aloud-worker.cjs"),
      [],
      { serviceName: "Relay Read Aloud" },
    );
    this.worker = worker;
    worker.on("message", (notice: WorkerNotice) => this.notice(notice));
    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      console.error("Read aloud stopped unexpectedly, exit code", code);
      this.ended("Read aloud stopped unexpectedly.");
    });
    worker.postMessage({
      type: "init",
      ort: join(ortDir, "dist", "index.cjs"),
      threads: Math.max(1, Math.min(4, availableParallelism() - 2)),
    } satisfies WorkerCommand);
    this.touch(false);
    return worker;
  }

  private notice(notice: WorkerNotice) {
    if (notice.type === "busy") this.touch(!notice.busy);
    else if (notice.type === "loaded") {
      this.loaded = notice.engine;
      this.changed();
    } else if (notice.type === "loading")
      this.sessions.get(notice.id)?.sink({ type: "loading" });
    else if (notice.type === "audio")
      this.sessions
        .get(notice.id)
        ?.sink({
          type: "audio",
          pcm: notice.pcm,
          sampleRate: notice.sampleRate,
        });
    else if (notice.type === "end") {
      const session = this.sessions.get(notice.id);
      this.sessions.delete(notice.id);
      session?.sink({
        type: "end",
        ...(notice.error ? { error: notice.error } : {}),
      });
    }
  }

  /** Ends every reading still going, as the worker is gone. */
  private ended(error?: string) {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const s of sessions)
      s.sink({ type: "end", ...(error ? { error } : {}) });
    if (this.loaded) {
      this.loaded = undefined;
      this.changed();
    }
  }

  private touch(idle: boolean) {
    clearTimeout(this.idle);
    if (idle) this.idle = setTimeout(() => this.stopWorker(), idleUnload);
  }

  stopWorker(error?: string) {
    clearTimeout(this.idle);
    const worker = this.worker;
    this.worker = undefined;
    worker?.kill();
    this.ended(error);
  }
}
