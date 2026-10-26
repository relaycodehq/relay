import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { z } from "zod";
import { gunzipTo, unzipTo } from "./archive";
import type { ServerSpec } from "./registry";

/** A program Relay put in its own folder: `exe` is the program, or the JavaScript file Node runs. */
export interface Installed {
  version: string;
  exe: string;
  node: boolean;
}

export type Progress = (received: number, total: number) => void;

/** Relay can't get this server on this computer, and what to do about it. */
export class UnavailableError extends Error {}

export interface InstallDeps {
  /** The `language-servers` folder in Relay's data. */
  dir: string;
  fetch: typeof fetch;
  platform: NodeJS.Platform;
  arch: string;
  /** The user's npm; rejects where there is none. */
  npm(): Promise<string>;
  /** Runs a program in `cwd` and collects what it printed; never longer than `timeout`. */
  run(
    file: string,
    args: string[],
    cwd: string,
    timeout: number,
  ): Promise<{ code: number | null; output: string }>;
  /** Whether a program starts and answers its arguments. */
  probe(file: string, args: string[]): Promise<boolean>;
}

const release = z.object({
  tag_name: z.string().min(1),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number().optional(),
      digest: z.string().nullish(),
    }),
  ),
});

const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const NPM_TIMEOUT_MS = 5 * 60_000;
const STALE_TEMP_MS = 60 * 60_000;

/** Oldest first for `a < b`; numbers in names compare as numbers (`1.9` before `1.10`). */
export function compareVersions(a: string, b: string) {
  const parts = (v: string) =>
    v
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference) return difference;
  }
  // Same numbers, so the text decides and the order stays stable.
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const safeName = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, "_");
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** An install under way, shared by everyone who asks for that server meanwhile. */
interface InstallJob {
  done: Promise<Installed>;
  listeners: Set<Progress>;
  /** The latest progress, for a caller that joins late. */
  last?: [number, number];
}

/**
 * Keeps language servers in `<dir>/<server>/<version>/`. A version is built
 * in a folder beside it and renamed into place, so a folder with a version's
 * name is always whole.
 */
export class ServerInstaller {
  private running = new Map<string, InstallJob>();

  constructor(private deps: InstallDeps) {}

  /** The newest version already here that runs on this computer. */
  async installed(spec: ServerSpec): Promise<Installed | undefined> {
    const folder = join(this.deps.dir, spec.id);
    const versions = (await readdir(folder).catch(() => [] as string[]))
      .filter((name) => !name.startsWith("."))
      .sort(compareVersions)
      .reverse();
    for (const version of versions) {
      const found = await this.locate(spec, join(folder, version), version);
      if (found) return found;
    }
  }

  /**
   * Downloads or installs the latest version. Callers for one server share
   * one download; each hears its progress.
   */
  ensure(spec: ServerSpec, progress?: Progress): Promise<Installed> {
    const job = this.running.get(spec.id) ?? this.startInstall(spec);
    if (progress) {
      job.listeners.add(progress);
      if (job.last) progress(...job.last);
    }
    return job.done;
  }

  private startInstall(spec: ServerSpec) {
    const listeners = new Set<Progress>();
    const job: InstallJob = {
      listeners,
      done: this.fetchLatest(spec, (received, total) => {
        job.last = [received, total];
        for (const listener of listeners) listener(received, total);
      }).finally(() => this.running.delete(spec.id)),
    };
    this.running.set(spec.id, job);
    return job;
  }

