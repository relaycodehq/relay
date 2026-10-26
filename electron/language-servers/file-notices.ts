import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspInactiveLinesEvent,
  LspLineSpan,
} from "../../shared/language-servers";
import { inactiveLinesOf, type Converter } from "./convert";
import type { Paths } from "./uri";

export interface OpenDoc {
  /** As the editor named it; events use it back. */
  path: string;
  file: string;
  uri: string;
  languageId: string;
  /** The windows' pages that have the file open, by the workspace each opened it in. */
  openIn: Map<string, Set<object>>;
}

/** What of a server's folder its notices are read against. */
export interface NoticedServer {
  root: string;
  /** The folder's real path when it differs, for a server that names files by it. */
  aliases: string[];
  converter: Converter;
  /** Every workspace using the server. */
  wheres: Set<string>;
  docs: Map<string, OpenDoc>;
}

export interface NoticeListeners {
  diagnostics(event: LspDiagnosticsEvent): void;
  inactiveLines?(event: LspInactiveLinesEvent): void;
}

/**
 * What a server tells about files unasked: their diagnostics, and the code
 * clangd says the preprocessor leaves out. The last of each is kept per
 * file, so a workspace that opens the file again shows them at once.
 */
export class FileNotices {
  /** What was last sent for a file, to leave out a repeat. */
  private sent = new Map<string, string>();
  private published = new Map<string, LspDiagnostic[]>();
  private inactive = new Map<string, LspLineSpan[]>();

  constructor(
    private readonly server: NoticedServer,
    private readonly paths: Paths,
    private readonly listeners: NoticeListeners,
  ) {}

  diagnostics(uri: string, raw: unknown) {
    const found = this.noticed(uri);
    if (!found) return;
    const { key, located, doc } = found;
    // Nobody looks at diagnostics for a file outside the folder that isn't open.
    if (!doc && located.outside) return;
    const diagnostics = this.server.converter.diagnostics(raw);
    const fingerprint = JSON.stringify(diagnostics);
    if (this.sent.get(key) === fingerprint) return;
    this.sent.set(key, fingerprint);
    this.published.set(key, diagnostics);
    for (const where of doc ? doc.openIn.keys() : this.server.wheres)
      this.listeners.diagnostics({
        where,
        path: doc?.path ?? located.path,
        diagnostics,
      });
  }

  /** Only an open file greys what's left out of it. */
  inactiveRegions(uri: string, raw: unknown) {
    const found = this.noticed(uri);
    if (!found?.doc) return;
    const { key, doc } = found;
    const lines = inactiveLinesOf(raw);
    this.inactive.set(key, lines);
    for (const where of doc.openIn.keys())
      this.listeners.inactiveLines?.({ where, path: doc.path, lines });
  }

  /** Tells a workspace opening the file what is known of it already. */
  replay(key: string, where: string, path: string) {
    const diagnostics = this.published.get(key);
    if (diagnostics?.length)
      this.listeners.diagnostics({ where, path, diagnostics });
    const lines = this.inactive.get(key);
    if (lines?.length) this.listeners.inactiveLines?.({ where, path, lines });
  }

  /** The file closed everywhere. */
  forget(key: string) {
    this.sent.delete(key);
    this.published.delete(key);
    this.inactive.delete(key);
  }

  /** The file a notice names: its key, where it is, and its document when it's open. */
  private noticed(uri: string) {
    const { root, aliases, docs } = this.server;
    const file = this.paths.fromUri(uri);
    if (file === undefined) return undefined;
    const located = this.paths.toWorkspacePath(root, file, aliases);
    const key = this.paths.key(
      located.outside ? file : this.paths.absolute(root, located.path),
    );
    return { key, located, doc: docs.get(key) };
  }
}
