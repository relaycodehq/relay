import { app, net } from "electron";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  manifestSchema,
  newerVersion,
  updateFeed,
  updateKeys,
  type UpdateFile,
  type UpdateManifest,
  type UpdateState,
} from "../../shared/updates";
import { signedByAny } from "../../shared/update-signature";
import { apply, detectInstall, prepare, type Install } from "./install-update";

const checkEvery = 4 * 60 * 60 * 1000;
// Coming back to Relay checks again once the last check is this old.
const staleAfter = 30 * 60 * 1000;
const checkTimeout = 20_000;
const stallTimeout = 60_000;

export class Updater {
  private state: UpdateState;
  private install: Install | null = null;
  private manifest?: UpdateManifest;

  private staged?: {
    version: string;
    path: string;
    dir: string;
    /** The installer waits for Relay to quit; the next quit installs this one. */
    handedOff?: boolean;
  };

  private busy = false;
  private checking?: Promise<UpdateState>;
  private checkedAt = 0;
  private readonly feed: string;
  /** Public keys whose signature over the feed Relay trusts. */
  private readonly keys: readonly string[];

  private waiting?: NodeJS.Timeout;

  constructor(
    private readonly emit: (state: UpdateState) => void,
    private readonly hooks: {
      /** Claude's background work still running; the restart waits for it. */
      runningTasks: () => number;
      /** Quits for the restart; `cancelled` runs when Relay is kept open instead. */
      quit: (cancelled: () => void) => void;
    } = { runningTasks: () => 0, quit: () => app.quit() },
  ) {
    const current = app.getVersion();
    // Development builds stay quiet unless a feed is set to exercise the UI.
    const override = process.env.RELAY_UPDATE_FEED;
    this.feed = override || updateFeed;
    // A test feed may bring its own key, but only to a development build;
    // a packaged copy trusts the pinned keys and nothing else.
    const testKey = process.env.RELAY_UPDATE_KEY;
    this.keys =
      !app.isPackaged && override && testKey
        ? [...updateKeys, testKey]
        : updateKeys;
    this.state =
      app.isPackaged || override
        ? { status: "idle", current }
        : { status: "off", current };
  }

  get current() {
    return this.state;
  }

  start() {
    if (this.state.status === "off") return;
    // Offline or a missing first release: stay out of the way until the next check.
    const quietly = () =>
      void this.check().catch((error) =>
        console.warn("Update check failed:", error),
      );
    setTimeout(quietly, 15_000).unref();
    setInterval(quietly, checkEvery).unref();
    // The launch check covers the first focus.
    this.checkedAt = Date.now();
    app.on("browser-window-focus", () => {
      if (Date.now() - this.checkedAt >= staleAfter) quietly();
    });
  }

  private set(state: UpdateState) {
    this.state = state;
    this.emit(state);
  }

  /**
   * Asks the feed for a newer release, joining a check already under way. A
   * failed check goes back to idle and rejects with the reason, which the
   * timer keeps to the log and Settings shows.
   */
  check() {
    this.checking ??= this.lookUp().finally(() => (this.checking = undefined));
    return this.checking;
  }

  private async lookUp() {
    const current = app.getVersion();
    if (this.state.status === "off" || this.busy) return this.state;
    // The installer is already waiting to install the staged release.
    if (this.staged?.handedOff) return this.state;
    // A download under way or a restart asked for shouldn't be reset by a timer.
    if (["downloading", "waiting", "installing"].includes(this.state.status))
      return this.state;
    this.install ??= await detectInstall();
    if (!this.install) {
      this.set({ status: "off", current });
      return this.state;
    }
    this.checkedAt = Date.now();
    // An offer already in the sidebar stays put while Relay looks for a newer one.
    const offered = ["available", "ready", "error"].includes(this.state.status)
      ? this.state
      : undefined;
    if (!offered) this.set({ status: "checking", current });
    // Pressing Update or Restart mid-check hands the state to that instead.
    const asked = this.state;
    try {
      const [response, signed] = await Promise.all([
        this.fetchFeed(this.feed),
        this.fetchFeed(`${this.feed}.sig`),
      ]);
      if (!response.ok)
        throw new Error(`The update feed answered ${response.status}.`);
      if (!signed.ok && signed.status !== 404)
        throw new Error(
          `The update feed's signature answered ${signed.status}.`,
        );
      // Nothing in the feed counts until its exact bytes check out.
      const bytes = new Uint8Array(await response.arrayBuffer());
      const signature = signed.ok ? await signed.text() : "";
      if (!signature.trim())
        throw new Error(
          "The update feed isn't signed, so Relay won't install from it.",
        );
      if (!signedByAny(bytes, signature, this.keys))
        throw new Error(
          "The update feed's signature doesn't check out, so Relay won't install from it.",
        );
      let data: unknown;
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {}
      const parsed = manifestSchema.safeParse(data);
      if (!parsed.success)
        throw new Error("The update feed sent something Relay can't read.", {
          cause: parsed.error,
        });
      const manifest = parsed.data;
      if (this.state !== asked) return this.state;
      this.manifest = manifest;
      const file = manifest.files[this.install.target];
      const staged = this.state.status === "ready" ? this.staged : undefined;
      if (staged && !newerVersion(manifest.version, staged.version))
        return this.state;
      // A newer release makes the downloaded one obsolete; skip straight past it.
      this.dropStaged();
      if (!newerVersion(manifest.version, current) || !file) {
        this.set({ status: "idle", current, checkedAt: Date.now() });
      } else {
        this.set({
          status: "available",
          current,
          version: manifest.version,
          notes: manifest.notes,
          install: this.install.manual ? "manual" : "auto",
          ...(this.install.manual ? { reason: this.install.manual } : {}),
        });
      }
    } catch (error) {
      if (this.state === asked)
        this.set(offered ?? { status: "idle", current });
      throw error;
    }
    return this.state;
  }

