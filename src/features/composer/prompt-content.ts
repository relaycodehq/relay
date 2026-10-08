import type { JSONContent } from "@tiptap/core";
import { quoteBlock, unquote } from "./composer-quotes";
import { pasteBlock } from "../../../shared/pasted-texts";

/**
 * Rebuilds the editor document from the draft text. Skill tokens, blockquotes
 * and file paths only become pills when this draft registered them, so text
 * the user typed by hand stays text. Fenced pastes and `[Image #n]` always do:
 * nobody types those, and an agent would read the token as a screenshot anyway.
 */
export function promptContent(
  value: string,
  labels: Record<string, string>,
  quotes: string[] = [],
  files: string[] = [],
): JSONContent {
  const nodes: JSONContent[] = [];
  const plain = (chunk: string) => {
    const pattern =
      /(\n|\[Image #\d+\]|`[^`\n]+`|(?:\$|\/skill:)[A-Za-z_][A-Za-z0-9_.:-]*)/g;
    let last = 0;
    for (const m of chunk.matchAll(pattern)) {
      if (m.index! > last)
        nodes.push({ type: "text", text: chunk.slice(last, m.index) });
      if (m[0] === "\n") nodes.push({ type: "hardBreak" });
      else if (m[0].startsWith("[Image #"))
        nodes.push({
          type: "relayImage",
          attrs: { n: Number(m[0].slice(8, -1)) },
        });
      else if (m[0].startsWith("`") && files.includes(m[0].slice(1, -1)))
        nodes.push({ type: "relayFile", attrs: { path: m[0].slice(1, -1) } });
      else if (
        labels[m[0]] &&
        (m.index === 0 || /\s/.test(chunk[m.index! - 1]))
      )
        nodes.push({
          type: "relaySkill",
          attrs: { token: m[0], label: labels[m[0]] },
        });
      else nodes.push({ type: "text", text: m[0] });
      last = m.index! + m[0].length;
    }
    if (last < chunk.length)
      nodes.push({ type: "text", text: chunk.slice(last) });
  };
  const quoted = (chunk: string) => {
    let last = 0;
    for (const m of chunk.matchAll(quoteBlock)) {
      const quote = unquote(m[0]);
      if (!quotes.includes(quote)) continue;
      // The break promptText puts before a quote that follows text.
      const joined = m.index! > 1 && chunk[m.index! - 2] !== "\n";
      plain(chunk.slice(last, m.index! - (joined ? 1 : 0)));
      nodes.push({ type: "relayQuote", attrs: { text: quote } });
      last = m.index! + m[0].length;
    }
    plain(chunk.slice(last));
  };
  let last = 0;
  for (const m of value.matchAll(pasteBlock)) {
    quoted(value.slice(last, m.index));
    nodes.push({
      type: "relayPaste",
      attrs: { n: Number(m[1]), text: m[3] },
    });
    last = m.index! + m[0].length;
  }
  quoted(value.slice(last));
  return { type: "doc", content: [{ type: "paragraph", content: nodes }] };
}
