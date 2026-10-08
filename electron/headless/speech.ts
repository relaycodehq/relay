// The speech engines phones use, for a headless Relay: dictation runs on
// sherpa-onnx and read aloud on onnxruntime, both native and both large, so
// neither ships in the archive. They're downloaded from npm when set up in
// `relay settings`, each checked against the SHA-512 in Relay's lockfile
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

export interface RuntimePackage {
  name: string;
  version: string;
  url: string;
  integrity: string;
}

/** speech-runtime.json, beside the bundle. */
export interface SpeechRuntimeManifest {
  sherpa: {
    node: RuntimePackage;
    /** By `<platform>-<arch>` as sherpa names them: `win-x64`, `darwin-arm64`. */
    platforms: Record<string, RuntimePackage>;
  };
  /** Ships every platform's binaries; `platforms` lists them as `<platform>/<arch>`. */
  onnxruntime: RuntimePackage & { platforms: string[] };
}

/** Dictation's engine, or read aloud's. */
export type SpeechEngine = "dictation" | "voice";

export interface EngineDownload {
  engine: SpeechEngine;
  received: number;
  total: number;
}

const sherpaPlatform = () =>
  `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const ortPlatform = () => `${process.platform}/${process.arch}`;

export class SpeechRuntime {
  readonly sherpaDir: string;
  readonly ortDir: string;
  private manifest: SpeechRuntimeManifest | null;
  private installing = new Map<SpeechEngine, Promise<void>>();
  /** What's downloading now, for `relay settings` to show. */
  progress?: EngineDownload;

  constructor(
    home: string,
    /** The folder the bundle runs from, holding speech-runtime.json and onnxruntime's JavaScript. */
    private lib: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.sherpaDir = join(home, "runtime", "sherpa");
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
  supports(engine: SpeechEngine) {
    const m = this.manifest;
    if (!m) return false;
    return engine === "dictation"
      ? !!m.sherpa.platforms[sherpaPlatform()]
      : m.onnxruntime.platforms.includes(ortPlatform());
  }

  /** Downloaded, and the version this Relay was built with. */
  installed(engine: SpeechEngine) {
    const want = this.version(engine);
    if (!want) return false;
    try {
      return (
        readFileSync(join(this.dir(engine), "VERSION"), "utf8").trim() === want
      );
    } catch {
      return false;
    }
  }

  /** Downloaded once, of another version: an update moved it on, so it's fetched again. */
  stale(engine: SpeechEngine) {
    return (
      existsSync(join(this.dir(engine), "VERSION")) && !this.installed(engine)
    );
  }

  /** onnxruntime's JavaScript comes with each Relay; the binaries it loads were downloaded. */
  async prepare() {
    if (!this.installed("voice")) return;
    await cp(join(this.lib, "onnxruntime", "dist"), join(this.ortDir, "dist"), {
      recursive: true,
    }).catch((e) => console.warn("Read aloud's runtime is incomplete:", e));
  }

  install(engine: SpeechEngine) {
    if (this.installed(engine)) return Promise.resolve();
    let job = this.installing.get(engine);
    if (!job) {
      job = this.fetch(engine).finally(() => {
        this.installing.delete(engine);
        if (this.progress?.engine === engine) this.progress = undefined;
      });
      this.installing.set(engine, job);
    }
    return job;
  }

  async remove(engine: SpeechEngine) {
    await rm(this.dir(engine), { recursive: true, force: true });
  }

  private dir(engine: SpeechEngine) {
    return engine === "dictation" ? this.sherpaDir : this.ortDir;
  }

  private version(engine: SpeechEngine) {
    const m = this.manifest;
    if (!m) return undefined;
    return engine === "dictation"
      ? m.sherpa.platforms[sherpaPlatform()]?.version
      : m.onnxruntime.version;
  }

  /** Into a folder beside the final one, swapped in once whole. */
  private async fetch(engine: SpeechEngine) {
    const m = this.manifest;
    if (!m || !this.supports(engine))
      throw new Error(
        `${engine === "dictation" ? "Dictation" : "Read aloud"} isn't available for ${process.platform} on ${process.arch}.`,
      );
    const target = this.dir(engine);
    const staging = `${target}.download`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      const packages =
        engine === "dictation"
          ? [m.sherpa.node, m.sherpa.platforms[sherpaPlatform()]!]
          : [m.onnxruntime];
      const archives: { pkg: RuntimePackage; file: string; size: number }[] =
        [];
      let done = 0;
      for (const pkg of packages) {
        const file = join(staging, `${pkg.name}.tgz`);
        const size = await download(pkg.url, file, pkg.integrity, {
          fetch: this.fetcher,
          progress: (received, total) =>
            (this.progress = {
              engine,
              received: done + received,
              total: done + Math.max(total, received),
            }),
        });
        done += size;
        archives.push({ pkg, file, size });
      }
      for (const { pkg, file } of archives) {
        if (engine === "dictation") {
          // sherpa-onnx-node finds its addon in the sibling folder named for the platform.
          const into = join(staging, pkg.name);
          await mkdir(into);
          await extract(file, into);
          await renameSoon(join(into, "package"), `${into}.unpacked`);
          await rm(into, { recursive: true });
          await renameSoon(`${into}.unpacked`, into);
        } else {
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
          await cp(
            join(this.lib, "onnxruntime", "dist"),
            join(staging, "dist"),
            {
              recursive: true,
            },
          );
        }
        await rm(file);
      }
      await writeFile(join(staging, "VERSION"), `${this.version(engine)}\n`);
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
        const status = this.dictation.current.status;
        return status === "unsupported" && this.runtime.supports("dictation")
          ? "missing"
          : status;
      },
      open: () => this.dictation.open(),
    },
    readAloud: {
      ready: () => this.readAloud.ready(),
      speak: (markdown, sink) => {
        if (!this.readAloud.supported && this.runtime.supports("voice"))
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
        supported: this.runtime.supports("dictation"),
        engine: this.runtime.installed("dictation"),
        model: this.dictation.current,
      },
      voice: {
        supported: this.runtime.supports("voice"),
        engine: this.runtime.installed("voice"),
        state: this.readAloud.current,
      },
      ...(this.setup ? { setup: { ...this.setup } } : {}),
      ...(this.runtime.progress ? { download: this.runtime.progress } : {}),
    };
  }

  /** An update moved the engines on: what was set up is fetched again, quietly. */
  async catchUp() {
    for (const engine of ["dictation", "voice"] as const)
      if (this.runtime.stale(engine))
        await this.runtime
          .install(engine)
          .then(() => this.refresh(engine))
          .catch((e) =>
            console.warn(`Couldn't update the ${engine} engine:`, e),
          );
  }

  /** Starts setting `engine` up and answers at once; `state()` follows it. */
  install(engine: SpeechEngine, voice?: string) {
    if (this.setup?.status === "working") return this.state();
    if (!this.runtime.supports(engine))
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
        await this.refresh(engine);
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
        setup.error = e instanceof Error ? e.message : String(e);
      }
    })();
    return this.state();
  }

  /** Removes a voice, or with none named the engine and everything it ran. */
  async remove(engine: SpeechEngine, voice?: string) {
    if (engine === "dictation") {
      await this.dictation.removeModel();
      this.dictation.stopWorker();
      await this.runtime.remove("dictation");
    } else if (voice) await this.readAloud.remove(voice);
    else {
      for (const e of this.readAloud.current.engines)
        await this.readAloud.remove(e.id);
      await this.runtime.remove("voice");
    }
    await this.refresh(engine);
    return this.state();
  }

  private async refresh(engine: SpeechEngine) {
    if (engine === "dictation") await this.dictation.refresh();
    else await this.runtime.prepare();
  }
}
