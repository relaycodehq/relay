import { rm } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import {
  MessageChannelMain,
  systemPreferences,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import {
  dictationModel,
  dictationModelSize,
  type DictationEngine,
  type DictationModelState,
  type DictationState,
} from "../../shared/dictation";
import {
  downloadModel,
  modelComplete,
  modelReceived,
} from "../util/model-files";
import { onnxRuntimeEntry, onnxRuntimeInstalled } from "../util/onnxruntime";
import {
  appleSpeechAvailable,
  appleSpeechHelper,
  serveAppleSpeech,
} from "./apple";
import type { WorkerCommand, WorkerNotice } from "./worker";

/** The model's memory goes back to the system this long after the last use. */
const idleUnload = 3 * 60_000;

/** Where the engine choice is kept; the headless Relay has none and runs Parakeet. */
export interface EngineChoice {
  get(): DictationEngine | undefined;
  save(engine: DictationEngine): Promise<void>;
}

export class Dictation {
  private state: DictationModelState = { status: "missing" };
  private download?: AbortController;
  private worker?: UtilityProcess;
  /** The worker couldn't load the model; the next use starts a fresh one. */
  private broken = false;
  private idle?: NodeJS.Timeout;
  private readonly dir: string;
  private readonly appleHelper = appleSpeechHelper(__dirname);
  private readonly appleReady = appleSpeechAvailable(this.appleHelper);

  constructor(
    userData: string,
    private emit: (state: DictationState) => void,
    private choice?: EngineChoice,
  ) {
    this.dir = join(userData, "models", dictationModel.id);
    void this.refresh();
  }

  /** The chosen engine, if this computer can run it. */
  private get engine(): DictationEngine {
    return this.choice?.get() === "apple" && this.appleReady
      ? "apple"
      : "parakeet";
  }

  get current(): DictationState {
    const apple = !!this.choice && this.appleReady;
    const engine = this.engine;
    const shown =
      engine === "apple" ? { status: "ready" as const } : this.state;
    return { ...shown, engine, apple, parakeet: this.state };
  }

  async setEngine(engine: DictationEngine) {
    if (!this.choice) throw new Error("This Relay can only run Parakeet.");
    await this.choice.save(engine);
    if (this.engine === "apple") this.stopWorker();
    this.emit(this.current);
    return this.current;
  }

  /** Tells the page again, e.g. once the saved engine choice has loaded. */
  announce() {
    this.emit(this.current);
  }

  private set(state: DictationModelState) {
    this.state = state;
    this.emit(this.current);
  }

  /** Whether the model is downloaded and checked, whatever the engine. */
  hasModel() {
    return modelComplete(this.dir, dictationModel.files);
  }

  /** Looks again at the engine and the model, e.g. once the engine is downloaded. */
  async refresh() {
    if (!onnxRuntimeInstalled()) return this.set({ status: "unsupported" });
    if (await this.hasModel()) return this.set({ status: "ready" });
    const received = await modelReceived(this.dir, dictationModel.files);
    if (received) this.set({ status: "missing", received });
  }

  async downloadModel() {
    if (this.download || this.state.status === "ready") return this.current;
    const controller = (this.download = new AbortController());
    const total = dictationModelSize;
    let shown = 0;
    this.set({
      status: "downloading",
      received: await modelReceived(this.dir, dictationModel.files),
      total,
    });
    try {
      await downloadModel(
        this.dir,
        dictationModel.files,
        controller.signal,
        (received) => {
          // About a hundred updates over the whole download.
          if (received - shown < total / 200 && received < total) return;
          shown = received;
          this.set({ status: "downloading", received, total });
        },
      );
      this.set({ status: "ready" });
    } catch (error) {
      if (controller.signal.aborted)
        this.set({
          status: "missing",
          received: await modelReceived(this.dir, dictationModel.files),
        });
      else
        this.set({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          received: await modelReceived(this.dir, dictationModel.files),
          total,
        });
    } finally {
      this.download = undefined;
    }
    return this.current;
  }

  cancelDownload() {
    this.download?.abort();
  }

  async removeModel() {
    this.download?.abort();
    this.stopWorker();
    await rm(this.dir, { recursive: true, force: true });
    if (this.state.status !== "unsupported") this.set({ status: "missing" });
    return this.current;
  }

  /** Asks macOS for the microphone the first time; other systems answer in the page. */
  async microphone() {
    if (process.platform !== "darwin") return true;
    if (systemPreferences.getMediaAccessStatus("microphone") === "granted")
      return true;
    return systemPreferences.askForMediaAccess("microphone");
  }

  /** A port straight to the speech engine, loading it if needed. */
  open() {
    if (this.engine === "apple") {
      const { port1, port2 } = new MessageChannelMain();
      serveAppleSpeech(port1, this.appleHelper);
      return port2;
    }
    if (this.state.status !== "ready") return;
    const worker = this.startWorker();
    const { port1, port2 } = new MessageChannelMain();
    worker.postMessage({ type: "port" }, [port1]);
    return port2;
  }

  /** Hands the page a port straight to the speech engine. */
  connect(contents: WebContents) {
    const port = this.open();
    if (!port) return false;
    contents.postMessage("relay:dictation-port", null, [port]);
    return true;
  }

  /** Loads the model ahead of the first word, e.g. when the pointer nears the mic. */
  warm() {
    if (this.engine === "parakeet" && this.state.status === "ready")
      this.startWorker();
  }

  private startWorker() {
    if (this.worker && this.broken) this.stopWorker();
    if (this.worker) {
      this.touch(true);
      return this.worker;
    }
    this.broken = false;
    const worker = utilityProcess.fork(
      join(__dirname, "dictation-worker.cjs"),
      [],
      {
        serviceName: "Relay Dictation",
      },
    );
    this.worker = worker;
    worker.on("message", (notice: WorkerNotice) => {
      if (notice.type === "busy") this.touch(!notice.busy);
      else if (notice.type === "failed") {
        // The page hears it over its port; this worker won't be reused.
        console.error("Dictation engine failed to load:", notice.message);
        this.broken = true;
      }
    });
    worker.on("exit", () => {
      if (this.worker === worker) this.worker = undefined;
    });
    worker.postMessage({
      type: "load",
      dir: this.dir,
      ort: onnxRuntimeEntry(),
      threads: Math.max(1, Math.min(4, availableParallelism() - 2)),
    } satisfies WorkerCommand);
    this.touch(true);
    return worker;
  }

  private touch(idle: boolean) {
    clearTimeout(this.idle);
    if (idle) this.idle = setTimeout(() => this.stopWorker(), idleUnload);
  }

  stopWorker() {
    clearTimeout(this.idle);
    this.worker?.kill();
    this.worker = undefined;
  }
}
