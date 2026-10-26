import type { ChildProcess } from "node:child_process";
import { errorMessage } from "../../shared/error-message";
import type { LspServerStatus } from "../../shared/language-servers";
import { clientCapabilities } from "./capabilities";
import { answerServerRequest, workspaceFolder } from "./client-requests";
import { OpenDocuments } from "./documents";
import { LoadProgress } from "./load-progress";
import type { ServerSpec } from "./registry";
import type { Launch, Resolution } from "./resolve";
import { RpcConnection } from "./rpc";
import { stopServer } from "./platform";
import { StatusReporter } from "./status-reporter";

export interface SessionTiming {
  /** After starting, how long with no sign of loading before it counts as ready. */
  settleMs: number;
  /** Waits before each restart after a crash; its length is how many restarts are tried. */
  restartDelays: number[];
  /** A server that ran this long before crashing starts the count over. */
  stableMs: number;
  initializeMs: number;
  /** Changes are sent this long after the first of them, so typing sends fewer. */
  changeMs: number;
  /** A missing or failed server is looked for again on an open no sooner than this. */
  retryMs: number;
  shutdownMs: number;
  /** Updates to a state's message or percentage are reported no more often than this. */
  statusMs: number;
}

export const defaultTiming: SessionTiming = {
  settleMs: 1500,
  restartDelays: [500, 2000, 5000],
  stableMs: 60_000,
  initializeMs: 60_000,
  changeMs: 60,
  retryMs: 10_000,
  shutdownMs: 2000,
  statusMs: 250,
};

export interface SessionDeps {
  resolve(
    spec: ServerSpec,
    hooks: {
      downloading(): void;
      progress(received: number, total: number): void;
    },
  ): Promise<Resolution>;
  spawn(launch: Launch, cwd: string): ChildProcess;
  status(status: LspServerStatus): void;
  /** The diagnostics a server published for a file, by its URI. */
  diagnostics(uri: string, diagnostics: unknown): void;
  /** The code clangd says the preprocessor leaves out of a file, by its URI. */
  inactiveRegions?(uri: string, regions: unknown): void;
  log?(line: string): void;
  folderUri: string;
  version: string;
  timing?: Partial<SessionTiming>;
}

/** Raised for a request when no server is there to answer it. */
export class ServerUnavailable extends Error {}

/**
 * One language server process for one workspace folder: finds or fetches it,
 * keeps its documents in step, restarts it a few times after a crash, and
 * reports where it stands. A stopped session is finished; start a new one.
 */
export class ServerSession {
  private timing: SessionTiming;
  private reporter: StatusReporter;
  private docs: OpenDocuments;
  private progress = new LoadProgress();
  private launch: Launch | undefined;
  private child: ChildProcess | undefined;
  private conn: RpcConnection | undefined;
  private startedAt = 0;
  private restarts = 0;
  private stderr = "";
  private attempt: Promise<void> | undefined;
  /** Settles once it is known whether there is a server: running, downloading, missing or failed. */
  private outcome: Promise<void> | undefined;
  private announceOutcome: (() => void) | undefined;
  private ended = false;
  private gaveUpAt = 0;
  private restartTimer: NodeJS.Timeout | undefined;
  private settleTimer: NodeJS.Timeout | undefined;
  /** What the running server said it does; unset until it has answered `initialize`. */
  private offered: Record<string, unknown> | undefined;
  /** Requests waiting for the server to come up; each is told the connection, or none. */
  private waitingForConnection: Array<
    (conn: RpcConnection | undefined) => void
  > = [];

  constructor(
    readonly spec: ServerSpec,
    readonly root: string,
    private deps: SessionDeps,
  ) {
    this.timing = { ...defaultTiming, ...deps.timing };
    this.reporter = new StatusReporter(spec, this.timing.statusMs, (status) =>
      deps.status(status),
    );
    this.docs = new OpenDocuments(() => this.conn, this.timing.changeMs);
  }

  get status(): LspServerStatus {
    return this.reporter.current;
  }

  get documents() {
    return this.docs.count;
  }

  hasDocument(uri: string) {
    return this.docs.has(uri);
  }

  /** Whether the server offers a capability such as `inlayHintProvider`; yes until it has said. */
  offers(capability: string) {
    return !this.offered || !!this.offered[capability];
  }

  /** The server isn't there and won't be until it is asked for again. */
  private get gaveUp() {
    const { state } = this.status;
    return state === "missing" || state === "failed";
  }

  /**
   * Starts the server unless it is running or on its way. Resolves once it is
   * known whether there is one: found and launched, downloading, missing or
   * failed. It doesn't wait for the server to finish loading.
   */
  async start(): Promise<void> {
    if (this.ended) return;
    if (this.gaveUp) {
      if (Date.now() - this.gaveUpAt < this.timing.retryMs) return;
      this.restarts = 0;
      this.launch = undefined;
    } else if (this.attempt || this.conn || this.restartTimer) {
      await this.outcome;
      return;
    }
    this.begin();
    await this.outcome;
  }

