import type { ChildProcess } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { errorMessage } from "../../shared/error-message";
import {
  lspServerFor,
  type LanguageServersApi,
  type LspCompletions,
  type LspDiagnosticsEvent,
  type LspInactiveLinesEvent,
  type LspEdit,
  type LspFileEdits,
  type LspFormatOptions,
  type LspHover,
  type LspLocation,
  type LspOpened,
  type LspServerId,
  type LspServerStatus,
  type LspStatusEvent,
  type LspInlayHint,
  type LspSymbol,
} from "../../shared/language-servers";
import { keyedQueue } from "../util/keyed-queue";
import { Converter, inlayHintsOf } from "./convert";
import { FileNotices, type OpenDoc } from "./file-notices";
import { servers, type ServerSpec } from "./registry";
import type { Launch, Resolution } from "./resolve";
import { isCancelled, RpcError } from "./rpc";
import {
  ServerSession,
  ServerUnavailable,
  type SessionTiming,
} from "./session";
import { pathsFor, type Paths } from "./uri";

export interface LanguageServersDeps {
  /** The folder a workspace id names. */
  root(where: string): Promise<string>;
  resolve(
    spec: ServerSpec,
    hooks: {
      downloading(): void;
      progress(received: number, total: number): void;
    },
  ): Promise<Resolution>;
  spawn(launch: Launch, cwd: string): ChildProcess;
  status(event: LspStatusEvent): void;
  diagnostics(event: LspDiagnosticsEvent): void;
  inactiveLines?(event: LspInactiveLinesEvent): void;
  version: string;
  log?(line: string): void;
  platform?: NodeJS.Platform;
  /** How long a server runs after the last file of its folder closes. */
  idleMs?: number;
  timing?: Partial<SessionTiming>;
}

export const IDLE_MS = 5 * 60_000;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_WORKSPACE_SYMBOLS = 200;

/** The server for one (folder, language) and the files open in it. */
interface Entry {
  root: string;
  /** The folder's real path when it differs, for a server that names files by it. */
  aliases: string[];
  spec: ServerSpec;
  session: ServerSession;
  converter: Converter;
  wheres: Set<string>;
  docs: Map<string, OpenDoc>;
  notices: FileNotices;
  /** Files outside the folder that a result pointed at; the only ones `readFile` opens. */
  outside: Set<string>;
  idle?: NodeJS.Timeout;
}

/**
 * Code intelligence from language servers: one process per (workspace
 * folder, server), started when a file of its language opens and stopped
 * after the folder's last file has been closed for a while.
 */
export class LanguageServers implements Omit<
  LanguageServersApi,
  "onLspDiagnostics" | "onLspInactiveLines" | "onLspStatus"
