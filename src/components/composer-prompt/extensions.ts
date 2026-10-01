import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { promptText } from "../../lib/prompt-text";
import { ComposerDictation } from "./dictation";
import { ImageTag } from "./image-pill";
import { FileTag, Paste, Quote, Skill } from "./pills";

/** The prompt editor's schema and behaviour: plain lines, pills, dictation, and the message's length limit. */
export const promptExtensions = () => [
  Extension.create({
    name: "promptLimit",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction: (tr) => promptText(tr.doc).length <= 32000,
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
