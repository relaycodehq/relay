import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Claude Code's keyword for thinking harder on one message, read from the prompt. */
export const ultrathinkPattern = /\bultrathink\b/gi;

/** Marks the keyword in the draft; the composer colours it when the message goes to Claude. */
export const UltrathinkWord = Extension.create({
  name: "ultrathinkWord",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        state: {
          init: (_, state) => keywordMarks(state.doc),
          apply: (tr, marks) => (tr.docChanged ? keywordMarks(tr.doc) : marks),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function keywordMarks(doc: PMNode) {
  const marks: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.text) return;
    for (const match of node.text.matchAll(ultrathinkPattern)) {
      const from = pos + match.index;
      marks.push(
        Decoration.inline(from, from + match[0].length, {
          class: "ultrathink-word",
        }),
      );
    }
  });
  return DecorationSet.create(doc, marks);
}
