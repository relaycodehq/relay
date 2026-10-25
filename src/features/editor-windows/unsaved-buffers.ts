import type { UnsavedBuffer } from "../../../shared/editor-windows";
import {
  documents,
  type DocumentSource,
  type FileDocument,
} from "../editor/documents";
import type { EditorTab } from "../files/editor-tabs";
import { outsideSource } from "../files/OutsideFile";
import { allTabs } from "../files/editor-groups";
import { loadLayout } from "../files/useEditorLayout";

/** Where a tab's document lives, and its path there. */
function documentOf(
  where: string,
  tab: EditorTab,
  plain?: boolean,
): [DocumentSource, string] {
  if (!tab.outside) return [{ kind: "project", where, plain }, tab.path];
  const { source, name } = outsideSource(tab.path);
  return [source, name];
}

/** The workspace's open documents in this window: its tabs', and any other of the folder's. */
function workspaceDocuments(where: string) {
  const found = new Map<FileDocument, EditorTab>();
  for (const tab of allTabs(loadLayout(where))) {
    const doc = documents.find(...documentOf(where, tab));
    if (doc) found.set(doc, tab);
  }
  for (const doc of documents.unsaved())
    if (
      !found.has(doc) &&
      doc.source.kind === "project" &&
      doc.source.where === where
    )
      found.set(doc, { path: doc.path });
  return found;
}

/**
 * The workspace's unsaved text in this window, for another window's editor
 * to take over. Tabs live in storage every window reads, so only this
 * travels.
 */
export function collectUnsaved(where: string): UnsavedBuffer[] {
  return [...workspaceDocuments(where)]
    .filter(([doc]) => doc.status.dirty)
    .map(([doc, tab]) => ({
      path: tab.path,
      ...(tab.outside ? { outside: true as const } : {}),
      ...(doc.source.kind === "project" && doc.source.plain && !tab.outside
        ? { plain: true as const }
        : {}),
      text: doc.text(),
    }));
}

/**
 * Lets go of the workspace's documents here, edits and all, once another
 * window holds them. Whoever shows the editor next reads the files afresh.
 */
export function discardWorkspace(where: string) {
  for (const [doc] of workspaceDocuments(where))
    documents.close(doc.source, doc.path, true);
}

/** Resolves once the document has been read; false if reading failed. */
function whenRead(doc: FileDocument) {
  return new Promise<boolean>((resolve) => {
    const settled = () =>
      !!doc.status.error || (!!doc.state && !doc.status.loading);
    if (settled()) return resolve(!doc.status.error);
    const off = doc.subscribe(() => {
      if (!settled()) return;
      off();
      resolve(!doc.status.error);
    });
  });
}

/**
 * Opens a document for each buffer and sets its text as an edit once the
 * file is read, so it is unsaved and undoable as it was in the other window.
 * The tabs showing them are already in storage.
 */
export async function adoptBuffers(where: string, buffers: UnsavedBuffer[]) {
  // The editor's bundle is heavy; a window without an editor never loads it.
  const { baseExtensions } = await import("../editor/setup");
  await Promise.all(
    buffers.map(async (buffer) => {
      const [source, path] = documentOf(
        where,
        { path: buffer.path, outside: buffer.outside },
        buffer.plain,
      );
      const doc = documents.get(source, path, baseExtensions);
      // Typing already in it is newer than what was handed over.
      if ((await whenRead(doc)) && !doc.status.dirty) doc.adopt(buffer.text);
    }),
  );
}
