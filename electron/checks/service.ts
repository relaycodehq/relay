import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { z } from "zod";
import { terminate } from "../platform/terminate";
import { findExecutable } from "../platform/executables";
import { git } from "../git/git";
import { inspectFolder } from "../git/repository";
import { configPath, detectProject } from "./detect";
import {
  digestSchema,
  filePathSchema,
  textSchema,
} from "../../shared/validation";
import type { PullRef } from "../../shared/types";
import {
  CHECKS_MEMORY_MB,
  memoryLabel,
  type ProjectCheckState,
  type SymbolQuery,
  type SymbolResult,
} from "../../shared/checks";
const resultSchema = z.object({
  seq: z.number().int().nonnegative(),
  diagnostics: z
    .array(
      z.object({
        path: filePathSchema.optional(),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        endColumn: z.number().int().positive().optional(),
        severity: z.enum(["error", "warning", "info"]),
        code: z.string().max(40),
        message: z.string().max(8000),
      }),
    )
    .max(1500),
  files: z.record(
    filePathSchema,
    z.object({
      hash: digestSchema,
      errors: z.number().int().nonnegative(),
      warnings: z.number().int().nonnegative(),
      suggestions: z.number().int().nonnegative(),
    }),
  ),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  suggestions: z.number().int().nonnegative(),
  truncated: z.boolean(),
  message: z.string().max(2000).optional(),
  engine: z.string().max(2000).optional(),
});
const symbolResultSchema = z.object({
  source: z
    .object({
      path: filePathSchema,
      text: textSchema,
      hash: digestSchema,
    })
    .optional(),
  display: z.string().max(20000),
  documentation: z.string().max(50000),
  locations: z
    .array(
      z.object({
        path: filePathSchema,
        line: z.number().int().positive(),
        column: z.number().int().positive(),
        length: z.number().int().nonnegative(),
        preview: z.string().max(300),
        hash: digestSchema,
      }),
    )
    .max(500),
  truncated: z.boolean(),
  external: z.boolean(),
});
type Session = {
  key: string;
  root: string;
  server: string | null;
  ref: PullRef | null;
  seq: number;
  updates: Map<string, number>;
  process: ChildProcessWithoutNullStreams;
  state: ProjectCheckState;
  lastValidated: number;
  paused: boolean;
  requests: Map<
    string,
    {
      resolve: (value: SymbolResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  timer?: ReturnType<typeof setTimeout>;
  /** Head, target and heap limit: a start asking for the same joins this session. */
  signature: string;
  /** Starts this session again with another heap limit. */
  relimit: (memoryMb: number) => Promise<unknown>;
};
/** Who holds the checker's heap limit, and the limit it has. */
export interface CheckLimits {
  projectId?: string;
  memoryMb: number;
}
export class ProjectChecks {
  /** One checker per folder in use; windows showing the same folder share it. */
  private sessions = new Map<string, Session>();
  /** Bumped by every stop, so a start still under way for that key gives up. */
  private generations = new Map<string, number>();
  private starting = new Map<
    string,
    { signature: string; promise: Promise<ProjectCheckState> }
  >();
  /** Who uses each key's checker, and whether each of them wants it paused. */
  private holders = new Map<string, Map<string, boolean>>();
  /**
   * `fallbackTypeScript` is Relay's own typescript.js, used when a project's
   * compiler has no language service API (TypeScript 7 whose server fails).
   */
  constructor(
    private worker: string,
    private fallbackTypeScript?: string,
  ) {}
  /**
   * `holder` lets go of the key's checker, which quits once nobody holds it.
   * Without a holder the checker stops for everyone; without a key, every one.
   */
  stop(key?: string, holder?: string) {
    if (key === undefined) {
      for (const k of new Set([
        ...this.sessions.keys(),
        ...this.starting.keys(),
      ]))
        this.stop(k);
      return;
    }
    const users = this.holders.get(key);
    if (holder !== undefined) {
      users?.delete(holder);
      if (users?.size) {
        this.applyPause(key);
        return;
      }
    }
    this.holders.delete(key);
    this.kill(key);
  }
  /** Ends the key's checker but keeps its holders, who may start it again. */
  private kill(key: string) {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.starting.delete(key);
    const s = this.sessions.get(key);
    if (!s) return;
    clearTimeout(s.timer);
    for (const r of s.requests.values()) {
      clearTimeout(r.timer);
      r.reject(new Error("Language service stopped."));
    }
    s.requests.clear();
    s.state.status = "stopped";
    s.state.files = {};
    s.state.diagnostics = [];
    s.process.stdin.end();
    terminate(s.process, { graceMs: 1500 });
  }
  /** Restarts the running checks of `projectId` with its new heap limit. */
  relimit(projectId: string, memoryMb: number) {
    for (const s of this.sessions.values()) {
      if (
        s.state.projectId !== projectId ||
        s.state.memory.limit === memoryMb ||
        s.state.status === "stopped"
      )
        continue;
      void s.relimit(memoryMb).catch((e) => {
        console.warn(
          "Live checks did not restart with the new memory limit",
          e,
        );
      });
    }
  }
  /**
   * Hold rechecks (the language service stays warm) until resumed. A shared
   * checker pauses only once every holder asks it to.
   */
  pause(key: string, paused: boolean, holder = "") {
    const users = this.holders.get(key);
    if (!users?.has(holder)) return;
    users.set(holder, paused);
    this.applyPause(key);
  }
  private wantsPause(key: string) {
    const users = this.holders.get(key);
    return !!users?.size && [...users.values()].every(Boolean);
  }
  private applyPause(key: string) {
    const s = this.sessions.get(key),
      paused = this.wantsPause(key);
    if (
      !s ||
      s.paused === paused ||
      ["stopped", "failed"].includes(s.state.status)
    )
      return;
    s.paused = paused;
    s.process.stdin.write(JSON.stringify({ pause: paused }) + "\n");
    if (paused) {
      clearTimeout(s.timer);
      s.state.status = "paused";
    } else if (s.state.status === "paused")
      // The worker reports "invalidated" next if anything changed meanwhile.
      s.state.status = s.state.checkedAt ? "ready" : "checking";
  }
  async state(key: string, head: string) {
    const s = this.sessions.get(key);
    if (!s || s.state.head !== head) return null;
    if (
      !["failed", "stopped"].includes(s.state.status) &&
      Date.now() - s.lastValidated > 3000
    ) {
      s.lastValidated = Date.now();
      try {
        const local = await this.checkout(s.root, s.server, s.ref);
        if (local.head !== head || !local.remoteMatches)
          throw new Error(
            "The local checkout changed. Refresh the project and restart live checks.",
          );
      } catch (e) {
        if (this.sessions.get(key) === s) this.kill(key);
        s.state.status = "failed";
        s.state.message =
          e instanceof Error ? e.message : "Could not verify the checkout.";
      }
    }
    return s.state;
  }
  private async checkout(
    root: string,
    server: string | null,
    ref: PullRef | null,
  ) {
    if (server && ref) return inspectFolder(root, server, ref);
    const path = await realpath(root);
    if (
      path !== root ||
      (await realpath(
        (await git(root, ["rev-parse", "--show-toplevel"])).trim(),
      )) !== path
    )
      throw new Error("The project root changed. Reopen the correct folder.");
    return {
      path,
      head: (await git(root, ["rev-parse", "HEAD"])).trim(),
      remoteMatches: true,
    };
  }
  /**
   * Starts the key's checker for `holder`, or joins the one already running
   * or starting with the same head, target and heap limit.
   */
  start(
    key: string,
    root: string,
    server: string | null,
    ref: PullRef | null,
    head: string,
    targetId: string,
    limits: CheckLimits = { memoryMb: CHECKS_MEMORY_MB },
    { holder = "", paused = false }: { holder?: string; paused?: boolean } = {},
  ): Promise<ProjectCheckState> {
    const users = this.holders.get(key) ?? new Map<string, boolean>();
    this.holders.set(key, users);
    users.set(holder, paused);
    return this.open(key, root, server, ref, head, targetId, limits);
  }
  private open(
    key: string,
    root: string,
    server: string | null,
    ref: PullRef | null,
    head: string,
    targetId: string,
    limits: CheckLimits,
  ): Promise<ProjectCheckState> {
    const signature = [head, targetId, limits.memoryMb].join("\0");
    const running = this.sessions.get(key);
    if (
      running?.signature === signature &&
      !["stopped", "failed"].includes(running.state.status)
    ) {
      this.applyPause(key);
      return Promise.resolve(running.state);
    }
    const pending = this.starting.get(key);
    if (pending?.signature === signature)
      return pending.promise.then((state) => {
        this.applyPause(key);
        return state;
      });
    const promise = this.launch(
      key,
      root,
      server,
      ref,
      head,
      targetId,
      limits,
      signature,
    );
    this.starting.set(key, { signature, promise });
    const settle = () => {
      if (this.starting.get(key)?.promise === promise)
        this.starting.delete(key);
    };
    promise.then(settle, settle);
    return promise;
  }
  private async launch(
    key: string,
    root: string,
    server: string | null,
    ref: PullRef | null,
    head: string,
    targetId: string,
    limits: CheckLimits,
    signature: string,
  ): Promise<ProjectCheckState> {
    this.kill(key);
    const generation = this.generations.get(key);
    const local = await this.checkout(root, server, ref);
    if (!local.remoteMatches || local.head !== head)
      throw new Error(
        "Live checks need the linked repository at this PR’s head commit. Your checkout has not been changed.",
      );
    const info = await detectProject(local.path),
      target = info.targets.find((t) => t.id === targetId);
    if (!target)
      throw new Error(
        "This check configuration is no longer available. Refresh the project settings.",
      );
    const node = await findExecutable("node");
    const runtime = await mkdtemp(join(tmpdir(), "relay-checks-"));
    const worker = join(runtime, "worker.mjs");
    try {
      await writeFile(worker, await readFile(this.worker), { mode: 0o600 });
      // Unbundled (tests), worker.mjs imports its worker-*.mjs siblings.
      if (basename(this.worker) === "worker.mjs")
        for (const name of await readdir(dirname(this.worker)))
          if (/^worker-.+\.mjs$/.test(name))
            await writeFile(
              join(runtime, name),
              await readFile(join(dirname(this.worker), name)),
              { mode: 0o600 },
            );
    } catch (e) {
      await rm(runtime, { recursive: true, force: true });
      throw e;
    }
    if (generation !== this.generations.get(key)) {
      await rm(runtime, { recursive: true, force: true });
      throw new Error("Live checks were stopped.");
    }
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/TOKEN|SECRET|PASSWORD|API_KEY|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH/i.test(
            key,
          ),
      ),
    );
    const paused = this.wantsPause(key);
    const child = spawn(
      node,
      [
        `--max-old-space-size=${limits.memoryMb}`,
        worker,
        local.path,
        JSON.stringify(target),
        paused ? "paused" : "",
        this.fallbackTypeScript ?? "",
      ],
      { cwd: local.path, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    const s: Session = {
      key,
      root: local.path,
      server,
      ref,
      seq: 0,
      updates: new Map(),
      process: child,
      lastValidated: Date.now(),
      paused,
      requests: new Map(),
      signature,
      relimit: (memoryMb) =>
        this.open(key, root, server, ref, head, targetId, {
          ...limits,
          memoryMb,
        }),
      state: {
        id: randomUUID(),
        head,
        target,
        status: paused ? "paused" : "checking",
        startedAt: Date.now(),
        diagnostics: [],
        files: {},
        errors: 0,
        warnings: 0,
        suggestions: 0,
        memory: { limit: limits.memoryMb },
        projectId: limits.projectId,
      },
    };
    this.sessions.set(key, s);
    const fail = (message: string) => {
      if (this.sessions.get(key) !== s || s.state.status === "stopped") return;
      this.kill(key);
      s.state.status = "failed";
      s.state.message = message;
    };
    const deadline = () => {
      clearTimeout(s.timer);
      s.timer = setTimeout(
        () =>
          fail(
            "Live checking took longer than 90 seconds. Stop other checks or check this project in your IDE.",
          ),
        90000,
      );
      s.timer.unref();
    };
    let buffer = "",
      stderr = "";
    if (!paused) deadline();
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
        fail("Compiler output exceeded the live-check limit.");
        return;
      }
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        if (
          this.sessions.get(key) !== s ||
          ["stopped", "failed"].includes(s.state.status)
        )
          continue;
        try {
          const value = JSON.parse(line);
          if (value.type === "memory") {
            if (Number.isInteger(value.used) && value.used >= 0)
              s.state.memory = { limit: limits.memoryMb, used: value.used };
            continue;
          }
          if (value.type === "symbol") {
            const request = s.requests.get(value.requestId);
            if (request) {
              clearTimeout(request.timer);
              s.requests.delete(value.requestId);
              if (value.error || value.seq !== s.seq)
                request.reject(
                  new Error(
                    value.error ??
                      "The file changed while finding the symbol. Retry.",
                  ),
                );
              else {
                const parsed = symbolResultSchema.safeParse(value.result);
                if (parsed.success) request.resolve(parsed.data);
                else
                  request.reject(
                    new Error(
                      "The language service returned an invalid symbol response.",
                    ),
                  );
              }
            }
            continue;
          }
          if (value.seq !== s.seq) continue;
          if (value.type === "checking" || value.type === "invalidated") {
            // Do not show stale line positions while buffers or files change.
            s.state.files = {};
            s.state.diagnostics = [];
            if (!s.paused) {
              s.state.status = "checking";
              deadline();
            }
          } else if (value.type === "result") {
            const r = resultSchema.parse(value);
            clearTimeout(s.timer);
            Object.assign(s.state, {
              ...r,
              status: s.paused ? "paused" : "ready",
              checkedAt: Date.now(),
              message: r.message,
            });
          } else if (value.type === "failure")
            fail(String(value.message).slice(0, 2000));
        } catch {
          fail("The project compiler returned an invalid diagnostic response.");
        }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-3000);
    });
    child.on("error", (e) =>
      fail(`Could not start the project compiler: ${e.message}`),
    );
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      void rm(runtime, { recursive: true, force: true });
      clearTimeout(s.timer);
      if (
        this.sessions.get(key) === s &&
        !["stopped", "failed"].includes(s.state.status)
      )
        fail(
          /heap|allocation failed/i.test(stderr)
            ? `The project compiler ran out of its ${memoryLabel(limits.memoryMb)} memory limit. ${limits.projectId ? "Raise it in the project’s settings" : "Add the folder as a project to raise it"}, or use your IDE for this project.`
            : `The project compiler exited (${code ?? "signal"}). Check the installed dependencies and Node.js version.`,
        );
    });
    return s.state;
  }
  async symbol(
    key: string,
    head: string,
    query: SymbolQuery,
  ): Promise<SymbolResult> {
    const s = this.sessions.get(key);
    if (!s || s.state.head !== head)
      throw new Error(
        "Wait for live checks to finish before navigating symbols.",
      );
    // Opening or editing a file starts a recheck; a lookup made meanwhile
    // waits for it instead of failing.
    const until = Date.now() + 15000;
    while (
      this.sessions.get(key) === s &&
      s.state.status === "checking" &&
      Date.now() < until
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (
      this.sessions.get(key) !== s ||
      !["ready", "paused"].includes(s.state.status)
    )
      throw new Error(
        "Wait for live checks to finish before navigating symbols.",
      );
    if (s.requests.size >= 32)
      throw new Error("Too many symbol lookups. Please retry.");
    await configPath(s.root, query.path);
    if (
      this.sessions.get(key) !== s ||
      !["ready", "paused"].includes(s.state.status)
    )
      throw new Error("The active project changed. Wait for checks and retry.");
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.requests.delete(requestId);
        reject(new Error("Symbol lookup timed out."));
      }, 15000);
      timer.unref();
      s.requests.set(requestId, { resolve, reject, timer });
      s.process.stdin.write(JSON.stringify({ ...query, requestId }) + "\n");
    });
  }
  async update(key: string, head: string, path: string, text: string | null) {
    const s = this.sessions.get(key);
    if (
      !s ||
      s.state.head !== head ||
      ["stopped", "failed"].includes(s.state.status)
    )
      return;
    filePathSchema.parse(path);
    const order = (s.updates.get(path) ?? 0) + 1;
    s.updates.set(path, order);
    await configPath(s.root, path);
    if (
      this.sessions.get(key) !== s ||
      s.updates.get(path) !== order ||
      ["stopped", "failed"].includes(s.state.status)
    )
      return;
    s.seq++;
    if (!s.paused) s.state.status = "checking";
    s.state.files = {};
    s.state.diagnostics = [];
    s.process.stdin.write(JSON.stringify({ seq: s.seq, path, text }) + "\n");
  }
}
