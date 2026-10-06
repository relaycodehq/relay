import type { Root, RootContent } from "mdast";
import type { Parser, Plugin } from "unified";
import type { Node, Point } from "unist";

type StablePrefix = {
  text: string;
  /** Line the text after the prefix starts on. */
  nextLine: number;
  nodes: RootContent[];
};

/**
 * Parses only what changed since the last render of a streamed answer: text
 * up to a finished top-level fence and the blank line after it is reused
 * from a cache, so old code blocks are not parsed again on every token. The
 * tree, positions included, always equals a full parse; anything that could
 * differ falls back to one.
 *
 * One call per streaming renderer. The returned plugin owns one cache and
 * may be attached to a new processor on every render.
 */
export function streamingMarkdownTail(): Plugin<[], Root> {
  let cache: StablePrefix | undefined;

  return function incrementalMarkdown() {
    const parse = this.parser as Parser<Root> | undefined;
    if (!parse) return;
    let parsedDocument = false;

    this.parser = (source, file) => {
      // Later parses on this processor come from transforms working on
      // synthetic text, which must not touch the document's cache.
      if (parsedDocument) return parse(source, file);
      parsedDocument = true;

      // A trailing \r may become half of a \r\n with the next token, and a
      // BOM is only stripped at the start of a parse.
      if (/[\r\uFEFF]/.test(source)) return parse(source, file);

      const prefix = cache;
      if (prefix && source.startsWith(prefix.text)) {
        const suffix = parse(source.slice(prefix.text.length), file);
        if (hasDefinition(suffix)) return parse(source, file);
        shiftPositions(suffix, prefix.nextLine - 1, prefix.text.length);
        const tree: Root = {
          ...suffix,
          children: [...structuredClone(prefix.nodes), ...suffix.children],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: suffix.position?.end ?? {
              line: prefix.nextLine,
              column: 1,
              offset: prefix.text.length,
            },
          },
        };
        const next = stablePrefix(source, suffix.children);
        if (next)
          cache = {
            text: next.text,
            nextLine: next.nextLine,
            nodes: [...prefix.nodes, ...structuredClone(next.nodes)],
          };
        return tree;
      }

      const tree = parse(source, file);
      if (hasDefinition(tree)) return tree;
      const next = stablePrefix(source, tree.children);
      if (next) cache = { ...next, nodes: structuredClone(next.nodes) };
      return tree;
    };
  };
}

function hasDefinition(node: Node): boolean {
  if (node.type === "definition" || node.type === "footnoteDefinition")
    return true;
  const children = (node as { children?: Node[] }).children;
  return !!children?.some(hasDefinition);
}

function shiftPositions(node: Node, lines: number, offset: number) {
  const shift = (point: Point) => {
    point.line += lines;
    if (point.offset !== undefined) point.offset += offset;
  };
  if (node.position) {
    shift(node.position.start);
    shift(node.position.end);
  }
  const children = (node as { children?: Node[] }).children;
  if (children)
    for (const child of children) shiftPositions(child, lines, offset);
}

/**
 * The latest closed top-level fence among `nodes` that a blank line follows,
 * with everything before it. `nodes` carry absolute positions in `source`.
 */
function stablePrefix(
  source: string,
  nodes: RootContent[],
): StablePrefix | undefined {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!;
    if (node.type !== "code" || !node.position) continue;
    const { start, end } = node.position;
    if (start.offset === undefined || end.offset === undefined) continue;

    const openStart = source.lastIndexOf("\n", start.offset - 1) + 1;
    const openEnd = lineEnd(source, openStart);
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(
      source.slice(openStart, openEnd),
    )?.[1];
    if (!opener) continue;

    const closeStart = source.lastIndexOf("\n", end.offset - 1) + 1;
    if (closeStart <= openStart) continue;
    const closeEnd = lineEnd(source, closeStart);
    const closer = /^ {0,3}(`+|~+)[ \t]*$/.exec(
      source.slice(closeStart, closeEnd),
    )?.[1];
    if (!closer || closer[0] !== opener[0] || closer.length < opener.length)
      continue;

    const blank = /^\n[ \t]*\n/.exec(source.slice(closeEnd));
    if (!blank) continue;
    return {
      text: source.slice(0, closeEnd + blank[0].length),
      nextLine: end.line + 2,
      nodes: nodes.slice(0, index + 1),
    };
  }
  return undefined;
}

function lineEnd(source: string, from: number) {
  const index = source.indexOf("\n", from);
  return index < 0 ? source.length : index;
}
