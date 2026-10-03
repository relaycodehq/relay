import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Transform } from "@tiptap/pm/transform";

/** The nth paste pill and where it sits. */
export function pasteAt(doc: PMNode, index: number) {
  let found: { node: PMNode; pos: number } | undefined,
    seen = 0;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "relayPaste" && seen++ === index)
      found = { node, pos };
  });
  return found;
}

/** How many paste pills come before `at`: the index of the one there. */
export function pasteIndex(doc: PMNode, at: number) {
  let index = 0;
  doc.descendants((other, pos) => {
    if (other.type.name === "relayPaste" && pos < at) index++;
  });
  return index;
}

/** The highest paste pill number, 0 without any. */
export function lastPaste(doc: PMNode) {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "relayPaste") n = Math.max(n, node.attrs.n);
  });
  return n;
}

/** The passages of the quote pills in the draft. */
export function quotesIn(doc: PMNode) {
  const present: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "relayQuote") present.push(node.attrs.text);
  });
  return present;
}

/** Deletes every pill for screenshot n from the document `tr` started on. */
export function deleteImagePills<T extends Transform>(tr: T, n: number) {
  const doc = tr.before;
  doc.descendants((node, pos) => {
    if (node.type.name !== "relayImage" || node.attrs.n !== n) return;
    // The space put in beside the pill goes with it.
    const end = pos + node.nodeSize,
      $pos = doc.resolve(pos);
    const before = doc.textBetween($pos.start(), pos, "\n", "x");
    const spare =
      doc.textBetween(end, Math.min(end + 1, $pos.end())) === " " &&
      /(^|\s)$/.test(before);
    tr.delete(tr.mapping.map(pos), tr.mapping.map(end + (spare ? 1 : 0)));
  });
  return tr;
}

/** Tags to put in between `before` and `after`, with a space on each side: two paths touching would read as one. */
export function spacedTags(
  tags: JSONContent[],
  before: PMNode | null,
  after: PMNode | null,
) {
  const space = { type: "text", text: " " };
  const nodes: JSONContent[] = tags.flatMap((tag, i) => [
    ...(i ? [space] : []),
    tag,
  ]);
  if (before && !/\s$/.test(before.text ?? "")) nodes.unshift(space);
  if (!/^\s/.test(after?.text ?? "")) nodes.push(space);
  return nodes;
}

/** A paste's text as editor nodes, its lines split by hard breaks. */
export const pasteNodes = (schema: Schema, text: string) =>
  text
    .split("\n")
    .flatMap((line, i) => [
      ...(i ? [schema.nodes.hardBreak.create()] : []),
      ...(line ? [schema.text(line)] : []),
    ]);