> {
  private entries = new Map<string, Entry>();
  private roots = new Map<string, string>();
  private statuses = new Map<string, Map<string, LspServerStatus>>();
  private queue = keyedQueue();
  private paths: Paths;
  private idleMs: number;

  constructor(private deps: LanguageServersDeps) {
    this.paths = pathsFor(deps.platform);
    this.idleMs = deps.idleMs ?? IDLE_MS;
  }

  async lspOpen(where: string, path: string, text: string): Promise<LspOpened> {
    const lang = lspServerFor(path);
    if (!lang) return { server: null, status: null };
    const opened = await this.queue(`${where}\0${path}`, () =>
      this.addDocument(where, path, text, lang),
    );
    if (!opened) return { server: null, status: null };
    await opened.session.start();
    return { server: opened.spec.id, status: opened.session.status };
  }

  /** Makes the file known to its server's session; undefined when the folder isn't there. */
  private async addDocument(
    where: string,
    path: string,
    text: string,
    lang: { server: LspServerId; languageId: string },
  ) {
    const root = await this.deps.root(where);
    const rootIsFolder = await stat(root).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!rootIsFolder) return undefined;
    this.roots.set(where, root);
    const real = await realpath(root).catch(() => root);
    const entry = this.entry(root, real, servers[lang.server]);
    this.attach(entry, where);
    clearTimeout(entry.idle);
    const file = this.paths.absolute(root, path);
    const key = this.paths.key(file);
    let doc = entry.docs.get(key);
    if (!doc) {
      doc = {
        path,
        file,
        uri: this.paths.toUri(root, path),
        languageId: lang.languageId,
        wheres: new Set(),
      };
      entry.docs.set(key, doc);
    }
    doc.wheres.add(where);
    entry.session.open(doc.uri, doc.languageId, text);
    entry.notices.replay(key, where, path);
    return entry;
  }

  async lspChange(where: string, path: string, text: string) {
    await this.queue(`${where}\0${path}`, async () => {
      const found = this.find(where, path);
      found?.entry.session.change(found.doc.uri, text);
    });
  }

  async lspSave(where: string, path: string) {
    await this.queue(`${where}\0${path}`, async () => {
      const found = this.find(where, path);
      found?.entry.session.save(found.doc.uri);
    });
  }

  async lspClose(where: string, path: string) {
    await this.queue(`${where}\0${path}`, async () => {
      const found = this.find(where, path);
      if (!found) return;
      const { entry, doc, key } = found;
      doc.wheres.delete(where);
      if (doc.wheres.size) return;
      entry.session.close(doc.uri);
      entry.docs.delete(key);
      entry.notices.forget(key);
      if (!entry.docs.size) this.armIdle(entry);
    });
  }

  lspHover(where: string, path: string, line: number, character: number) {
    return this.ask<LspHover | null>(
      where,
      path,
      "textDocument/hover",
      { position: { line, character } },
      null,
      8000,
      (result, { entry }) => entry.converter.hover(result),
    );
  }

  lspDefinition(where: string, path: string, line: number, character: number) {
    return this.ask<LspLocation[]>(
      where,
      path,
      "textDocument/definition",
      { position: { line, character } },
      [],
      10_000,
      (result, { entry }) => entry.converter.locations(result),
    );
  }

  lspReferences(where: string, path: string, line: number, character: number) {
    return this.ask<LspLocation[]>(
      where,
      path,
      "textDocument/references",
      {
        position: { line, character },
        context: { includeDeclaration: true },
      },
      [],
      20_000,
      (result, { entry }) => entry.converter.locations(result),
    );
  }

  lspCompletion(where: string, path: string, line: number, character: number) {
    return this.ask<LspCompletions>(
      where,
      path,
      "textDocument/completion",
      { position: { line, character }, context: { triggerKind: 1 } },
      { items: [], incomplete: false },
      8000,
      (result, { entry }) => entry.converter.completions(result),
    );
  }

  lspRename(
    where: string,
    path: string,
    line: number,
    character: number,
    newName: string,
  ) {
    return this.ask<LspFileEdits[]>(
      where,
      path,
      "textDocument/rename",
      { position: { line, character }, newName },
      [],
      30_000,
      (result, { entry }) => entry.converter.workspaceEdit(result),
      true,
    );
  }

  lspFormat(
    where: string,
    path: string,
    options: LspFormatOptions = { tabSize: 4, insertSpaces: true },
  ) {
    return this.ask<LspEdit[]>(
      where,
      path,
      "textDocument/formatting",
      { options },
      [],
      15_000,
      (result, { entry }) => entry.converter.edits(result),
      true,
    );
  }

  lspDocumentSymbols(where: string, path: string) {
    return this.ask<LspSymbol[]>(
      where,
      path,
      "textDocument/documentSymbol",
      {},
      [],
      10_000,
      (result, { entry, doc }) =>
        entry.converter.documentSymbols(result, {
          path: entry.converter.locate(doc.uri)?.path ?? doc.path,
        }),
    );
  }

  lspInlayHints(where: string, path: string, fromLine: number, toLine: number) {
    const range = { start: { line: fromLine, character: 0 }, end: { line: toLine, character: 0 } };
    // Asking a server without them only fails, and the editor asks again on every change.
    if (this.find(where, path)?.entry.session.offers("inlayHintProvider") === false) return Promise.resolve([]);
    return this.ask<LspInlayHint[]>(where, path, "textDocument/inlayHint", { range }, [], 8_000, inlayHintsOf);
  }

  async lspWorkspaceSymbols(where: string, query: string) {
    const root = this.roots.get(where);
    if (!root) return [];
    const running = [...this.entries.values()].filter((e) => e.root === root);
    const answers = await Promise.allSettled(
      running.map(async (entry) =>
        entry.converter.workspaceSymbols(
          await entry.session.request("workspace/symbol", { query }, 8000),
        ),
      ),
    );
    return answers
      .flatMap((a) => (a.status === "fulfilled" ? a.value : []))
      .slice(0, MAX_WORKSPACE_SYMBOLS);
  }

  async lspReadFile(where: string, path: string) {
    const root = this.roots.get(where);
    const file = root && this.paths.absolute(root, path);
    const key = file && this.paths.key(file);
    const pointedAt = [...this.entries.values()].some(
      (e) => e.root === root && key !== undefined && e.outside.has(key),
    );
    if (!file || !pointedAt)
      throw new Error("Only a file a language server pointed at can be read.");
    const { size, isFile } = await stat(file).then((s) => ({
      size: s.size,
      isFile: s.isFile(),
    }));
    if (!isFile || size > MAX_READ_BYTES)
      throw new Error("That file is too large to open here.");
    return readFile(file, "utf8");
  }

  async lspStatus(where: string) {
    return [...(this.statuses.get(where)?.values() ?? [])];
  }

  /** Stops every server at once, for quitting. */
  dispose() {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.idle);
      entry.session.dispose();
    }
    this.entries.clear();
  }

  // Internals

  private entry(root: string, real: string, spec: ServerSpec): Entry {
    const id = `${this.paths.key(root)}\0${spec.id}`;
    const found = this.entries.get(id);
    if (found) return found;
    const aliases = this.paths.key(real) === this.paths.key(root) ? [] : [real];
    let entry!: Entry;
    const session = new ServerSession(spec, root, {
      resolve: (s, hooks) => this.deps.resolve(s, hooks),
      spawn: (launch, cwd) => this.deps.spawn(launch, cwd),
      status: (status) => {
        for (const where of entry.wheres) this.report(where, status);
      },
      diagnostics: (uri, raw) => entry.notices.diagnostics(uri, raw),
      inactiveRegions: (uri, raw) => entry.notices.inactiveRegions(uri, raw),
      log: this.deps.log,
      folderUri: this.paths.toUri(root, root),
      version: this.deps.version,
      timing: this.deps.timing,
    });
    const server = {
      root,
      spec,
      session,
      aliases,
      converter: new Converter(
        root,
        this.paths,
        (file) => entry.outside.add(this.paths.key(file)),
        aliases,
      ),
      wheres: new Set<string>(),
      docs: new Map<string, OpenDoc>(),
      outside: new Set<string>(),
    };
    // The notices share the server's docs and workspaces, not copies.
    entry = {
      ...server,
      notices: new FileNotices(server, this.paths, this.deps),
    };
    this.entries.set(id, entry);
    return entry;
  }

  /** A window's workspace starts using the server; it hears where it stands. */
  private attach(entry: Entry, where: string) {
    if (entry.wheres.has(where)) return;
    entry.wheres.add(where);
    if (entry.session.status.state !== "stopped")
      this.report(where, entry.session.status);
  }

  private report(where: string, status: LspServerStatus) {
    let byServer = this.statuses.get(where);
    if (!byServer) this.statuses.set(where, (byServer = new Map()));
    byServer.set(status.server, status);
    this.deps.status({ where, ...status });
  }

  private find(where: string, path: string) {
    const root = this.roots.get(where);
    if (!root) return undefined;
    const key = this.paths.key(this.paths.absolute(root, path));
    const lang = lspServerFor(path);
    if (!lang) return undefined;
    const entry = this.entries.get(`${this.paths.key(root)}\0${lang.server}`);
    const doc = entry?.docs.get(key);
    return entry && doc ? { entry, doc, key } : undefined;
  }

  private armIdle(entry: Entry) {
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      if (entry.docs.size) return;
      this.entries.delete(`${this.paths.key(entry.root)}\0${entry.spec.id}`);
      void entry.session.stop();
    }, this.idleMs);
    entry.idle.unref();
  }

  /**
   * Asks the document's server. A query that can't be answered gives
   * `fallback`; one the user asked for (`strict`) says why instead.
   */
  private async ask<T>(
    where: string,
    path: string,
    method: string,
    params: object,
    fallback: T,
    timeout: number,
    convert: (result: unknown, found: { entry: Entry; doc: OpenDoc }) => T,
    strict = false,
  ): Promise<T> {
    const found = this.find(where, path);
    if (!found) {
      if (strict) throw new Error("Open the file before asking about it.");
      return fallback;
    }
    try {
      const result = await found.entry.session.request(
        method,
        { textDocument: { uri: found.doc.uri }, ...params },
        timeout,
      );
      return convert(result, found);
    } catch (e) {
      if (strict) throw new Error(askFailure(found.entry.spec, e));
      if (!(e instanceof ServerUnavailable) && !isCancelled(e))
        this.deps.log?.(`${found.entry.spec.id} ${method}: ${errorMessage(e)}`);
      return fallback;
    }
  }
}

function askFailure(spec: ServerSpec, e: unknown) {
  if (e instanceof ServerUnavailable) return e.message;
  if (e instanceof RpcError)
    return isCancelled(e) ? `${spec.id} was busy; try again.` : e.message;
  return `${spec.id}: ${errorMessage(e)}`;
}