  private begin() {
    this.outcome = new Promise<void>((resolve) => {
      this.announceOutcome = resolve;
    });
    this.attempt = this.run().finally(() => {
      this.attempt = undefined;
      this.announceOutcome?.();
    });
  }

  private async run() {
    this.reportStarting();
    if (!this.launch) {
      this.launch = await this.findLaunch();
      if (!this.launch) return;
      // Resolving may have reported a download; the server is starting now.
      this.reportStarting();
    }
    await this.spawnAndInitialize(this.launch);
  }

  private reportStarting() {
    this.reporter.set({
      state: "starting",
      message: this.restarts ? "Restarting…" : undefined,
    });
  }

  /** Finds the server or downloads it. Gives up and returns nothing when it can't. */
  private async findLaunch(): Promise<Launch | undefined> {
    let resolution: Resolution;
    try {
      resolution = await this.deps.resolve(this.spec, {
        downloading: () => {
          this.reporter.set({ state: "downloading", progress: 0 });
          this.announceOutcome?.();
        },
        progress: (received, total) =>
          this.reporter.set({
            state: "downloading",
            ...(total
              ? {
                  progress: Math.min(100, Math.floor((received / total) * 100)),
                }
              : { message: "Installing…" }),
          }),
      });
    } catch (e) {
      if (!this.ended) this.giveUp("failed", errorMessage(e));
      return undefined;
    }
    if (this.ended) return undefined;
    if ("missing" in resolution) {
      this.giveUp("missing", resolution.missing);
      return undefined;
    }
    return resolution.launch;
  }

  private async spawnAndInitialize(launch: Launch) {
    this.stderr = "";
    this.progress.reset();
    let child: ChildProcess;
    try {
      child = this.deps.spawn(launch, this.root);
    } catch (e) {
      this.crashed(`Could not run ${launch.command}: ${errorMessage(e)}`);
      return;
    }
    this.child = child;
    this.startedAt = Date.now();
    this.announceOutcome?.();
    this.watch(child, launch);
    const conn = new RpcConnection(child, {
      request: (method, params) => this.answerServer(method, params),
      notification: (method, params) => this.onNotification(method, params),
      broken: (error) => this.pipeBroke(child, error),
    });
    try {
      const answer = await conn.request(
        "initialize",
        this.initializeParams(),
        this.timing.initializeMs,
      );
      this.offered = (answer as { capabilities?: Record<string, unknown> } | null)?.capabilities;
    } catch (e) {
      // A process that died has been handled; this is one that answered badly or not at all.
      this.exited(child, `${this.spec.id} didn't start: ${errorMessage(e)}`);
      return;
    }
    if (this.child !== child) return;
    this.becomeConnected(conn);
  }

  private initializeParams() {
    return {
      processId: process.pid,
      clientInfo: { name: "Relay", version: this.deps.version },
      locale: "en",
      rootUri: this.deps.folderUri,
      workspaceFolders: [this.folder()],
      capabilities: clientCapabilities,
      initializationOptions: this.spec.initializationOptions,
      trace: "off",
    };
  }

  private folder() {
    return workspaceFolder(this.deps.folderUri, this.root);
  }

  /** Collects the server's error output and notices when the process ends. */
  private watch(child: ChildProcess, launch: Launch) {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    child.on("error", (e) =>
      this.exited(child, `Could not run ${launch.command}: ${e.message}`),
    );
    child.on("exit", (code, signal) =>
      this.exited(child, `${this.spec.id} exited (${code ?? signal})`),
    );
  }

  private becomeConnected(conn: RpcConnection) {
    conn.notify("initialized", {});
    this.conn = conn;
    this.docs.openAllOn(conn);
    // Loading usually starts a moment after `initialized`.
    this.reporter.set({ state: "indexing", message: "Loading…" });
    this.settleTimer = setTimeout(
      () => this.reportLoading(),
      this.timing.settleMs,
    );
    this.settleTimer.unref();
    for (const wake of this.waitingForConnection.splice(0)) wake(conn);
  }

  /** The pipe ended or was garbled; if the process is going too, its exit code is the better reason. */
  private pipeBroke(child: ChildProcess, error: Error) {
    if (child.exitCode !== null || child.signalCode) {
      this.exited(
        child,
        `${this.spec.id} exited (${child.exitCode ?? child.signalCode})`,
      );
      return;
    }
    // stdout closes a moment before the exit event.
    const timer = setTimeout(
      () => this.exited(child, `${this.spec.id}: ${error.message}`),
      300,
    );
    child.once("exit", () => clearTimeout(timer));
  }

  private exited(child: ChildProcess, reason: string) {
    if (child !== this.child) return;
    stopServer(child);
    const conn = this.conn;
    this.child = undefined;
    this.conn = undefined;
    conn?.close(new Error(reason));
    clearTimeout(this.settleTimer);
    this.docs.cancelPendingFlush();
    if (this.ended) return;
    const tail = this.stderr.trim().split("\n").slice(-3).join(" ");
    this.crashed(tail ? `${reason}: ${tail}` : reason);
  }

