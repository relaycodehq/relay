import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  newerVersion,
  updateFeed,
  updateFileSchema,
  type UpdateState,
} from "../../shared/updates";
import { download, extract, renameSoon } from "./archive";

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
  constructor(
    private root: string | null,
    private current: string,
    private options: {
      feed?: string;
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

  async check(): Promise<UpdateState> {
    const busy = ["checking", "downloading", "ready", "installing"];
    if (!this.root || busy.includes(this.state.status)) return this.state;
    const current = this.current;
    this.state = { status: "checking", current };
    try {
      const response = await (this.options.fetch ?? fetch)(
        // RELAY_UPDATE_FEED stands in a feed served on this machine, as for the desktop.
        this.options.feed ?? (process.env.RELAY_UPDATE_FEED || updateFeed),
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok)
        throw new Error(`The update feed answered ${response.status}.`);
      const feed = feedSchema.parse(await response.json());
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

  async download(): Promise<UpdateState> {
    if (this.state.status === "idle" || this.state.status === "error")
      await this.check();
    const found = this.found,
      root = this.root;
    if (this.state.status !== "available" || !found || !root) return this.state;
    const { version } = found,
      current = this.current;
    this.state = { status: "downloading", current, version, progress: 0 };
    // Beside the install, so the swap is a rename on one disk.
    const staging = `${root}.update-${version}`;
    try {
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
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
      await rm(staging, { recursive: true, force: true });
      this.state = { status: "error", current, version, message: message(e) };
    }
    return this.state;
  }

  async install(): Promise<UpdateState> {
    if (this.state.status !== "ready") await this.download();
    const root = this.root,
      staged = this.staged;
    if (this.state.status !== "ready" || !root || !staged) return this.state;
    const { version } = this.state;
    this.state = { status: "installing", current: this.current, version };
    const old = `${root}.old-${this.current}`;
    try {
      await rm(old, { recursive: true, force: true });
      await renameSoon(root, old);
      try {
        await renameSoon(staged, root);
      } catch (e) {
        await renameSoon(old, root);
        throw e;
      }
      await rm(dirname(staged), { recursive: true, force: true });
      await rm(old, { recursive: true, force: true });
    } catch (e) {
      this.state = {
        status: "error",
        current: this.current,
        version,
        message: message(e),
      };
      return this.state;
    }
    this.options.restart?.();
    return this.state;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
