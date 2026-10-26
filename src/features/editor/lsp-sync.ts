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
  const { where } = doc.source;
  let openedPath: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (openedPath || !doc.state) return;
    openedPath = doc.path;
    heard.set(fileKey(where, openedPath), doc.state.doc);
    void lsp.open(where, openedPath, doc.text()).catch(() => {});
  };
  open();
  const offStatus = doc.subscribe(open);
  let heardText = doc.state?.doc;
  const offState = doc.onState((state) => {
    if (!openedPath) return open();
    // Carets, folds and completions update the state too; only new text is worth sending.
    const textChanged = state.doc !== heardText;
    if (!textChanged) return;
    heardText = state.doc;
    const path = openedPath;
    clearTimeout(timer);
    timer = setTimeout(() => void tellServerText(where, path, state.doc), CHANGE_DELAY);
  });
  const offSave = doc.onSave(() => {
    if (openedPath) void lsp.save(where, openedPath).catch(() => {});
  });
  doc.onDispose(() => {
    clearTimeout(timer);
    offStatus();
    offState();
    offSave();
    if (!openedPath) return;
    heard.delete(fileKey(where, openedPath));
    void lsp.close(where, openedPath).catch(() => {});
  });
}
