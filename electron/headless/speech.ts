// The speech engine phones use, for a headless Relay: dictation and read
// aloud both run on onnxruntime, which is native and large, so it doesn't
// ship in the archive. It's downloaded from npm when either is set up in
// `relay settings`, checked against the SHA-512 in Relay's lockfile
// (scripts/build-headless.mjs writes speech-runtime.json from it).
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DictationModelState } from "../../shared/dictation";
import type { ReadAloudState } from "../../shared/read-aloud";
import type { Dictation } from "../dictation/service";
import type { ReadAloud } from "../read-aloud";
import type { SpeechService } from "../remote/phone-dictation";
import type { VoiceService } from "../remote/phone-read-aloud";
import { download, extract, renameSoon } from "./archive";
import { errorMessage } from "../../shared/error-message";

export interface RuntimePackage {
  name: string;
  version: string;
  url: string;
  integrity: string;
}

/** speech-runtime.json, beside the bundle. */
export interface SpeechRuntimeManifest {
  /** Ships every platform's binaries; `platforms` lists them as `<platform>/<arch>`. */
  onnxruntime: RuntimePackage & { platforms: string[] };
}

/** Dictation, or read aloud. */
export type SpeechEngine = "dictation" | "voice";

export interface EngineDownload {
  engine: SpeechEngine;
  received: number;
  total: number;
}

const ortPlatform = () => `${process.platform}/${process.arch}`;

export class SpeechRuntime {
  readonly ortDir: string;
  private manifest: SpeechRuntimeManifest | null;
  private installing?: Promise<void>;
  /** What's downloading now, for `relay settings` to show. */
  progress?: EngineDownload;

  constructor(
    private home: string,
    /** The folder the bundle runs from, holding speech-runtime.json and onnxruntime's JavaScript. */
    private lib: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.ortDir = join(home, "runtime", "onnxruntime");
    try {
      this.manifest = JSON.parse(
        readFileSync(join(lib, "speech-runtime.json"), "utf8"),
      ) as SpeechRuntimeManifest;
    } catch {
      this.manifest = null;
    }
  }

  /** Whether this computer's platform has the engine at all. */
  get supported() {
    return !!this.manifest?.onnxruntime.platforms.includes(ortPlatform());
  }

  /** Downloaded, and the version this Relay was built with. */
  get installed() {
    const want = this.manifest?.onnxruntime.version;
    if (!want) return false;
    try {
      return readFileSync(join(this.ortDir, "VERSION"), "utf8").trim() === want;
    } catch {
      return false;
    }
  }

  /** Downloaded once, of another version: an update moved it on, so it's fetched again. */
  get stale() {
    return existsSync(join(this.ortDir, "VERSION")) && !this.installed;
  }

  /** onnxruntime's JavaScript comes with each Relay; the binaries it loads were downloaded. */
  async prepare() {
    // Dictation ran on sherpa-onnx before it moved to onnxruntime.
    await rm(join(this.home, "runtime", "sherpa"), {
      recursive: true,
      force: true,
    }).catch(() => {});
    if (!this.installed) return;
    await cp(join(this.lib, "onnxruntime", "dist"), join(this.ortDir, "dist"), {
      recursive: true,
    }).catch((e) => console.warn("The speech runtime is incomplete:", e));
  }

  /** Downloads the runtime for `engine`, unless the other one already did. */
  install(engine: SpeechEngine) {
    if (this.installed) return Promise.resolve();
    this.installing ??= this.fetch(engine).finally(() => {
      this.installing = undefined;
      this.progress = undefined;
    });
    return this.installing;
  }

  async remove() {
    await rm(this.ortDir, { recursive: true, force: true });
  }

  /** Into a folder beside the final one, swapped in once whole. */
  private async fetch(engine: SpeechEngine) {
    const pkg = this.manifest?.onnxruntime;
    if (!pkg || !this.supported)
      throw new Error(
        `${engine === "dictation" ? "Dictation" : "Read aloud"} isn't available for ${process.platform} on ${process.arch}.`,
      );
    const target = this.ortDir;
    const staging = `${target}.download`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      const file = join(staging, `${pkg.name}.tgz`);
      await download(pkg.url, file, pkg.integrity, {
        fetch: this.fetcher,
        progress: (received, total) =>
          (this.progress = {
            engine,
            received,
            total: Math.max(total, received),
          }),
      });
      // Every platform's binaries come in the one package; only this one's stay.
      const binaries = `package/bin/napi-v6/${ortPlatform()}`;
      await extract(file, staging, [binaries]);
      await mkdir(join(staging, "bin", "napi-v6", process.platform), {
        recursive: true,
      });
      await renameSoon(
        join(staging, binaries),
        join(staging, "bin", "napi-v6", ortPlatform()),
      );
      await rm(join(staging, "package"), { recursive: true });
      await cp(join(this.lib, "onnxruntime", "dist"), join(staging, "dist"), {
        recursive: true,
      });
      await rm(file);
      await writeFile(join(staging, "VERSION"), `${pkg.version}\n`);
      await rm(target, { recursive: true, force: true });
      await renameSoon(staging, target);
    } catch (e) {
      await rm(staging, { recursive: true, force: true });
      throw e;
    }
  }
}

