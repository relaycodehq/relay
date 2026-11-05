import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import type { ProjectCheckState, SymbolResult } from "../../shared/checks";
import type { PullRef } from "../../shared/types";
import {
  digestSchema,
  filePathSchema,
  textSchema,
} from "../../shared/validation";

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

/** A running checker: its worker process and what it has reported. */
export type Session = {
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

/**
 * Applies one line the worker wrote to the session: its heap use, a symbol
 * lookup's answer, a recheck starting or its result. `fail` ends the session;
 * `deadline` restarts the clock on a check.
 */
export function readWorkerLine(
  s: Session,
  line: string,
  {
    memoryMb,
    fail,
    deadline,
  }: {
    memoryMb: number;
    fail: (message: string) => void;
    deadline: () => void;
  },
) {
  try {
    const value = JSON.parse(line);
    if (value.type === "memory") {
      if (Number.isInteger(value.used) && value.used >= 0)
        s.state.memory = { limit: memoryMb, used: value.used };
      return;
    }
    if (value.type === "symbol") return answerSymbol(s, value);
    if (value.seq !== s.seq) return;
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

/** Settles the symbol lookup the worker answered, if it's still waiting. */
function answerSymbol(
  s: Session,
  value: { requestId: string; seq: number; error?: string; result?: unknown },
) {
  const request = s.requests.get(value.requestId);
  if (!request) return;
  clearTimeout(request.timer);
  s.requests.delete(value.requestId);
  if (value.error || value.seq !== s.seq)
    request.reject(
      new Error(
        value.error ?? "The file changed while finding the symbol. Retry.",
      ),
    );
  else {
    const parsed = symbolResultSchema.safeParse(value.result);
    if (parsed.success) request.resolve(parsed.data);
    else
      request.reject(
        new Error("The language service returned an invalid symbol response."),
      );
  }
}
