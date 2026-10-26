import type { RpcConnection } from "./rpc";

interface Doc {
  languageId: string;
  version: number;
  text: string;
  /** Changed since the server last heard. */
  dirty: boolean;
}

/**
 * The files open in one session and what the server has been told about
 * them. Edits are sent in batches a moment after the first one, so typing
 * doesn't send a message per key.
 */
export class OpenDocuments {
  private docs = new Map<string, Doc>();
  private changeTimer: NodeJS.Timeout | undefined;

  /** `connection` is read on each send because the server comes and goes. */
  constructor(
    private connection: () => RpcConnection | undefined,
    private changeMs: number,
  ) {}

  get count() {
    return this.docs.size;
  }

  has(uri: string) {
    return this.docs.has(uri);
  }

  open(uri: string, languageId: string, text: string) {
    if (this.docs.has(uri)) {
      this.change(uri, text);
      return;
    }
    this.docs.set(uri, { languageId, version: 1, text, dirty: false });
    this.connection()?.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  change(uri: string, text: string) {
    const doc = this.docs.get(uri);
    if (!doc || doc.text === text) return;
    doc.text = text;
    doc.version++;
    doc.dirty = true;
    if (this.changeTimer || !this.connection()) return;
    this.changeTimer = setTimeout(() => this.flush(), this.changeMs);
    this.changeTimer.unref();
  }

  /** Sends the server every change it hasn't heard. */
  flush() {
    this.cancelPendingFlush();
    const conn = this.connection();
    if (!conn) return;
    for (const [uri, doc] of this.docs) {
      if (!doc.dirty) continue;
      doc.dirty = false;
      conn.notify("textDocument/didChange", {
        textDocument: { uri, version: doc.version },
        contentChanges: [{ text: doc.text }],
      });
    }
  }

  save(uri: string) {
    if (!this.docs.has(uri)) return;
    this.flush();
    this.connection()?.notify("textDocument/didSave", {
      textDocument: { uri },
    });
  }

  close(uri: string) {
    if (!this.docs.delete(uri)) return;
    this.flush();
    this.connection()?.notify("textDocument/didClose", {
      textDocument: { uri },
    });
  }

  /** A server that has just started hasn't heard of any of them. */
  openAllOn(conn: RpcConnection) {
    for (const [uri, doc] of this.docs) {
      conn.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: doc.languageId,
          version: doc.version,
          text: doc.text,
        },
      });
      doc.dirty = false;
    }
  }

  cancelPendingFlush() {
    clearTimeout(this.changeTimer);
    this.changeTimer = undefined;
  }

  clear() {
    this.cancelPendingFlush();
    this.docs.clear();
  }
}
