import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { quoteMarkdown } from "./composer-quotes";
import { imageToken } from "../../../shared/image-refs";
import { pasteMarkdown, type PastedText } from "../../../shared/pasted-texts";

/** A file pill's path, in backticks for the agent to read. */
export const fileMarkdown = (path: string) => "`" + path + "`";

/** What a pill or line break stands for in the sent text. */
const pillText = (node: PMNode) =>
  node.type.name === "relaySkill"
    ? node.attrs.token
    : node.type.name === "relayImage"
      ? imageToken(node.attrs.n)
      : node.type.name === "relayFile"
        ? fileMarkdown(node.attrs.path)
        : node.type.name === "relayQuote"
          ? quoteMarkdown(node.attrs.text)
          : node.type.name === "relayPaste"
            ? pasteMarkdown(node.attrs as PastedText)
            : node.type.name === "hardBreak"
              ? "\n"
              : "";

// A quote is a Markdown blockquote, so one that follows text on the same line
// starts a line of its own; promptContent drops that break again.
export function serialize(content: Fragment, end = content.size) {
  let out = "",
    first = true;
  content.nodesBetween(0, end, (node, pos) => {
    if (node.isTextblock) {
      if (!first) out += "\n";
      first = false;
    } else if (node.isText) out += node.text!.slice(0, end - pos);
    else if (node.isLeaf) {
      if (node.type.name === "relayQuote" && out && !out.endsWith("\n"))
        out += "\n";
      out += pillText(node);
    }
  });
  return out;
}

/** The draft's text, up to `end` for the caret's offset in it. */
export const promptText = (doc: PMNode, end = doc.content.size) =>
  serialize(doc.content, end);

/** The document position at `offset` in the draft's text; inside a pill's text is after the pill. */
export function positionAt(doc: PMNode, offset: number) {
  let result = 1,
    found = false;
  doc.descendants((node, pos) => {
    if (found || !node.isLeaf) return;
    const start = promptText(doc, pos).length,
      value = node.isText ? node.text! : pillText(node);
    if (offset >= start && offset <= start + value.length) {
      result =
        pos +
        (node.isText ? offset - start : offset === start ? 0 : node.nodeSize);
      found = true;
    } else if (offset > start) result = pos + node.nodeSize;
  });
  return result;
}