/** Speech as `relay settings` shows it. */
export interface SpeechState {
  dictation: {
    supported: boolean;
    /** The engine is downloaded; the model is `model`. */
    engine: boolean;
    model: DictationModelState;
  };
  voice: { supported: boolean; engine: boolean; state: ReadAloudState };
  /** Setting one up now: the engine first, then the model or voice. */
  setup?: {
    engine: SpeechEngine;
    step: "engine" | "model";
    status: "working" | "done" | "failed";
    error?: string;
  };
  download?: EngineDownload;
}

/**
 * Dictation and read aloud on a headless Relay: setting one up downloads
 * its engine, then the model or voice, and phones use them as they would
 * a desktop's.
 */
export class HeadlessSpeech {
  private setup?: NonNullable<SpeechState["setup"]>;
  constructor(
    private runtime: SpeechRuntime,
    private dictation: Dictation,
    private readAloud: ReadAloud,
  ) {}

  /** What the bridge hands phones; without an engine yet, they're told to set it up. */
  readonly forPhones: { dictation: SpeechService; readAloud: VoiceService } = {
    dictation: {
      status: () => {
        const status = this.dictation.current.parakeet.status;
        return status === "unsupported" && this.runtime.supported
          ? "missing"
          : status;
      },
      open: () => this.dictation.open(),
    },
    readAloud: {
      ready: () => this.readAloud.ready(),
      speak: (markdown, sink) => {
        if (!this.readAloud.supported && this.runtime.supported)
          throw new Error(
            "Set up read aloud on the computer first: relay settings › Read aloud.",
          );
        return this.readAloud.speak(markdown, sink);
      },
    },
  };

  state(): SpeechState {
    return {
      dictation: {
        supported: this.runtime.supported,
        engine: this.runtime.installed,
        model: this.dictation.current.parakeet,
      },
      voice: {
        supported: this.runtime.supported,
        engine: this.runtime.installed,
        state: this.readAloud.current,
      },
      ...(this.setup ? { setup: { ...this.setup } } : {}),
      ...(this.runtime.progress ? { download: this.runtime.progress } : {}),
    };
  }

  /** After an update, fetches quietly what dictation or read aloud needs to keep working. */
  async catchUp() {
    if (this.runtime.installed || !this.runtime.supported) return;
    // An update moved the engine on, or dictation's model outlived the engine
    // it ran on (sherpa-onnx, before dictation moved to onnxruntime).
    if (this.runtime.stale || (await this.dictation.hasModel()))
      await this.runtime
        .install("dictation")
        .then(() => this.dictation.refresh())
        .catch((e) => console.warn("Couldn't update the speech engine:", e));
  }

  /** Starts setting `engine` up and answers at once; `state()` follows it. */
  install(engine: SpeechEngine, voice?: string) {
    if (this.setup?.status === "working") return this.state();
    if (!this.runtime.supported)
      throw new Error(
        `${engine === "dictation" ? "Dictation" : "Read aloud"} isn't available for ${process.platform} on ${process.arch}.`,
      );
    if (voice && !this.readAloud.current.engines.some((e) => e.id === voice))
      throw new Error(`There's no voice engine called ${voice}.`);
    const setup: NonNullable<SpeechState["setup"]> = {
      engine,
      step: "engine",
      status: "working",
    };
    this.setup = setup;
    void (async () => {
      try {
        await this.runtime.install(engine);
        await this.dictation.refresh();
        setup.step = "model";
        if (engine === "dictation") {
          const done = await this.dictation.downloadModel();
          if (done.status !== "ready")
            throw new Error(
              done.status === "failed"
                ? done.error
                : "The model didn't download.",
            );
        } else {
          const id = voice ?? this.readAloud.current.engines[0]!.id;
          const done = await this.readAloud.download(id);
          const model = done.engines.find((e) => e.id === id)?.model;
          if (model?.status !== "ready")
            throw new Error(
              model?.status === "failed"
                ? model.error
                : "The voice didn't download.",
            );
          await this.readAloud.saveSettings({
            ...this.readAloud.settings(),
            engine: id,
          });
        }
        setup.status = "done";
      } catch (e) {
        setup.status = "failed";
        setup.error = errorMessage(e);
      }
    })();
    return this.state();
  }

  /**
   * Removes a voice, or with none named the model or voices and what ran
   * them; the engine stays while the other still uses it.
   */
  async remove(engine: SpeechEngine, voice?: string) {
    if (engine === "dictation") {
      await this.dictation.removeModel();
      this.dictation.stopWorker();
      if (
        !this.readAloud.current.engines.some((e) => e.model.status === "ready")
      )
        await this.runtime.remove();
    } else if (voice) await this.readAloud.remove(voice);
    else {
      for (const e of this.readAloud.current.engines)
        await this.readAloud.remove(e.id);
      if (this.dictation.current.status !== "ready")
        await this.runtime.remove();
    }
    await this.dictation.refresh();
    return this.state();
  }
}