  private async fetchLatest(spec: ServerSpec, progress: Progress) {
    const folder = join(this.deps.dir, spec.id);
    await mkdir(folder, { recursive: true });
    await this.clearStale(folder);
    const staging = join(folder, `.tmp-${randomUUID()}`);
    await mkdir(staging);
    try {
      if (spec.github) return await this.fromGithub(spec, staging, progress);
      if (spec.npm) return await this.fromNpm(spec, staging, progress);
      throw new UnavailableError(spec.hint);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async fromGithub(
    spec: ServerSpec,
    staging: string,
    progress: Progress,
  ): Promise<Installed> {
    const source = spec.github!;
    const plan = source.asset(this.deps.platform, this.deps.arch);
    if (!plan)
      throw new UnavailableError(
        `${spec.id} has no download for this computer. ${spec.hint}`,
      );
    const meta = release.parse(
      await this.getJson(
        `https://api.github.com/repos/${source.repo}/releases/latest`,
      ),
    );
    const asset = meta.assets.find((a) => plan.pattern.test(a.name));
    if (!asset)
      throw new UnavailableError(
        `${spec.id} ${meta.tag_name} has no build for this computer. ${spec.hint}`,
      );
    const version = safeName(meta.tag_name);
    const target = join(this.deps.dir, spec.id, version);
    const already = await this.locate(spec, target, version);
    if (already) return already;

    const archive = join(staging, "download");
    await this.download(asset.browser_download_url, archive, {
      digest: asset.digest ?? undefined,
      size: asset.size,
      progress,
    });
    const unpacked = join(staging, "unpacked");
    await mkdir(unpacked);
    if (plan.archive === "gz")
      await gunzipTo(archive, join(unpacked, plan.exe));
    else await unzipTo(archive, unpacked, plan.strip ?? 0);
    await rm(archive, { force: true });
    const exe = join(unpacked, plan.exe);
    if (!(await exists(exe)))
      throw new Error(`${spec.id}'s download has no ${plan.exe}.`);
    if (this.deps.platform !== "win32") await chmod(exe, 0o755);
    if (spec.probe && !(await this.deps.probe(exe, spec.probe)))
      throw new Error(
        `The downloaded ${spec.id} doesn't run on this computer. ${spec.hint}`,
      );
    return this.place(spec, unpacked, target, version);
  }

  private async fromNpm(
    spec: ServerSpec,
    staging: string,
    progress: Progress,
  ): Promise<Installed> {
    const { package: name } = spec.npm!;
    const npm = await this.deps.npm().catch(() => {
      throw new UnavailableError(
        `${spec.id} installs with npm, which Relay couldn't find. ${spec.hint}`,
      );
    });
    progress(0, 0);
    // Scripts never run: the packages need none, and a registry is not trusted with them.
    const run = await this.deps.run(
      npm,
      [
        "install",
        "--prefix",
        staging,
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        `${name}@latest`,
      ],
      staging,
      NPM_TIMEOUT_MS,
    );
    if (run.code !== 0)
      throw new Error(
        `npm could not install ${name}: ${run.output.trim().slice(-400) || "no output"}`,
      );
    const manifest = await readManifest(staging, name);
    const version = safeName(String(manifest.version ?? "unknown"));
    const target = join(this.deps.dir, spec.id, version);
    return this.place(spec, staging, target, version);
  }

  /** Renames the finished folder to its version; an install of the same version that got there first wins. */
  private async place(
    spec: ServerSpec,
    built: string,
    target: string,
    version: string,
  ): Promise<Installed> {
    try {
      await rename(built, target);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY" && code !== "EPERM")
        throw e;
    }
    const found = await this.locate(spec, target, version);
    if (!found) throw new Error(`${spec.id} didn't install.`);
    void this.dropOlder(spec, version);
    return found;
  }

  /** The program in a version's folder, if it is complete. */
  private async locate(
    spec: ServerSpec,
    folder: string,
    version: string,
  ): Promise<Installed | undefined> {
    if (spec.github) {
      const plan = spec.github.asset(this.deps.platform, this.deps.arch);
      const exe = plan && join(folder, plan.exe);
      return exe && (await exists(exe))
        ? { version, exe, node: false }
        : undefined;
    }
    if (spec.npm) {
      try {
        const manifest = await readManifest(folder, spec.npm.package);
        const bin = manifest.bin;
        const rel = typeof bin === "string" ? bin : bin?.[spec.npm.bin];
        if (!rel) return undefined;
        const exe = join(folder, "node_modules", spec.npm.package, rel);
        return (await exists(exe)) ? { version, exe, node: true } : undefined;
      } catch {
        return undefined;
      }
    }
  }

  private async dropOlder(spec: ServerSpec, keep: string) {
    const folder = join(this.deps.dir, spec.id);
    for (const name of await readdir(folder).catch(() => [] as string[]))
      if (name !== keep && !name.startsWith("."))
        await rm(join(folder, name), { recursive: true, force: true }).catch(
          () => {},
        );
  }

  private async clearStale(folder: string) {
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      if (!name.startsWith(".tmp-")) continue;
      const age = await stat(join(folder, name)).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > STALE_TEMP_MS)
        await rm(join(folder, name), { recursive: true, force: true }).catch(
          () => {},
        );
    }
  }

  private async getJson(url: string) {
    const response = await this.deps.fetch(url, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 403 || response.status === 429
          ? "GitHub is limiting downloads right now; try again in a while."
          : `GitHub answered ${response.status}.`,
      );
    return response.json();
  }

  private async download(
    url: string,
    file: string,
    options: { digest?: string; size?: number; progress: Progress },
  ) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com")
      throw new Error(`Refusing to download from ${parsed.origin}.`);
    const response = await this.deps.fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body)
      throw new Error(`The download answered ${response.status}.`);
    const total =
      options.size ?? Number(response.headers.get("content-length") ?? 0);
    if (total > MAX_DOWNLOAD_BYTES)
      throw new Error("The download is larger than expected; not fetching it.");
    const hash = createHash("sha256");
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          if (received > MAX_DOWNLOAD_BYTES)
            return done(new Error("The download is larger than expected."));
          hash.update(chunk);
          options.progress(received, total);
          done(null, chunk);
        },
      }),
      createWriteStream(file),
    );
    const want = /^sha256:([0-9a-f]{64})$/i.exec(options.digest ?? "")?.[1];
    if (want && hash.digest("hex") !== want.toLowerCase())
      throw new Error("The download doesn't match its checksum; discarded.");
  }
}

async function readManifest(folder: string, name: string) {
  const text = await readFile(
    join(folder, "node_modules", ...name.split("/"), "package.json"),
    "utf8",
  );
  return z
    .object({
      version: z.string().optional(),
      bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
    })
    .parse(JSON.parse(text)) as {
    version?: string;
    bin?: string | Record<string, string>;
  };
}