  private fetchFeed(url: string) {
    return net
      .fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(checkTimeout),
      })
      .catch((error) => {
        throw new Error(`Couldn't reach ${new URL(url).host}.`, {
          cause: error,
        });
      });
  }

  private dropStaged() {
    const dir = this.staged?.dir;
    this.staged = undefined;
    if (dir) void rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  async download() {
    const { manifest, install } = this;
    const file = manifest && install && manifest.files[install.target];
    if (
      this.busy ||
      // A failed download retries straight from the error button.
      !["available", "error"].includes(this.state.status) ||
      !manifest ||
      !install ||
      install.manual ||
      !file
    )
      return this.state;
    this.busy = true;
    const current = app.getVersion(),
      version = manifest.version;
    const dir = join(app.getPath("temp"), `relay-update-${version}`);
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = await this.fetchFile(file, dir, (progress) =>
        this.set({ status: "downloading", current, version, progress }),
      );
      const staged = await prepare(install.target, path, dir);
      this.staged = { version, path: staged, dir };
      this.set({ status: "ready", current, version });
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      this.set({
        status: "error",
        current,
        version,
        message: error instanceof Error ? error.message : "Download failed.",
      });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  private async fetchFile(
    file: UpdateFile,
    dir: string,
    progress: (fraction: number) => void,
  ) {
    const path = join(dir, file.name),
      hash = createHash("sha512");
    let received = 0,
      reported = 0;
    // A stalled connection would otherwise stay "downloading" until a restart.
    const stalled = new AbortController();
    let idle = setTimeout(() => stalled.abort(), stallTimeout);
    try {
      const response = await net.fetch(file.url, {
        cache: "no-store",
        signal: stalled.signal,
      });
      const body = response.body;
      if (!response.ok || !body)
        throw new Error(`The download answered ${response.status}.`);
      progress(0);
      // pipeline reports disk errors (a full disk, say) instead of leaving an
      // unhandled stream "error" event to take down the main process.
      await pipeline(
        async function* () {
          const reader = body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return;
              clearTimeout(idle);
              idle = setTimeout(() => stalled.abort(), stallTimeout);
              hash.update(value);
              received += value.byteLength;
              const fraction = Math.min(received / file.size, 1);
              if (fraction - reported >= 0.01) {
                reported = fraction;
                progress(fraction);
              }
              yield value;
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        },
        createWriteStream(path, { mode: 0o600 }),
      );
    } catch (error) {
      if (stalled.signal.aborted)
        throw new Error("The download stalled. Try again.");
      throw error;
    } finally {
      clearTimeout(idle);
    }
    if (received !== file.size || hash.digest("base64") !== file.sha512)
      throw new Error("The download didn't match the release. Try again.");
    return path;
  }

  /**
   * Hands off to the platform installer, then quits; the new version starts by
   * itself. While Claude has background work running, waits for it first;
   * asking again while waiting restarts right away.
   */
  async installAndRestart() {
    const { staged, install } = this;
    if (
      !["ready", "waiting"].includes(this.state.status) ||
      !staged ||
      !install
    )
      return this.state;
    const current = app.getVersion();
    const tasks = this.hooks.runningTasks();
    if (this.state.status === "ready" && tasks > 0) {
      this.set({ status: "waiting", current, version: staged.version, tasks });
      this.waiting = setInterval(() => {
        const left = this.hooks.runningTasks();
        if (left > 0) {
          if (this.state.status === "waiting" && this.state.tasks !== left)
            this.set({ ...this.state, tasks: left });
          return;
        }
        void this.restart(staged, install);
      }, 5000);
      return this.state;
    }
    return this.restart(staged, install);
  }

  private async restart(
    staged: NonNullable<Updater["staged"]>,
    install: Install,
  ) {
    clearInterval(this.waiting);
    this.waiting = undefined;
    if (this.state.status === "installing") return this.state;
    const current = app.getVersion();
    const version = staged.version;
    this.set({ status: "installing", current, version });
    try {
      // A second installer would race the first over the same bundle.
      if (!staged.handedOff) await apply(install.target, staged.path);
      staged.handedOff = true;
      // Keeping Relay open (unsaved edits, a failed save) offers Restart again.
      this.hooks.quit(() => this.set({ status: "ready", current, version }));
    } catch (error) {
      this.set({
        status: "error",
        current,
        version,
        message: error instanceof Error ? error.message : "Update failed.",
      });
    }
    return this.state;
  }
}
