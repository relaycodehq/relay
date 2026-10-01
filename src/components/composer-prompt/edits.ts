import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import {
  deleteImagePills,
  lastPaste,
  pasteAt,
  pasteNodes,
  spacedTags,
} from "../../lib/prompt-pills";
import { positionAt } from "../../lib/prompt-text";

type Point = { left: number; top: number };

/** A skill picked from the menu, replacing `start`–`end` of the draft's text. */
export interface SkillPick {
  token: string;
  label: string;
  start: number;
  end: number;
}

// Pills go in as their own undo step, apart from the typing around them.
function asOneStep(editor: Editor, edit: () => void) {
  editor.view.dispatch(closeHistory(editor.state.tr));
  edit();
  editor.view.dispatch(closeHistory(editor.state.tr));
}

export function insertSkill(editor: Editor, pick: SkillPick) {
  const from = positionAt(editor.state.doc, pick.start),
    to = positionAt(editor.state.doc, pick.end);
  asOneStep(editor, () =>
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, [
        {
          type: "relaySkill",
          attrs: { token: pick.token, label: pick.label },
        },
        { type: "text", text: " " },
      ])
      .run(),
  );
}

/** Replaces `start`–`end` of the draft's text with plain text, or removes it. */
export function replaceText(
  editor: Editor,
  { start, end, text }: { start: number; end: number; text: string },
) {
  const range = {
    from: positionAt(editor.state.doc, start),
    to: positionAt(editor.state.doc, end),
  };
  const chain = editor.chain().focus();
  // ProseMirror has no empty text nodes; removing is a delete.
  (text
    ? chain.insertContentAt(range, { type: "text", text })
    : chain.deleteRange(range)
  ).run();
}

/** Puts tags in where the pointer is, or at the caret without one. */
export function insertTags(editor: Editor, tags: JSONContent[], point?: Point) {
  const { doc } = editor.state;
  const hit = point && editor.view.posAtCoords(point)?.pos;
  // The pointer can land between blocks; the tags go in the nearest one.
  const at =
    hit === undefined
      ? editor.state.selection.from
      : TextSelection.near(doc.resolve(hit)).from;
  const $at = doc.resolve(at);
  const nodes = spacedTags(tags, $at.nodeBefore, $at.nodeAfter);
  asOneStep(editor, () =>
    editor.chain().focus().insertContentAt(at, nodes).run(),
  );
}

export function removeImage(editor: Editor, n: number) {
  const tr = deleteImagePills(editor.state.tr, n);
  if (tr.docChanged) editor.view.dispatch(closeHistory(tr));
}

export function insertQuote(editor: Editor, text: string) {
  // After any selection rather than over it: the quote came from the thread.
  asOneStep(editor, () =>
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.selection.to, {
        type: "relayQuote",
        attrs: { text },
      })
      .run(),
  );
}

/** Puts a paste pill at the caret, numbered after the others; false when the message cannot hold it. */
export function insertPaste(editor: Editor, text: string) {
  const n = lastPaste(editor.state.doc);
  const before = editor.state.doc;
  asOneStep(editor, () =>
    editor
      .chain()
      .focus()
      .insertContent({ type: "relayPaste", attrs: { n: n + 1, text } })
      .run(),
  );
  // The length limit rejects the transaction rather than truncating it.
  return editor.state.doc !== before;
}

export function removePaste(editor: Editor, index: number) {
  const found = pasteAt(editor.state.doc, index);
  if (!found) return;
  editor.view.dispatch(
    closeHistory(
      editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize),
    ),
  );
}

/** Swaps the nth paste pill for its text. */
export function inlinePaste(editor: Editor, index: number) {
  const found = pasteAt(editor.state.doc, index);
  if (!found) return;
  const nodes = pasteNodes(editor.state.schema, String(found.node.attrs.text));
  editor.view.dispatch(
    closeHistory(
      editor.state.tr.replaceWith(
        found.pos,
        found.pos + found.node.nodeSize,
        nodes,
      ),
    ),
  );
  editor.commands.focus();
}
