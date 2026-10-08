import { dirname } from "node:path";
import { privateDirectory } from "./paths";
import { chmod, rm } from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import type { AgentVersion } from "../../shared/agent-updates";
import type { Project } from "../../shared/projects";
import type { UpdateState } from "../../shared/updates";
import type { SpeechEngine, SpeechState } from "./speech";
import type { PhonePairing, PhoneRemoteState } from "../../shared/remote";

/**
 * What the `relay` command asks the Relay running in the background. It
 * reaches it through a socket only this user can open, so asking is
 * already proof enough of who asks.
 */
export interface ControlApi {
  status(): Promise<DaemonStatus>;
  update(check: boolean): Promise<UpdateState>;
  /** Turns phone access on if needed, then opens a fresh pairing code. */
  pair(): Promise<PhonePairing & { remote: PhoneRemoteState }>;
  remote(enabled: boolean): Promise<PhoneRemoteState>;
  removeDevice(id: string): Promise<PhoneRemoteState>;
  projects(): Promise<Project[]>;
  addProject(path: string): Promise<Project>;
  removeProject(id: string): Promise<void>;
  threads(): Promise<ThreadRow[]>;
  /** Refuses while threads work unless `force`; `detach` leaves them running for the next start. */
  stop(options: { force?: boolean; detach?: boolean }): Promise<void>;
  /**
   * Starts Cursor's sign-in and answers with the page to open on another
   * device; `cursorSignInState()` says when it's done.
   */
  cursorSignIn(): Promise<CursorLogin>;
  cursorSignInState(): Promise<CursorLogin | null>;
  cursorSignOut(): Promise<void>;
  /** Dictation and read aloud for phones; see ./speech. */
  speech(): Promise<SpeechState>;
  /** Starts downloading the engine, then the model or `voice`; `speech()` follows it. */
  installSpeech(engine: SpeechEngine, voice?: string): Promise<SpeechState>;
  removeSpeech(engine: SpeechEngine, voice?: string): Promise<SpeechState>;
  /** Any call the desktop's window makes, through the same validation. */
  call(method: string, args: unknown[]): Promise<unknown>;
}

export type ControlMethod = keyof ControlApi;

export interface DaemonStatus {
  version: string;
  /** What phones and other computers call this one. */
  name: string;
  pid: number;
  startedAt: number;
  home: string;
  remote: PhoneRemoteState;
  projects: number;
  threads: { working: number; waiting: number; total: number };
  agents: AgentVersion[];
  update: UpdateState;
}

export interface CursorLogin {
  status: "waiting" | "done" | "failed";
  /** Cursor's sign-in page, once it has one. */
  url?: string;
  error?: string;
}

export interface ThreadRow {
  id: string;
  projectId: string;
  project: string;
  title: string;
  provider?: string;
  state: "working" | "waiting" | "idle" | "settled" | "away";
  updated: number;
  branch?: string;
  /** The computer it was handed from, or to. */
  computer?: string;
}

interface Request {
  id: number;
  method: string;
  params: unknown[];
}
type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

const maxLine = 4 * 1024 * 1024;

/** Lines from a socket, each handed on once complete. */
function readLines(socket: Socket, line: (text: string) => void) {
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    if (buffered.length > maxLine) {
      socket.destroy(new Error("A control message was too long."));
      return;
    }
    for (
      let end = buffered.indexOf("\n");
      end >= 0;
      end = buffered.indexOf("\n")
    ) {
      const text = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      if (text.trim()) line(text);
    }
  });
}

/** Answers the `relay` command on `path` until closed. */
export async function serveControl(
  path: string,
  api: ControlApi,
): Promise<Server> {
  if (process.platform !== "win32") {
    await privateDirectory(dirname(path));
    await rm(path, { force: true });
  }
  const server = createServer((socket) => {
    readLines(socket, (text) => {
      let request: Request;
      try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Invalid request.");
        const candidate = value as Partial<Request>;
        if (
          !Number.isSafeInteger(candidate.id) ||
          typeof candidate.method !== "string" ||
          !Array.isArray(candidate.params)
        )
          throw new Error("Invalid request.");
        request = candidate as Request;
      } catch {
        socket.destroy();
        return;
      }
      const reply = (response: Response) => {
        if (!socket.destroyed) socket.write(JSON.stringify(response) + "\n");
      };
      const method = request.method as ControlMethod;
      if (!Object.hasOwn(api, method) || typeof api[method] !== "function") {
        reply({
          id: request.id,
          ok: false,
          error: `Unknown command: ${request.method}`,
        });
        return;
      }
      const handler = api[method] as (...args: unknown[]) => Promise<unknown>;
      Promise.resolve()
        .then(() =>
          handler(...(Array.isArray(request.params) ? request.params : [])),
        )
        .then(
          (value) => reply({ id: request.id, ok: true, value: value ?? null }),
          (e) =>
            reply({
              id: request.id,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            }),
        );
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    const mask =
      process.platform !== "win32" ? process.umask(0o077) : undefined;
    try {
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    } finally {
      if (mask !== undefined) process.umask(mask);
    }
  });
  if (process.platform !== "win32") await chmod(path, 0o600);
  return server;
}

export class NotRunning extends Error {
  constructor() {
    super("Relay isn't running.");
  }
}

/** One call to the running Relay; rejects with NotRunning when nothing answers. */
export function callControl<M extends ControlMethod>(
  path: string,
  method: M,
  ...params: Parameters<ControlApi[M]>
): Promise<Awaited<ReturnType<ControlApi[M]>>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.end();
      fn();
    };
    socket.once("error", (e: NodeJS.ErrnoException) =>
      done(() =>
        reject(
          e.code === "ENOENT" || e.code === "ECONNREFUSED"
            ? new NotRunning()
            : e,
        ),
      ),
    );
    socket.once("close", () =>
      done(() => reject(new Error("Relay closed the connection."))),
    );
    readLines(socket, (text) => {
      try {
        const response: unknown = JSON.parse(text);
        if (
          !response ||
          typeof response !== "object" ||
          !("ok" in response) ||
          typeof response.ok !== "boolean"
        )
          throw new Error("Invalid control response.");
        const reply = response as Response;
        done(() =>
          reply.ok
            ? resolve(reply.value as Awaited<ReturnType<ControlApi[M]>>)
            : reject(new Error(reply.error)),
        );
      } catch (e) {
        done(() => reject(e));
      }
    });
    socket.once("connect", () =>
      socket.write(
        JSON.stringify({ id: 1, method, params } satisfies Request) + "\n",
      ),
    );
  });
}
