import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  newerVersion,
  updateFeed,
  updateFileSchema,
  updateKeys,
  type UpdateState,
} from "../../shared/updates";
import { signedByAny } from "../app/update-signature";
import { replaceInstallation } from "./install";
import { download, extract } from "./archive";

/**
 * latest.json as a headless Relay reads it: its own download sits beside
 * the desktop's `files`, never in them, since desktops reject a target
 * they don't know.
 */
const feedSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  notes: z.string().max(4000).optional(),
  headless: updateFileSchema.optional(),
});
type Feed = z.infer<typeof feedSchema>;

/**
 * The folder an installed Relay runs from, holding bin/, lib/ and VERSION;
 * null for a build in a checkout, which updates with git instead.
 */
export function installRoot(dir: string) {
  const root = resolve(dir, "..");
  return basename(dir) === "lib" &&
    existsSync(join(root, "VERSION")) &&
    existsSync(join(root, "bin", "relay"))
    ? root
    : null;
}

/**
 * Replaces an installed headless Relay with the newest release: checked
 * against the feed, downloaded and verified beside the install, then
 * swapped in with two renames. Restarting is the caller's; the agent host
 * keeps the agents going through it.
 */
export class HeadlessUpdater {
  private state: UpdateState;
  private found?: Feed & { headless: NonNullable<Feed["headless"]> };
  private staged?: string;
  private checking?: Promise<UpdateState>;
  private downloading?: Promise<UpdateState>;
  private installing?: Promise<UpdateState>;
  constructor(
    private root: string | null,
    private current: string,
    private options: {
      feed?: string;
      /** Public keys trusted for the feed's signature; tests bring their own. */
      keys?: readonly string[];
      fetch?: typeof fetch;
      /** Runs once the new version is in place. */
      restart?: () => void;
    } = {},
  ) {
    this.state = root
      ? { status: "idle", current }
      : { status: "off", current };
  }

  get now() {
    return this.state;
  }

  check(): Promise<UpdateState> {
    return (this.checking ??= this.checkRelease().finally(() => {
      this.checking = undefined;
    }));
  }

  private async checkRelease(): Promise<UpdateState> {
    const busy = ["checking", "downloading", "ready", "installing"];
    if (!this.root || busy.includes(this.state.status)) return this.state;
    const current = this.current;
    this.state = { status: "checking", current };
    try {
      // RELAY_UPDATE_FEED stands in a feed served on this machine, as for the desktop.
      const url =
        this.options.feed ?? (process.env.RELAY_UPDATE_FEED || updateFeed);
      const get = (at: string) =>
        (this.options.fetch ?? fetch)(at, {
          signal: AbortSignal.timeout(20_000),
        });
      const [response, signed] = await Promise.all([
        get(url),
        get(`${url}.sig`),
      ]);
      if (!response.ok)
        throw new Error(`The update feed answered ${response.status}.`);
      if (!signed.ok && signed.status !== 404)
        throw new Error(
          `The update feed's signature answered ${signed.status}.`,
        );
      // As on the desktop, nothing in the feed counts until its exact bytes
      // check out; a headless Relay installs updates with nobody watching.
      const bytes = new Uint8Array(await response.arrayBuffer());
      const signature = signed.ok ? await signed.text() : "";
      if (!signature.trim())
        throw new Error(
          "The update feed isn't signed, so Relay won't install from it.",
        );
      if (!signedByAny(bytes, signature, this.options.keys ?? updateKeys))
        throw new Error(
          "The update feed's signature doesn't check out, so Relay won't install from it.",
        );
      const feed = feedSchema.parse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (!feed.headless || !newerVersion(feed.version, current)) {
        this.state = { status: "idle", current, checkedAt: Date.now() };
        return this.state;
      }
      this.found = { ...feed, headless: feed.headless };
      this.state = {
        status: "available",
        current,
        version: feed.version,
        ...(feed.notes ? { notes: feed.notes } : {}),
        install: "auto",
      };
    } catch (e) {
      this.state = { status: "error", current, message: message(e) };
    }
    return this.state;
  }

  download(): Promise<UpdateState> {
    return (this.downloading ??= this.downloadRelease().finally(() => {
      this.downloading = undefined;
    }));
  }

  private async downloadRelease(): Promise<UpdateState> {
    if (
      this.state.status === "idle" ||
      this.state.status === "error" ||
      this.state.status === "checking"
    )
      await this.check();
    const found = this.found,
      root = this.root;
    if (this.state.status !== "available" || !found || !root) return this.state;
    const { version } = found,
      current = this.current;
    this.state = { status: "downloading", current, version, progress: 0 };
    // Beside the install, so the swap is a rename on one disk.
    let staging: string | undefined;
    try {
      staging = await mkdtemp(`${root}.update-${version}-`);
      const archive = join(staging, found.headless.name);
      const received = await download(
        found.headless.url,
        archive,
        found.headless.sha512,
        {
          ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
          size: found.headless.size,
          progress: (received, total) => {
            this.state = {
              status: "downloading",
              current,
              version,
              progress: Math.min(1, received / total),
            };
          },
        },
      );
      if (received !== found.headless.size)
        throw new Error(
          "The download doesn't match the release; nothing changed.",
        );
      await extract(archive, staging);
      await rm(archive);
      const unpacked = join(staging, `relay-${version}`);
      const said = await readFile(join(unpacked, "VERSION"), "utf8").catch(
        () => "",
      );
      if (
        said.trim() !== version ||
        !existsSync(join(unpacked, "lib", "relay.cjs"))
      )
        throw new Error(
          "The download isn't a headless Relay; nothing changed.",
        );
      this.staged = unpacked;
      this.state = { status: "ready", current, version };
    } catch (e) {
      if (staging) await rm(staging, { recursive: true, force: true });
      this.state = { status: "error", current, version, message: message(e) };
    }
    return this.state;
  }

  install(): Promise<UpdateState> {
    return (this.installing ??= this.installRelease().finally(() => {
      this.installing = undefined;
    }));
  }

  private async installRelease(): Promise<UpdateState> {
    if (this.state.status !== "ready") await this.download();
    const root = this.root,
      staged = this.staged;
    if (this.state.status !== "ready" || !root || !staged) return this.state;
    const { version } = this.state;
    this.state = { status: "installing", current: this.current, version };
    let changed: boolean;
    try {
      changed = await replaceInstallation(root, staged, version, this.current);
      await rm(dirname(staged), { recursive: true, force: true }).catch((e) =>
        console.warn("Couldn't remove Relay's update staging:", e),
      );
      this.staged = undefined;
    } catch (e) {
      await rm(dirname(staged), { recursive: true, force: true }).catch(
        (cleanup) =>
          console.warn(
            "Couldn't remove Relay's failed update staging:",
            cleanup,
          ),
      );
      this.staged = undefined;
      this.state = {
        status: "error",
        current: this.current,
        version,
        message: message(e),
      };
      return this.state;
    }
    if (!changed) {
      this.current = version;
      // Another Relay home installed this release; this daemon still needs
      // to reload its code even though the filesystem swap is already done.
      this.options.restart?.();
      return (this.state = { status: "idle", current: version });
    }
    this.options.restart?.();
    return this.state;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
