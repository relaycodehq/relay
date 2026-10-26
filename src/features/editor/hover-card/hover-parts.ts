/**
 * A language server's hover, taken apart into what the card shows. Servers
 * write it as Markdown, each its own way: vtsls and pyright start with a code
 * block that names the kind in brackets, intelephense heads it with the
 * qualified name in bold, clangd with a "### kind `name`" heading and a
 * "// In Owner" line, rust-analyzer with a block holding the module path.
 */
export type HoverParts = {
  /** What the symbol is, as the server names it: "method", "class", "local const". */
  kind?: string;
  /** The class, namespace or module the symbol belongs to. */
  owner?: string;
  /** The declaration, as code. */
  signature?: string;
  /** The description, as Markdown. */
  docs: string;
  /** What the doc tags say, like the parameters and what it returns, in the order they came. */
  tags: DocTag[];
};

/** One kind of doc tag, like every `@param`, and each one's Markdown. */
export type DocTag = { label: string; entries: string[] };

const FENCE = /```[^\n]*\n([\s\S]*?)\n?```/g;
const CLANGD_HEADING = /^#{1,6}\s+([\w ]+?)\s+`[^`]+`[ \t]*(?:\n|$)/;
const BOLD_NAME = /^(?:__|\*\*)([^_*\n]+)(?:__|\*\*)[ \t]*(?:\n|$)/;
const MODULE_PATH = /^[\w]+(?:::[\w]+)*$/;
const TAG_LINE = /^[*_]@(\w+)[*_](?:\s+(?:—\s*)?|$)(.*)$/;

const TAG_LABELS: Record<string, string> = {
  param: "Params",
  returns: "Returns",
  return: "Returns",
  throws: "Throws",
  throw: "Throws",
  exception: "Throws",
  deprecated: "Deprecated",
  see: "See also",
  example: "Example",
  template: "Type params",
  typeParam: "Type params",
  since: "Since",
};

const KIND_IN_BRACKETS = /^\(([\w ]+)\)\s+/;
const MEMBER_KINDS = new Set(["method", "property", "getter", "setter", "enum member"]);
const DECLARATION_WORDS =
  /^(class|interface|type|enum|namespace|module|function|const|let|var|struct|trait|fn|def|impl|union)\b/;
/** TypeScript's bracketed kinds, as the keyword that declares them. */
const KIND_KEYWORDS: Record<string, string> = {
  function: "function",
  "local function": "function",
  const: "const",
  "local const": "const",
  let: "let",
  "local let": "let",
  var: "var",
  "local var": "var",
  class: "class",
};

export function hoverParts(markdown: string): HoverParts {
  let text = markdown.replace(/\r\n/g, "\n").trim();
  let kind: string | undefined;
  let owner: string | undefined;

  const heading = CLANGD_HEADING.exec(text);
  if (heading) {
    kind = heading[1];
    text = text.slice(heading[0].length).trim();
  }
  const bold = BOLD_NAME.exec(text);
  if (bold) {
    owner = ownerOfQualified(bold[1]);
    text = text.slice(bold[0].length).trim();
  }

  const blocks = [...text.matchAll(FENCE)];
  const [first, second] = blocks;
  const startsWithModulePath =
    first?.index === 0 && second && MODULE_PATH.test(first[1].trim());
  if (startsWithModulePath) owner = first[1].trim();
  const declaration = startsWithModulePath ? second : first;
  if (!declaration) return { kind, owner, ...docsAndTags(text) };

  const used = startsWithModulePath ? [first, second] : [first];
  const rest = used.reduceRight((left, block) => cut(left, block), text);
  const read = readSignature(declaration[1]);
  return {
    kind: read.kind ?? kind,
    owner: read.owner ?? owner,
    signature: read.signature,
    ...docsAndTags(rest),
  };
}

/** "App\Http\UserController::show" is in UserController. */
function ownerOfQualified(name: string) {
  const at = name.lastIndexOf("::");
  if (at < 0) return undefined;
  return name.slice(0, at).split("\\").pop();
}

function cut(text: string, block: RegExpMatchArray) {
  const from = block.index!;
  return text.slice(0, from) + text.slice(from + block[0].length);
}

/** Without the rules servers put between sections, and without runs of blank lines. */
function tidyDocs(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The description, and the doc tags after it grouped by kind. A tag runs on
 * to the next one, so an `@example`'s code block stays with it.
 */
function docsAndTags(text: string) {
  const lines = tidyDocs(text).split("\n");
  const firstTag = lines.findIndex((line) => TAG_LINE.test(line));
  if (firstTag < 0) return { docs: lines.join("\n"), tags: [] };
  const tags: DocTag[] = [];
  let entry: string[] | undefined;
  const finish = () => {
    if (entry) tags[tags.length - 1].entries.push(entry.join("\n").trim());
  };
  for (const line of lines.slice(firstTag)) {
    const tag = TAG_LINE.exec(line);
    if (!tag) {
      entry?.push(line);
      continue;
    }
    finish();
    const label = TAG_LABELS[tag[1]] ?? tag[1][0].toUpperCase() + tag[1].slice(1);
    if (tags.at(-1)?.label !== label) tags.push({ label, entries: [] });
    entry = [tag[2]];
  }
  finish();
  for (const tag of tags) tag.entries = tag.entries.filter(Boolean);
  return { docs: lines.slice(0, firstTag).join("\n").trim(), tags };
}

function readSignature(code: string) {
  let kind: string | undefined;
  let owner: string | undefined;
  const lines = code.split("\n").filter((line) => !/^\s*(<\?php|\?>)\s*$/.test(line));
  // clangd says where a member lives in a comment above it.
  while (lines.length && /^\s*\/\//.test(lines[0])) {
    const inOwner = /^\s*\/\/\s*In\s+(.+?)\s*$/.exec(lines[0]);
    if (inOwner) owner = inOwner[1];
    lines.shift();
  }
  let signature = lines
    .join("\n")
    .trim()
    .replace(/^(public|private|protected):\s*/, "")
    .replace(/\s*\{\s*\}\s*$/, "")
    .replace(/;\s*$/, "");

  // An optional parameter already says it may be missing.
  signature = signature.replace(/(\?:\s*[^,()]+?)\s*\|\s*undefined\b/g, "$1");
  const bracketed = KIND_IN_BRACKETS.exec(signature);
  if (bracketed) {
    kind = bracketed[1];
    signature = signature.slice(bracketed[0].length);
    // An imported name repeats the import under what it is.
    if (kind === "alias") signature = signature.replace(/\n\s*import\s[^\n]*$/, "");
    if (MEMBER_KINDS.has(kind)) {
      const member = /^([\w$]+(?:\.[\w$]+)*)\.(?=[\w$#]+)/.exec(signature);
      if (member) {
        owner = member[1];
        signature = signature.slice(member[0].length);
      }
    }
    const keyword = KIND_KEYWORDS[kind];
    if (keyword && !signature.startsWith(keyword + " ")) signature = `${keyword} ${signature}`;
  } else {
    kind = DECLARATION_WORDS.exec(signature)?.[1];
  }
  return { kind, owner, signature };
}
