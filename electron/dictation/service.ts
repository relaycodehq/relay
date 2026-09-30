import { existsSync } from "node:fs";
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
  type DictationModelState,
} from "../../shared/dictation";
import { downloadModel, modelComplete, modelReceived } from "./model-files";
import type { WorkerCommand, WorkerNotice } from "./worker";

/** The model's memory goes back to the system this long after the last use. */
const idleUnload = 3 * 60_000;

// Native files can't load from inside the asar; they ship unpacked beside it.
const unpacked = (path: string) =>
  path.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
const sherpaDir = unpacked(join(__dirname, "sherpa"));
const platformDir = join(
  sherpaDir,
  `sherpa-onnx-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`,
);

export class Dictation {
  private state: DictationModelState = { status: "missing" };
  private download?: AbortController;
  private worker?: UtilityProcess;
  /** The worker couldn't load the model; the next use starts a fresh one. */
  private broken = false;
  private idle?: NodeJS.Timeout;
  private readonly dir: string;

  constructor(
    userData: string,
    private emit: (state: DictationModelState) => void,
  ) {
    this.dir = join(userData, "models", dictationModel.id);
    void this.refresh();
  }

  get current() {
    return this.state;
  }

  private set(state: DictationModelState) {
    this.state = state;
    this.emit(state);
  }

  private async refresh() {
    if (!existsSync(platformDir)) return this.set({ status: "unsupported" });
    if (await modelComplete(this.dir, dictationModel.files))
      return this.set({ status: "ready" });
    const received = await modelReceived(this.dir, dictationModel.files);
    if (received) this.set({ status: "missing", received });
  }

  async downloadModel() {
    if (this.download || this.state.status === "ready") return this.state;
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
    return this.state;
  }

  cancelDownload() {
    this.download?.abort();
  }

  async removeModel() {
    this.download?.abort();
    this.stopWorker();
    await rm(this.dir, { recursive: true, force: true });
    if (this.state.status !== "unsupported") this.set({ status: "missing" });
    return this.state;
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
    if (this.state.status === "ready") this.startWorker();
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
      sherpa: join(sherpaDir, "sherpa-onnx-node"),
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
