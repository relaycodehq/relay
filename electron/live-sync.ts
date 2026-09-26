import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git, gitBytes } from "./git";
import { digest } from "./hash";
import { serializeRepo, ignoredPaths, gitOperation } from "./working-tree";
import { decodeText, readWorkingFile, writeWorkingFile } from "./working-files";
import {
  syncManifestSchema,
  syncDocumentSchema,
  idleSync,
  type SyncDocument,
  type SyncState,
  type SyncValue,
  type SyncFile,
} from "../shared/live-sync";
import { workingPathSchema } from "../shared/working-tree";
export type SyncTransport = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<unknown>;
type Version = { hash: string | null; mode: number | null; revision: number };
const metadata = (v: Version): Version => ({
  hash: v.hash,
  mode: v.mode,
  revision: v.revision,
});
type Checkpoint = {
  base: string;
  branch: string;
  seen: Record<string, Version>;
};
const version = (value: SyncValue, revision = 0): Version => ({
  hash: value ? digest(value.contents) : null,
  mode: value?.mode ?? null,
  revision,
});
const same = (a: Version, b: Version) => a.hash === b.hash && a.mode === b.mode;
const localValue = (
  v: Awaited<ReturnType<typeof readWorkingFile>>,
): SyncValue =>
  v ? { contents: v.contents, mode: v.mode & 0o111 ? 0o755 : 0o644 } : null;
