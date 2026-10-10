// A selection in an answer, back as markdown: its lists keep their numbers,
// code its fence, tables their rows, so a kept selection reads like the answer.

/** The little of the DOM this reads, so it can be tried on plain objects. */
export interface MdNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MdNode>;
  getAttribute?: (name: string) => string | null;
}

const TEXT = 3;
const ELEMENT = 1;

/** Where the selection sits when it starts and ends inside one list or code block. */
export interface SelectionContext {
  /** The selected items are a run of this list's, the first of them numbered `start`. */
  list?: { ordered: boolean; start: number };
  /** The selection is code from a block in this language. */
  code?: { lang?: string };
}

const name = (node: MdNode) => node.nodeName.toLowerCase();
const attr = (node: MdNode, key: string) => node.getAttribute?.(key) ?? null;
const classes = (node: MdNode) => (attr(node, "class") ?? "").split(/\s+/);
const children = (node: MdNode) => Array.from(node.childNodes);

const BLOCKS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "pre",
  "blockquote",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
]);

function fence(code: string, lang = "") {
  const ticks = "`".repeat(
    Math.max(3, ...[...code.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)),
  );
  return `${ticks}${lang}\n${code.replace(/\n$/, "")}\n${ticks}`;
}

function language(pre: MdNode) {
  const code = children(pre).find((c) => name(c) === "code") ?? pre;
  return classes(code)
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length);
}

/** Text the page shows but the answer didn't write: buttons, resize handles. */
function skipped(node: MdNode) {
  if (name(node) === "button") return !classes(node).includes("chat-file-link");
  return attr(node, "aria-hidden") === "true" || name(node) === "svg";
}

function inline(node: MdNode): string {
  if (node.nodeType === TEXT) return node.textContent ?? "";
  if (node.nodeType !== ELEMENT && node.nodeType !== 11) return "";
  if (skipped(node)) return "";
  // A file chip stands for the path the answer named.
  if (classes(node).includes("chat-file-link"))
    return `\`${attr(node, "title") ?? node.textContent ?? ""}\``;
  if (classes(node).includes("katex")) {
    const tex = findTex(node);
    if (tex !== undefined) return `$${tex}$`;
  }
  const inner = children(node).map(inline).join("");
  switch (name(node)) {
    case "strong":
    case "b":
      return inner.trim() ? `**${inner}**` : inner;
    case "em":
    case "i":
      return inner.trim() ? `*${inner}*` : inner;
    case "del":
    case "s":
      return inner.trim() ? `~~${inner}~~` : inner;
    case "code":
      return `\`${node.textContent ?? ""}\``;
    case "br":
      return "\n";
    case "a": {
      const href = attr(node, "href");
      return href && href !== inner ? `[${inner}](${href})` : inner;
    }
    default:
      return inner;
  }
}

function findTex(node: MdNode): string | undefined {
  if (
    name(node) === "annotation" &&
    attr(node, "encoding") === "application/x-tex"
  )
    return node.textContent ?? "";
  for (const child of children(node)) {
    const tex = findTex(child);
    if (tex !== undefined) return tex;
  }
  return undefined;
}

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 || !line ? line : by + line))
    .join("\n");

function list(node: MdNode, ordered: boolean, start: number) {
  let n = start;
  return children(node)
    .filter((c) => name(c) === "li")
    .map((li) => {
      const marker = ordered ? `${n++}. ` : "- ";
      return marker + indent(blocks(li), " ".repeat(marker.length));
    })
    .join("\n");
}

function table(node: MdNode) {
  const rows: string[][] = [];
  const walk = (n: MdNode) => {
    if (name(n) === "tr")
      rows.push(
        children(n)
          .filter((c) => name(c) === "td" || name(c) === "th")
          .map((c) =>
            inline(c).trim().replace(/\|/g, "\\|").replace(/\n/g, " "),
          ),
      );
    else children(n).forEach(walk);
  };
  walk(node);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [
    line(rows[0]!),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...rows.slice(1).map(line),
  ].join("\n");
}

function block(node: MdNode): string {
  const tag = name(node);
  if (classes(node).includes("katex-display")) {
    const tex = findTex(node);
    if (tex !== undefined) return `$$\n${tex}\n$$`;
  }
  switch (tag) {
    case "ul":
    case "ol":
      return list(node, tag === "ol", Number(attr(node, "start")) || 1);
    case "pre":
      return fence(node.textContent ?? "", language(node));
    case "blockquote":
      return blocks(node)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "table":
      return table(node);
    case "hr":
      return "---";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `${"#".repeat(Number(tag[1]))} ${inline(node).trim()}`;
    default:
      return blocks(node);
  }
}

/** A node's children as markdown blocks, runs of inline content as paragraphs. */
function blocks(node: MdNode): string {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    const text = run.replace(/[ \t]+\n/g, "\n").trim();
    if (text) out.push(text);
    run = "";
  };
  for (const child of children(node)) {
    if (child.nodeType === ELEMENT && skipped(child)) continue;
    if (child.nodeType === ELEMENT && BLOCKS.has(name(child))) {
      flush();
      const text = block(child);
      if (text.trim()) out.push(text);
    } else run += inline(child);
  }
  flush();
  // Items of one list sit on their own lines; other blocks a blank line apart.
  return out.join(name(node) === "li" ? "\n" : "\n\n");
}

/** The selected `fragment` as markdown. */
export function selectionMarkdown(
  fragment: MdNode,
  context: SelectionContext = {},
): string {
  if (context.code) return fence(fragment.textContent ?? "", context.code.lang);
  if (context.list) {
    const items = children(fragment).filter((c) => name(c) === "li");
    if (items.length)
      return list(fragment, context.list.ordered, context.list.start).trim();
  }
  return blocks(fragment).trim();
}

/** The selection's context in the page: the list or code block it stays inside. */
export function selectionContext(range: Range): SelectionContext {
  const common = range.commonAncestorContainer;
  const element =
    common instanceof Element ? common : (common.parentElement ?? undefined);
  const pre = element?.closest("pre");
  if (pre) return { code: { lang: language(pre) } };
  // Across items of one list, the copy holds bare items; number them as the list does.
  if (element?.matches("ol, ul")) {
    const items = Array.from(element.children).filter(
      (c) => c.tagName === "LI",
    );
    const first = items.findIndex((li) => li.contains(range.startContainer));
    const from = Number(element.getAttribute("start")) || 1;
    return {
      list: {
        ordered: element.tagName === "OL",
        start: from + Math.max(0, first),
      },
    };
  }
  return {};
}
