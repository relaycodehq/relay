import type { Text } from "@codemirror/state";
import { lspServerFor } from "../../../shared/language-servers";
import { lsp } from "../language-servers/client";
import type { FileDocument } from "./documents";

/** A document a language server can hear about: in a project's folder, of a language one covers. */
export const servedBy = (doc: FileDocument) =>
  doc.source.kind === "project" && !!lspServerFor(doc.path);

/**
 * The text each file's server last heard from here. An editor's texts never
 * change in place, so the same one needs no sending: hovers, completions and
 * jumps would otherwise copy the whole file across the bridge every time.
 */
const heard = new Map<string, Text>();
const fileKey = (where: string, path: string) => `${where}\0${path}`;

/** Sends the server the text it should answer from, unless it has it. A failure only means it answers from older text. */
export async function tellServerText(where: string, path: string, text: Text) {
  const key = fileKey(where, path);
  if (heard.get(key) === text) return;
  heard.set(key, text);
  await lsp.change(where, path, text.toString()).catch(() => {
    if (heard.get(key) === text) heard.delete(key);
  });
}

/** The text each file of `where` was last sent as, by path: what an answer asked for now is worked out from. */
export function heardTexts(where: string) {
  const prefix = fileKey(where, "");
  const texts = new Map<string, Text>();
  for (const [key, text] of heard)
    if (key.startsWith(prefix)) texts.set(key.slice(prefix.length), text);
  return texts;
}

/** The main process debounces too; this keeps big files off the bridge on every keystroke. */
const CHANGE_DELAY = 120;

const synced = new WeakSet<FileDocument>();

/**
 * Keeps the language server's copy of `doc` current: opened once it's read,
 * the text again a moment after each edit, told of saves, closed with the
 * document. Calling it again for the same document does nothing.
 */
export function syncWithServer(doc: FileDocument) {
  if (doc.source.kind !== "project" || synced.has(doc) || !servedBy(doc)) return;
  synced.add(doc);
  // The folder and path the server has the file open at.
  let opened: { where: string; path: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (opened || !doc.state || doc.source.kind !== "project" || !servedBy(doc)) return;
    opened = { where: doc.source.where, path: doc.path };
    heard.set(fileKey(opened.where, opened.path), doc.state.doc);
    void lsp.open(opened.where, opened.path, doc.text()).catch(() => {});
  };
  const close = () => {
    clearTimeout(timer);
    if (!opened) return;
    heard.delete(fileKey(opened.where, opened.path));
    void lsp.close(opened.where, opened.path).catch(() => {});
    opened = undefined;
  };
  // A renamed or moved file is a different document to the server: close the old one, open the new.
  const followRename = () => {
    const where = doc.source.kind === "project" ? doc.source.where : undefined;
    const moved = opened && (opened.path !== doc.path || opened.where !== where);
    if (moved) close();
    open();
  };
  open();
  const offStatus = doc.subscribe(followRename);
  let heardText = doc.state?.doc;
  const offState = doc.onState((state) => {
    if (!opened) return open();
    // Carets, folds and completions update the state too; only new text is worth sending.
    const textChanged = state.doc !== heardText;
    if (!textChanged) return;
    heardText = state.doc;
    const { where, path } = opened;
    clearTimeout(timer);
    timer = setTimeout(() => void tellServerText(where, path, state.doc), CHANGE_DELAY);
  });
  const offSave = doc.onSave(() => {
    if (opened) void lsp.save(opened.where, opened.path).catch(() => {});
  });
  doc.onDispose(() => {
    offStatus();
    offState();
    offSave();
    close();
  });
}
