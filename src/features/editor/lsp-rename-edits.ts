import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { errorMessage } from "../../../shared/error-message";
import {
  applyLspEdits,
  type LspFileEdits,
} from "../../../shared/language-servers";
import { api } from "../../lib/api";
import { documents, type FileDocument } from "./documents";
import { lspChanges } from "./lsp";
import { isOutsidePath } from "./lsp-picks";

/** A closed file the rename wrote, with what it held before. */
type Written = { path: string; head: string; version: string; before: string };

/**
 * The open files edited since the server was asked. Its edits are positioned
 * in the text it was sent (`asked`), so on these they'd land in the wrong places.
 */
function editedSinceAsked(
  doc: FileDocument,
  view: EditorView,
  files: LspFileEdits[],
  asked: Map<string, Text>,
) {
  if (doc.source.kind !== "project") return [];
  const source = doc.source;
  const bufferOf = (path: string) =>
    path === doc.path
      ? view.state.doc
      : documents.find(source, path)?.state?.doc;
  return files
    .map((file) => file.path)
    .filter((path) => {
      const buffer = bufferOf(path);
      const sent = asked.get(path);
      return buffer && sent && !buffer.eq(sent);
    });
}

/** Puts back what the rename replaced on disk; returns `error`, naming any file that keeps the new name. */
async function undoWrites(where: string, written: Written[], error: unknown) {
  const kept: string[] = [];
  for (const file of written)
    await api
      .saveProjectFile(where, file.path, file.head, file.version, file.before)
      .catch(() => kept.push(file.path));
  if (!kept.length) return error;
  return new Error(
    `${errorMessage(error)} ${kept.join(", ")} kept the new name.`,
  );
}

/** Writes the closed files' renamed text; when one write fails, none of them stays renamed. */
async function writeClosedFiles(where: string, files: LspFileEdits[]) {
  const reads = await Promise.all(
    files.map((file) => api.projectFile(where, file.path)),
  );
  const written: Written[] = [];
  try {
    for (const [at, file] of files.entries()) {
      const read = reads[at];
      const renamed = applyLspEdits(read.contents, file.edits);
      const saved = await api.saveProjectFile(
        where,
        file.path,
        read.head,
        read.version,
        renamed,
      );
      written.push({
        path: file.path,
        head: read.head,
        version: saved.version,
        before: read.contents,
      });
    }
  } catch (error) {
    throw await undoWrites(where, written, error);
  }
  return written;
}

/**
 * Applies a rename's edits to every file, or to none: in the open buffer when
 * the file is open (unsaved, undoable), straight to disk when it isn't.
 * Returns the files outside the project, which are left alone.
 */
export async function applyRename(
  doc: FileDocument,
  where: string,
  view: EditorView,
  files: LspFileEdits[],
  asked: Map<string, Text>,
) {
  const source = doc.source;
  if (source.kind !== "project") return [];
  const outside: string[] = [];
  const open: { buffer: FileDocument; file: LspFileEdits }[] = [];
  const closed: LspFileEdits[] = [];
  for (const file of files) {
    if (file.path === doc.path) continue;
    const buffer = documents.find(source, file.path);
    if (isOutsidePath(file.path)) outside.push(file.path);
    else if (buffer?.state) open.push({ buffer, file });
    else closed.push(file);
  }
  // Writing can fail and editing a buffer can't, so the buffers wait for the disk.
  const written = await writeClosedFiles(where, closed);
  const edited = editedSinceAsked(doc, view, files, asked);
  if (edited.length) {
    const changed = new Error(
      `Nothing was renamed: ${edited.join(", ")} changed meanwhile.`,
    );
    throw await undoWrites(where, written, changed);
  }
  const own = files.find((file) => file.path === doc.path);
  if (own)
    view.dispatch({
      changes: lspChanges(view.state.doc, own.edits),
      userEvent: "input.rename",
    });
  for (const { buffer, file } of open)
    if (buffer.state)
      buffer.edit({
        changes: lspChanges(buffer.state.doc, file.edits),
        userEvent: "input.rename",
      });
  return outside;
}
