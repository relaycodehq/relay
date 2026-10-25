import type { Extension } from "@codemirror/state";
import { FileDocument, keyOf, type DocumentSource } from "./file-document";

export { FileDocument, type DocumentSource, type DocumentStatus } from "./file-document";

/**
 * The window's open files, by where they live and their path. A document
 * stays until whoever opened it closes it (a tab, the PR's editor), and while
 * it has unsaved edits after that.
 */
class DocumentStore {
  private docs = new Map<string, FileDocument>();
  private listeners = new Set<() => void>();
  /** Goes up with every change, for useSyncExternalStore. */
  version = 0;

  /** The open document for the file, opening it the first time. */
  get(source: DocumentSource, path: string, extensions: (text: string) => Extension) {
    const key = keyOf(source, path);
    let doc = this.docs.get(key);
    if (!doc) {
      doc = new FileDocument(source, path, extensions);
      doc.subscribe(() => this.changed());
      this.docs.set(key, doc);
      this.changed();
    }
    return doc;
  }

  find(source: DocumentSource, path: string) {
    return this.docs.get(keyOf(source, path));
  }

  /** Lets the document go unless it holds unsaved edits; `discard` lets those go too. */
  close(source: DocumentSource, path: string, discard = false) {
    const key = keyOf(source, path);
    const doc = this.docs.get(key);
    if (!doc || (!discard && (doc.status.dirty || doc.status.saving))) return;
    doc.dispose();
    this.docs.delete(key);
    this.changed();
  }

  /** A document whose file moved keeps its edits under the new path. */
  rename(source: DocumentSource, from: string, to: string) {
    const doc = this.docs.get(keyOf(source, from));
    if (!doc || this.docs.has(keyOf(source, to))) return;
    this.docs.delete(keyOf(source, from));
    doc.moveTo(to);
    this.docs.set(doc.key, doc);
    this.changed();
  }

  /** Any document with edits not on disk yet. */
  unsaved() {
    return [...this.docs.values()].filter((d) => d.status.dirty || d.status.saving);
  }

  /** Called when a document opens, closes, or its status changes. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

export const documents = new DocumentStore();

window.addEventListener("beforeunload", (event) => {
  if (documents.unsaved().length) event.preventDefault();
});
