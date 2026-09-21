import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { z } from "zod";
import { findExecutable } from "../executables";
import { inspectFolder } from "../repository";
import { configPath, detectProject } from "./detect";
import { filePathSchema } from "../../shared/validation";
import type { PullRef } from "../../shared/types";
import type {
  ProjectCheckState,
  SymbolQuery,
  SymbolResult,
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
      hash: z.string().regex(/^[a-f0-9]{64}$/),
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
});
const symbolResultSchema = z.object({
  source: z
    .object({
      path: filePathSchema,
      text: z.string().max(2 * 1024 * 1024),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
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
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(500),
  truncated: z.boolean(),
  external: z.boolean(),
});
type Session = {
  key: string;
  root: string;
  server: string;
  ref: PullRef;
  seq: number;
  updates: Map<string, number>;
  process: ChildProcessWithoutNullStreams;
  state: ProjectCheckState;
  lastValidated: number;
  requests: Map<
    string,
    {
      resolve: (value: SymbolResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  timer?: ReturnType<typeof setTimeout>;
};
export class ProjectChecks {
  private session?: Session;
  private generation = 0;
  private pendingKey?: string;
  constructor(private worker: string) {}
  stop(key?: string) {
    const s = this.session;
    if (key && s?.key !== key && this.pendingKey !== key) return;
    this.generation++;
    this.pendingKey = undefined;
    if (!s || (key && s.key !== key)) return;
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
    s.process.kill("SIGTERM");
    const hard = setTimeout(() => {
      if (s.process.exitCode === null) s.process.kill("SIGKILL");
    }, 1500);
    hard.unref();
  }
  async state(key: string, head: string) {
    const s = this.session;
    if (!s || s.key !== key || s.state.head !== head) return null;
    if (
      !["failed", "stopped"].includes(s.state.status) &&
      Date.now() - s.lastValidated > 3000
    ) {
      s.lastValidated = Date.now();
      try {
        const local = await inspectFolder(s.root, s.server, s.ref);
        if (local.head !== head || !local.remoteMatches)
          throw new Error(
            "The local checkout changed. Switch to this PR’s head and restart live checks.",
          );
      } catch (e) {
        if (this.session === s) this.stop(key);
        s.state.status = "failed";
        s.state.message =
          e instanceof Error ? e.message : "Could not verify the checkout.";
      }
    }
    return s.state;
  }
  async start(
    key: string,
    root: string,
    server: string,
    ref: PullRef,
    head: string,
    targetId: string,
  ) {
    this.stop();
    this.pendingKey = key;
    const generation = this.generation;
    const local = await inspectFolder(root, server, ref);
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
    } catch (e) {
      await rm(runtime, { recursive: true, force: true });
      throw e;
    }
    if (generation !== this.generation) {
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
    const child = spawn(
      node,
      ["--max-old-space-size=768", worker, local.path, JSON.stringify(target)],
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
      requests: new Map(),
      state: {
        id: randomUUID(),
        head,
        target,
        status: "checking",
        startedAt: Date.now(),
        diagnostics: [],
        files: {},
        errors: 0,
        warnings: 0,
        suggestions: 0,
      },
    };
    this.session = s;
    this.pendingKey = undefined;
    const fail = (message: string) => {
      if (this.session !== s || s.state.status === "stopped") return;
      this.stop(key);
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
    deadline();
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
          this.session !== s ||
          ["stopped", "failed"].includes(s.state.status)
        )
          continue;
        try {
          const value = JSON.parse(line);
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
            s.state.status = "checking";
            // Do not show stale line positions while buffers or files change.
            s.state.files = {};
            s.state.diagnostics = [];
            deadline();
          } else if (value.type === "result") {
            const r = resultSchema.parse(value);
            clearTimeout(s.timer);
            Object.assign(s.state, {
              ...r,
              status: "ready",
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
      if (this.session === s && !["stopped", "failed"].includes(s.state.status))
        fail(
          /heap|allocation failed/i.test(stderr)
            ? "The project compiler reached its 768 MiB heap limit. Use your IDE for this project."
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
    const s = this.session;
    if (
      !s ||
      s.key !== key ||
      s.state.head !== head ||
      s.state.status !== "ready"
    )
      throw new Error(
        "Wait for live checks to finish before navigating symbols.",
      );
    if (s.requests.size >= 32)
      throw new Error("Too many symbol lookups. Please retry.");
    await configPath(s.root, query.path);
    if (this.session !== s || s.state.status !== "ready")
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
    const s = this.session;
    if (
      !s ||
      s.key !== key ||
      s.state.head !== head ||
      ["stopped", "failed"].includes(s.state.status)
    )
      return;
    filePathSchema.parse(path);
    const order = (s.updates.get(path) ?? 0) + 1;
    s.updates.set(path, order);
    await configPath(s.root, path);
    if (
      this.session !== s ||
      s.updates.get(path) !== order ||
      ["stopped", "failed"].includes(s.state.status)
    )
      return;
    s.seq++;
    s.state.status = "checking";
    s.state.files = {};
    s.state.diagnostics = [];
    s.process.stdin.write(JSON.stringify({ seq: s.seq, path, text }) + "\n");
  }
}