  /** The server stopped on its own or never started: try again a few times, then give up. */
  private crashed(reason: string) {
    if (this.startedAt && Date.now() - this.startedAt >= this.timing.stableMs)
      this.restarts = 0;
    this.startedAt = 0;
    const delay = this.timing.restartDelays[this.restarts];
    if (delay === undefined) {
      this.giveUp("failed", reason);
      return;
    }
    this.restarts++;
    this.deps.log?.(`${reason}; restarting`);
    this.reporter.set({ state: "starting", message: "Restarting…" });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.ended) this.begin();
    }, delay);
    this.restartTimer.unref();
  }

  private giveUp(state: "missing" | "failed", message: string) {
    this.gaveUpAt = Date.now();
    this.reporter.set({ state, message });
    for (const wake of this.waitingForConnection.splice(0)) wake(undefined);
  }

  private reportLoading() {
    if (!this.conn) return;
    this.reporter.set(this.progress.status());
  }

  private onNotification(method: string, params: unknown) {
    const p = params as Record<string, unknown> | null;
    if (!p) return;
    if (method === "textDocument/publishDiagnostics") {
      if (typeof p.uri === "string")
        this.deps.diagnostics(p.uri, p.diagnostics);
    } else if (method === "textDocument/inactiveRegions") {
      const uri = (p.textDocument as { uri?: unknown } | undefined)?.uri;
      if (typeof uri === "string") this.deps.inactiveRegions?.(uri, p.regions);
    } else if (method === "$/progress") {
      const value = p.value as Record<string, unknown> | undefined;
      if (!value) return;
      this.progress.update(String(p.token), value);
      this.reportLoading();
    } else if (method === "experimental/serverStatus") {
      // rust-analyzer says when it has gone quiet.
      this.progress.setServerBusy(p.quiescent === false);
      this.reportLoading();
    } else if (method === "window/logMessage") {
      this.deps.log?.(`${this.spec.id}: ${String(p.message)}`);
    }
  }

  private answerServer(method: string, params: unknown) {
    return answerServerRequest(method, params, this.folder(), this.spec.settings);
  }

  // Documents

  open(uri: string, languageId: string, text: string) {
    this.docs.open(uri, languageId, text);
  }

  change(uri: string, text: string) {
    this.docs.change(uri, text);
  }

  save(uri: string) {
    this.docs.save(uri);
  }

  close(uri: string) {
    this.docs.close(uri);
  }

  // Requests

  /**
   * Asks the server, after sending it every change. Waits while it starts;
   * rejects with `ServerUnavailable` when there is none to ask or it isn't
   * up in time.
   */
  async request<T = unknown>(
    method: string,
    params: unknown,
    timeout = 10_000,
  ) {
    const { state } = this.status;
    if (state === "downloading" || state === "stopped" || this.gaveUp)
      throw new ServerUnavailable(
        this.status.message ?? `${this.spec.id} isn't running`,
      );
    const started = Date.now();
    const conn = this.conn ?? (await this.untilUp(timeout));
    if (!conn)
      throw new ServerUnavailable(
        this.gaveUp
          ? (this.status.message ?? `${this.spec.id} isn't running`)
          : `${this.spec.id} is still starting`,
      );
    this.docs.flush();
    return conn.request<T>(
      method,
      params,
      Math.max(1000, timeout - (Date.now() - started)),
    );
  }

  private untilUp(timeout: number) {
    return new Promise<RpcConnection | undefined>((resolve) => {
      const wake = (conn: RpcConnection | undefined) => {
        clearTimeout(timer);
        resolve(conn);
      };
      const timer = setTimeout(() => {
        this.waitingForConnection = this.waitingForConnection.filter(
          (w) => w !== wake,
        );
        resolve(undefined);
      }, timeout);
      this.waitingForConnection.push(wake);
    });
  }

  // Ending

  /** Asks the server to exit, and kills it if it doesn't. */
  async stop() {
    const { conn, child } = this;
    this.finish();
    if (!this.gaveUp) this.reporter.set({ state: "stopped" });
    if (!conn || !child) {
      if (child) stopServer(child);
      return;
    }
    await conn
      .request("shutdown", null, this.timing.shutdownMs)
      .then(() => conn.notify("exit", null))
      .catch(() => {});
    conn.close();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const force = setTimeout(() => {
        stopServer(child, 0);
        resolve();
      }, this.timing.shutdownMs);
      force.unref();
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
    });
  }

  /** For quitting: no goodbyes. */
  dispose() {
    const { conn, child } = this;
    this.finish();
    conn?.notify("exit", null);
    conn?.close();
    if (child) stopServer(child);
  }

  private finish() {
    this.ended = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.settleTimer);
    this.restartTimer = undefined;
    this.reporter.cancelPending();
    this.conn = undefined;
    this.child = undefined;
    this.docs.clear();
    for (const wake of this.waitingForConnection.splice(0)) wake(undefined);
    this.announceOutcome?.();
  }
}
