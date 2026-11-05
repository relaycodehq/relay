import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm, realpath } from "node:fs/promises";
import { terminate } from "../platform/terminate";
import { findExecutable } from "../platform/executables";
import { git } from "../git/git";
import { inspectFolder } from "../git/repository";
import { configPath, detectProject } from "./detect";
import { filePathSchema } from "../../shared/validation";
import type { PullRef } from "../../shared/types";
import {
  CHECKS_MEMORY_MB,
  memoryLabel,
  type ProjectCheckState,
  type SymbolQuery,
  type SymbolResult,
} from "../../shared/checks";
import { LineBuffer } from "../util/line-buffer";
import { readWorkerLine, type Session } from "./session";
import { stageWorker, workerEnv } from "./worker-runtime";

/**
 * How often a state read looks at the checkout again; the window asks every
 * second. A working tree's checks get their head from the window's working
 * tree, which notices a commit or a switch within seconds, so this only
 * catches what that misses. A PR's head comes from GitHub, so nothing else
 * notices the checkout moving off it: those look every few seconds.
 */
export const revalidateMs = { tree: 30_000, pull: 3000 };

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
    const pull = !!(s.server && s.ref);
    if (
      !["failed", "stopped"].includes(s.state.status) &&
      Date.now() - s.lastValidated > revalidateMs[pull ? "pull" : "tree"]
    ) {
      s.lastValidated = Date.now();
      try {
        // The remote was checked at the start and doesn't change under a session.
        if ((await checkoutHead(s.root, !pull)) !== head)
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
    return {
      path: await realpath(root),
      head: await checkoutHead(root, true),
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
    const runtime = await stageWorker(this.worker);
    const worker = join(runtime, "worker.mjs");
    if (generation !== this.generations.get(key)) {
      await rm(runtime, { recursive: true, force: true });
      throw new Error("Live checks were stopped.");
    }
    const env = workerEnv();
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
    this.followWorker(s, runtime, limits);
    return s.state;
  }

  /**
   * Reads what the session's worker reports and fails the session when the
   * worker stalls, floods its output or exits; `runtime` goes once it exits.
   */
  private followWorker(s: Session, runtime: string, limits: CheckLimits) {
    const { key, process: child } = s;
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
    let stderr = "";
    if (!s.paused) deadline();
    const lines = new LineBuffer((line) => {
      if (!line.trim()) return;
      if (
        this.sessions.get(key) !== s ||
        ["stopped", "failed"].includes(s.state.status)
      )
        return;
      readWorkerLine(s, line, { memoryMb: limits.memoryMb, fail, deadline });
    });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      lines.push(chunk);
      if (lines.pending > 8 * 1024 * 1024) {
        lines.clear();
        fail("Compiler output exceeded the live-check limit.");
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

/**
 * The head of the checkout at `root`, with one Git call. Fails when `root`
 * is no longer the top of its repository, or, `exact`, when it's reached
 * through a link: a project's folder must be the checkout itself.
 */
async function checkoutHead(root: string, exact: boolean) {
  const path = await realpath(root);
  const [top = "", head = ""] = (
    await git(root, ["rev-parse", "--show-toplevel", "HEAD"])
  )
    .trim()
    .split(/\r?\n/);
  if ((exact && path !== root) || (await realpath(top)) !== path)
    throw new Error("The project root changed. Reopen the correct folder.");
  return head;
}
