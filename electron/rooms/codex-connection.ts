import { spawn } from "node:child_process";
import { withCodexTransport, type CodexTransport } from "./codex-transport";

/** A native session owns its approvals. Keep its process alive between project turns. */
export class CodexConnection {
  readonly child;
  readonly ready: Promise<CodexTransport>;
  readonly done: Promise<void>;
  started?: any;
  busy = false;
  closed = false;
  onNotification?: (method: string, params: any) => void;
  onRequest?: (method: string, params: any) => Promise<unknown>;
  onError?: (error: Error) => void;
  private release!: () => void;
  constructor(executable: string, args: string[], cwd: string) {
    this.child = spawn(executable, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let ready!: (wire: CodexTransport) => void;
    this.ready = new Promise((resolve) => {
      ready = resolve;
    });
    const lifetime = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    const fail = (error: Error) => {
      this.onError?.(error);
      void this.close();
    };
    this.child.on("error", (e) =>
      fail(new Error(`Could not start Codex: ${e.message}`)),
    );
    this.child.on("exit", () =>
      fail(
        new Error(
          "Codex stopped before finishing. Check your local Codex sign-in.",
        ),
      ),
    );
    this.child.stdin.on("error", () =>
      fail(new Error("The Codex connection closed.")),
    );
    this.child.stderr.resume();
    this.done = withCodexTransport(
      this.child,
      (method, params) => this.onNotification?.(method, params),
      fail,
      async (wire) => {
        ready(wire);
        await lifetime;
      },
      async (method, params) => {
        if (this.onRequest) return this.onRequest(method, params);
        if (method.endsWith("requestApproval")) return { decision: "decline" };
        throw new Error(`No active handler for ${method}.`);
      },
    ).catch(fail);
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.release();
      this.child.stdin.end();
      this.child.kill("SIGTERM");
      const kill = setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill("SIGKILL");
      }, 2000);
      kill.unref();
      this.child.once("exit", () => clearTimeout(kill));
    }
    return this.done;
  }
}
const sessions = new Map<string, CodexConnection>();
export function acquireCodexConnection(
  key: string | undefined,
  executable: string,
  args: string[],
  cwd: string,
) {
  let connection = key ? sessions.get(key) : undefined;
  if (connection?.busy)
    throw new Error("This Codex session is already running a turn.");
  if (!connection || connection.closed) {
    connection = new CodexConnection(executable, args, cwd);
    if (key) sessions.set(key, connection);
  }
  connection.busy = true;
  return connection;
}
export async function closeCodexConnection(key: string) {
  const connection = sessions.get(key);
  sessions.delete(key);
  await connection?.close();
}
