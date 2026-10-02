import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { promptText } from "../../lib/prompt-text";
import { ComposerDictation } from "./dictation";
import { ImageTag } from "./image-pill";
import { FileTag, Paste, Quote, Skill } from "./pills";

/** The most characters a message holds. */
const LIMIT = 32000;
/** Marks a transaction that shows the draft's own text, set from outside the editor. */
export const DRAFT_SYNC = "relayDraftSync";

// Each accepted transaction's doc is the next one's `before`, so the length
// before an edit is usually already known and each edit serializes once.
const lengths = new WeakMap<PMNode, number>();
function textLength(doc: PMNode) {
  let length = lengths.get(doc);
  if (length === undefined) lengths.set(doc, (length = promptText(doc).length));
  return length;
}

/**
 * Typing and pasting stop at the limit. The draft's text set from outside
 * (a message coming back, a quote from the thread) goes in past it, so the
 * editor never shows other text than the draft holds; and a draft over the
 * limit can still be shortened and moved around in, just not grown.
 */
const withinLimit = (tr: Transaction) =>
  !tr.docChanged ||
  tr.getMeta(DRAFT_SYNC) === true ||
  textLength(tr.doc) <= LIMIT ||
  textLength(tr.doc) <= textLength(tr.before);

/** The prompt editor's schema and behaviour: plain lines, pills, dictation, and the message's length limit. */
export const promptExtensions = () => [
  Extension.create({
    name: "promptLimit",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction: withinLimit,
        }),
      ];
    },
  }),
  StarterKit.configure({
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    codeBlock: false,
    horizontalRule: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: false,
    underline: false,
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
  }),
  Skill,
  Quote,
  Paste,
  FileTag,
  ImageTag,
  ComposerDictation,
];