export class LiveSync {
  private checkpoint!: Checkpoint;
  private state: SyncState = { ...idleSync };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private baseline = new Map<string, Version>();
  constructor(
    readonly root: string,
    private checkpointPath: string,
    private transport: SyncTransport,
    private validate: () => Promise<unknown>,
    private pollInterval = 1800,
  ) {}
  status(): SyncState {
    return structuredClone(this.state);
  }
  private async assertCheckout() {
    await this.validate();
    const branch = (await git(this.root, ["branch", "--show-current"])).trim();
    if (branch !== this.checkpoint.branch)
      throw new Error(
        `Live sync paused: return to branch ${this.checkpoint.branch}, then resume.`,
      );
    await git(this.root, [
      "merge-base",
      "--is-ancestor",
      this.checkpoint.base,
      "HEAD",
    ]).catch(() => {
      throw new Error(
        "Your checkout does not contain the shared base commit. Fetch and check out the matching PR branch before resuming.",
      );
    });
    if (await gitOperation(this.root))
      throw new Error("Finish your Git operation before resuming live sync.");
    if ((await git(this.root, ["ls-files", "-u"])).trim())
      throw new Error("Resolve Git conflicts before resuming live sync.");
  }
  async start() {
    await this.validate();
    const branch = (await git(this.root, ["branch", "--show-current"])).trim();
    if (!branch)
      throw new Error("Check out a branch before enabling live sync.");
    const head = (await git(this.root, ["rev-parse", "HEAD"])).trim();
    const manifest = syncManifestSchema.parse(
      await this.transport("", "POST", { base: head }),
    );
    let saved: Checkpoint | null = null;
    try {
      saved = JSON.parse(await readFile(this.checkpointPath, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "The live-sync checkpoint cannot be read. It has been preserved; sync has not started.",
        );
    }
    if (saved && (saved.base !== manifest.base || saved.branch !== branch))
      throw new Error(
        `This checkout previously synced branch ${saved.branch}. Return to that branch to resume.`,
      );
    this.checkpoint = saved ?? { base: manifest.base, branch, seen: {} };
    this.checkpoint.seen = Object.assign(
      Object.create(null),
      this.checkpoint.seen,
    );
    await this.assertCheckout();
    await this.save();
    this.stopped = false;
    this.state = {
      ...idleSync,
      active: true,
      base: manifest.base,
      branch,
      files: manifest.files.length,
    };
    await this.tick();
    this.schedule();
    return this.status();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => void this.tick().finally(() => this.schedule()),
      this.pollInterval,
    );
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
    this.state.active = false;
  }
  private async save() {
    await mkdir(dirname(this.checkpointPath), { recursive: true, mode: 0o700 });
    await writeFile(
      this.checkpointPath + ".tmp",
      JSON.stringify(this.checkpoint),
      { mode: 0o600 },
    );
    await rename(this.checkpointPath + ".tmp", this.checkpointPath);
  }
  private async base(path: string): Promise<Version> {
    const cached = this.baseline.get(path);
    if (cached) return cached;
    const entry = await git(this.root, [
      "ls-tree",
      "-z",
      this.checkpoint.base,
      "--",
      path,
    ]);
    let value: SyncValue = null;
    if (entry) {
      if (!/^100(644|755) blob [a-f0-9]+\t/.test(entry))
        throw new Error("Symlinks and submodules are not synchronized.");
      const contents = decodeText(
        await gitBytes(this.root, ["show", `${this.checkpoint.base}:${path}`]),
      );
      value = { contents, mode: entry.startsWith("100755") ? 0o755 : 0o644 };
    }
    const result = version(value);
    this.baseline.set(path, result);
    return result;
  }
  private async candidates() {
    const tracked = await git(this.root, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      this.checkpoint.base,
      "--",
    ]);
    const untracked = await git(this.root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    return (tracked + untracked)
      .split("\0")
      .filter(Boolean)
      .filter(
        (p) =>
          !p.split("/").some((v) => /^\.relay-sync-[a-f0-9-]+\.tmp$/.test(v)),
      );
  }
  private async eligible(path: string) {
    workingPathSchema.parse(path);
    const ignored = await ignoredPaths(this.root, [path]);
    if (ignored.has(path))
      throw new Error(
        "Ignored by this checkout’s Git rules; not synchronized.",
      );
  }
  private async document(meta: SyncFile): Promise<SyncDocument> {
    const doc = syncDocumentSchema.parse(
      await this.transport(`/file?path=${encodeURIComponent(meta.path)}`),
    );
    const actual = version(doc.value, doc.revision);
    if (
      doc.path !== meta.path ||
      doc.revision < meta.revision ||
      !same(actual, doc)
    )
      throw new Error("Shared file integrity check failed.");
    return doc;
  }
  async tick(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.stopped) return;
    this.pending = serializeRepo(this.root, async () => {
      try {
        await this.assertCheckout();
        const manifest = syncManifestSchema.parse(await this.transport(""));
        if (manifest.base !== this.checkpoint.base)
          throw new Error("The shared workspace base changed. Sync is paused.");
        const remote = new Map(manifest.files.map((f) => [f.path, f]));
        const paths = [
          ...new Set([
            ...(await this.candidates()),
            ...remote.keys(),
            ...Object.keys(this.checkpoint.seen),
          ]),
        ].sort();
        const conflicts: SyncState["conflicts"] = [],
          excluded: SyncState["excluded"] = [];
        if (paths.length > 2000)
          throw new Error(
            "More than 2,000 files changed against the shared base. Sync is paused.",
          );

        const ignored = await ignoredPaths(this.root, paths);
        for (const path of paths) {
          if (this.stopped) break;
          try {
            workingPathSchema.parse(path);
            if (ignored.has(path))
              throw new Error(
                "Ignored by this checkout’s Git rules; not synchronized.",
              );
            const local = localValue(await readWorkingFile(this.root, path)),
              lv = version(local);
            const acknowledged =
              this.checkpoint.seen[path] ?? (await this.base(path));
            let meta = remote.get(path),
              rv: Version = meta ?? (await this.base(path));
            if (same(lv, rv)) {
              this.checkpoint.seen[path] = metadata(rv);
              continue;
            }
            if (!same(lv, acknowledged) && !same(rv, acknowledged)) {
              conflicts.push({
                path,
                author: meta?.author ?? "Shared workspace",
              });
              continue;
            }
            if (!same(rv, acknowledged)) {
              if (!meta) throw new Error("Shared file metadata is missing.");
              const doc = await this.document(meta);
              rv = doc;
              // Re-read after network round-trip. The atomic writer checks again before replacing.
              await this.assertCheckout();
              await writeWorkingFile(this.root, path, lv.hash, doc.value, () =>
                this.assertCheckout(),
              );
              this.checkpoint.seen[path] = metadata(rv);
            } else {
              await this.assertCheckout();
              const doc = syncDocumentSchema.parse(
                await this.transport("/file", "PUT", {
                  path,
                  expected: rv.revision,
                  value: local,
                }),
              );
              this.checkpoint.seen[path] = metadata(doc);
            }
            await this.save();
          } catch (e) {
            excluded.push({
              path,
              reason: e instanceof Error ? e.message : String(e),
            });
          }
        }
        await this.save();
        this.state = {
          ...this.state,
          files: Math.max(
            manifest.files.length,
            Object.keys(this.checkpoint.seen).length,
          ),
          lastSync: Date.now(),
          error: null,
          conflicts,
          excluded,
        };
      } catch (e) {
        this.state.error = e instanceof Error ? e.message : String(e);
      }
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  conflict(path: string) {
    return serializeRepo(this.root, () => this.readConflict(path));
  }
  private async readConflict(path: string) {
    await this.assertCheckout();
    await this.eligible(path);
    const local = localValue(await readWorkingFile(this.root, path));
    const doc = syncDocumentSchema.parse(
      await this.transport(`/file?path=${encodeURIComponent(path)}`),
    );
    if (doc.path !== path || !same(version(doc.value), doc))
      throw new Error("Shared file integrity check failed.");
    return {
      local,
      shared: doc.value,
      revision: doc.revision,
      localHash: version(local).hash,
      author: doc.author,
    };
  }
  async resolve(
    path: string,
    choice: "local" | "shared",
    revision: number,
    localHash: string | null,
  ) {
    await this.pending;
    await serializeRepo(this.root, async () => {
      const current = await this.readConflict(path);
      if (current.revision !== revision || current.localHash !== localHash)
        throw new Error(
          "The file changed again. Reopen the conflict before resolving it.",
        );
      let doc: SyncDocument;
      if (choice === "local")
        doc = syncDocumentSchema.parse(
          await this.transport("/file", "PUT", {
            path,
            expected: revision,
            value: current.local,
          }),
        );
      else {
        await writeWorkingFile(this.root, path, localHash, current.shared, () =>
          this.assertCheckout(),
        );
        doc = syncDocumentSchema.parse(
          await this.transport(`/file?path=${encodeURIComponent(path)}`),
        );
        if (doc.revision !== revision) {
          throw new Error(
            "A colleague saved again. The newer version will be checked on the next sync.",
          );
        }
      }
      this.checkpoint.seen[path] = {
        ...version(choice === "local" ? current.local : current.shared),
        revision,
      };
      if (choice === "local") this.checkpoint.seen[path] = metadata(doc);
      await this.save();
    });
    await this.tick();
  }
}

/** Where a live sync runs: its checkout, and the transport to the shared copy. */
export interface SyncWorkspace {
  id: string;
  root: string;
  validate: () => Promise<unknown>;
  request: SyncTransport;
}

/** Every live sync, by conversation or PR key. A checkout syncs one at a time. */
export class LiveSyncs {
  private syncs = new Map<string, LiveSync>();
  private starting = new Set<string>();
  /** `dir` is read when a sync starts: where each sync keeps its state. */
  constructor(private dir: () => string) {}
  get(key: string) {
    return this.syncs.get(key);
  }
  /** A sync is starting or running in this checkout, other than `key`'s. */
  busy(root: string, key?: string) {
    return (
      this.starting.has(root) ||
      [...this.syncs].some(
        ([other, sync]) =>
          other !== key && sync.root === root && sync.status().active,
      )
    );
  }
  async start(key: string, workspace: SyncWorkspace) {
    const current = this.syncs.get(key);
    if (current?.status().active) return current.status();
    if (this.busy(workspace.root, key))
      throw new Error(
        "This checkout is syncing another conversation. Pause it first or use a separate checkout.",
      );
    const sync = new LiveSync(
      workspace.root,
      join(this.dir(), digest(workspace.root + workspace.id) + ".json"),
      workspace.request,
      workspace.validate,
    );
    this.starting.add(workspace.root);
    try {
      const state = await sync.start();
      this.syncs.set(key, sync);
      return state;
    } finally {
      this.starting.delete(workspace.root);
    }
  }
  /** Stops the syncs `where` picks by their key and checkout. */
  async stopWhere(where: (key: string, root: string) => boolean) {
    await Promise.all(
      [...this.syncs]
        .filter(([key, sync]) => where(key, sync.root))
        .map(([, sync]) => sync.stop()),
    );
  }
  async stopAll() {
    await this.stopWhere(() => true);
    this.syncs.clear();
  }
}
