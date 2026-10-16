import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { resolveFileLink } from "../../shared/markdown-links";

const CITATION =
  /:codex-file-citation\{((?:[^{}"'\r\n]|"[^"\r\n]*"|'[^'\r\n]*')*)\}/g;
const ATTRIBUTE = /\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\d+))\s*/y;

/** Render Codex's file directives through the same links as ordinary Markdown. */
export function normalizeFileCitations(text: string): string {
  if (!text.includes(":codex-file-citation{")) return text;

  // Use Markdown's own code boundaries, including indented code, nested
  // fences and multiline spans. Examples and existing links stay literal.
  const protectedRanges: [number, number][] = [];
  function protect(node: Nodes) {
    if (
      ["code", "inlineCode", "html", "link", "image", "definition"].includes(
        node.type,
      )
    ) {
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        protectedRanges.push([start, end]);
    } else if ("children" in node) node.children.forEach(protect);
  }
  protect(fromMarkdown(text));

  return text.replace(CITATION, (raw: string, body: string, offset: number) => {
    if (
      protectedRanges.some(([start, end]) => offset >= start && offset < end) ||
      (text.slice(0, offset).match(/\\+$/)?.[0].length ?? 0) % 2
    )
      return raw;
    const attrs = new Map<string, string>();
    let at = 0;
    while (at < body.length) {
      ATTRIBUTE.lastIndex = at;
      const attr = ATTRIBUTE.exec(body);
      if (!attr || attrs.has(attr[1]!)) return raw;
      attrs.set(attr[1]!, attr[2] ?? attr[3] ?? attr[4]!);
      at = ATTRIBUTE.lastIndex;
    }
    const path = attrs.get("path");
    if (!path || /[\u0000-\u001f\u007f]/.test(path)) return raw;
    // Encode before resolving, so a literal # or % in the filename survives.
    let href: string;
    try {
      href = encodeURI(path).replace(
        /[?#()[\]]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    } catch {
      return raw;
    }
    if (!resolveFileLink(href)) return raw;
    const start = attrs.get("line_range_start"),
      end = attrs.get("line_range_end");
    const line =
      start && /^[1-9]\d*$/.test(start) && Number.isSafeInteger(Number(start))
        ? Number(start)
        : undefined;
    const last =
      line &&
      end &&
      /^\d+$/.test(end) &&
      Number.isSafeInteger(Number(end)) &&
      Number(end) > line
        ? Number(end)
        : undefined;
    const position = line ? `:${line}${last ? `-${last}` : ""}` : "";
    const label = (path.split(/[/\\]/).at(-1) || path).replace(
      /[\\`*_[\]<>]/g,
      "\\$&",
    );
    return `[${label}${position}](${href}${position})`;
  });
}
