// settings.json's text edited in place: only the keys a change names, in
// the file's own layout, so comments and the rest stay as written.
import {
  applyEdits,
  createScanner,
  getNodeValue,
  findNodeAtLocation,
  modify,
  parseTree,
  stripComments,
  ScanError,
  SyntaxKind,
  type Edit,
} from "jsonc-parser";
import type { SettingsEdit } from "../../shared/settings-file";

/**
 * Empty, or only comments, as a file with every setting commented out is.
 * A `/*` never closed isn't that: what's saved after it would be inside it.
 */
export function holdsNothing(text: string) {
  return !stripComments(text).trim() && !commentLeftOpen(text);
}

function commentLeftOpen(text: string) {
  const scanner = createScanner(text);
  while (scanner.scan() !== SyntaxKind.EOF)
    if (scanner.getTokenError() === ScanError.UnexpectedEndOfComment)
      return true;
  return false;
}

/** The whitespace a line starts with, for the line `offset` is on. */
function indentAt(text: string, offset: number) {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))![0];
}

/** Where the line `offset` is on ends, before its line break. */
function endOfLine(text: string, offset: number) {
  const end = text.indexOf("\n", offset);
  if (end === -1) return text.length;
  return text[end - 1] === "\r" ? end - 1 : end;
}

/**
 * `value` as JSON laid out like its section: spread over lines indented
 * from `indent` where the section is, on one line where the section is.
 */
function render(value: unknown, indent: string, unit: string | null) {
  return unit === null
    ? JSON.stringify(value, null, 1).replace(/\n\s*/g, " ")
    : JSON.stringify(value, null, unit).replace(/\n/g, `\n${indent}`);
}

/**
 * One edit putting `value` at `path`, or removing it, written in the file's
 * own layout. jsonc-parser finds where it goes; its formatter would also
 * redo every line the edit touches, spreading a `{ "mode": "dark" }` beside
 * it over several lines, so the text is written here instead.
 */
function editAt(text: string, path: string[], value: unknown): Edit[] {
  const [raw] = modify(text, path, value, {});
  if (!raw) return [];
  const root = parseTree(text)!;
  let depth = path.length - 1;
  while (depth > 0 && !findNodeAtLocation(root, path.slice(0, depth))) depth--;
  const section = depth
    ? findNodeAtLocation(root, path.slice(0, depth))!
    : root;
  const inside = text.slice(
    section.offset + 1,
    section.offset + section.length - 1,
  );
  const children = section.children ?? [];
  const sectionIndent = indentAt(text, section.offset);
  const childIndent = children.length
    ? indentAt(text, children[0].offset)
    : sectionIndent + "  ";
  const unit =
    inside.includes("\n") || (section === root && !children.length)
      ? childIndent.slice(sectionIndent.length) || "  "
      : null;

  if (value === undefined) {
    // The first key leaves with the space after it, the next one keeping its line.
    if (raw.offset === section.offset + 1 && children.length > 1) {
      const after = children[0].offset + children[0].length;
      const gap = text.slice(after, children[1].offset);
      const [offset, end] = gap.includes("\n")
        ? [raw.offset, after + gap.lastIndexOf("\n")]
        : [children[0].offset, children[1].offset];
      return [{ offset, length: end - offset, content: "" }];
    }
    return [raw];
  }
  if (raw.length) {
    return [
      { ...raw, content: render(value, indentAt(text, raw.offset), unit) },
    ];
  }
  const wrapped = path
    .slice(depth + 1)
    .reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
  const property = `${JSON.stringify(path[depth])}: ${render(wrapped, childIndent, unit)}`;
  const lineEnd = endOfLine(text, raw.offset);
  const commentAfter = /^[ \t]*(\/\/.*|\/\*.*\*\/[ \t]*)$/.test(
    text.slice(raw.offset, lineEnd),
  );
  if (raw.content.startsWith(",") && unit !== null && commentAfter)
    // The comment stays on the line of the key it was written beside.
    return [
      { offset: raw.offset, length: 0, content: "," },
      { offset: lineEnd, length: 0, content: `\n${childIndent}${property}` },
    ];
  const content = placed(property, {
    afterKey: raw.content.startsWith(","),
    oneLine: unit === null,
    spread: inside.includes("\n"),
    childIndent,
    sectionIndent,
  });
  return [{ ...raw, content }];
}

/**
 * A new `property` as it goes into its section: after another key or as its
 * first, on the section's one line, or on a line of its own in a section
 * already `spread` over lines or one that becomes so.
 */
function placed(
  property: string,
  where: {
    afterKey: boolean;
    oneLine: boolean;
    spread: boolean;
    childIndent: string;
    sectionIndent: string;
  },
) {
  const { afterKey, oneLine, spread, childIndent, sectionIndent } = where;
  if (afterKey && oneLine) return `, ${property}`;
  if (afterKey) return `,\n${childIndent}${property}`;
  if (oneLine) return ` ${property} `;
  if (spread) return `\n${childIndent}${property}`;
  return `\n${childIndent}${property}\n${sectionIndent}`;
}

/** The file's text with each edit's value put at its path, or the key removed. */
export function withEdits(text: string, edits: SettingsEdit[]) {
  let next = text;
  // Commented-out settings stay, above the ones saved.
  if (holdsNothing(text))
    next = text.trim() ? `${text.trimEnd()}\n{}\n` : "{}\n";
  const node = (path: string[]) => findNodeAtLocation(parseTree(next)!, path);
  const edit = (path: string[], value: unknown) => {
    next = applyEdits(next, editAt(next, path, value));
  };
  for (const { path, value } of edits) {
    if (value === undefined) {
      // Not there, so nothing to remove; jsonc-parser throws on a missing section.
      if (!node(path)) continue;
    } else
      for (let depth = 1; depth < path.length; depth++) {
        const parent = node(path.slice(0, depth));
        if (!parent) break;
        if (parent.type !== "object")
          throw new Error(
            `"${path.slice(0, depth).join(".")}" in settings.json should be a { … } section; fix it there first.`,
          );
      }
    edit(path, value);
    if (value !== undefined) continue;
    // A section emptied by its last key goes with it.
    for (let depth = path.length - 1; depth > 0; depth--) {
      const parent = node(path.slice(0, depth));
      const left = parent && getNodeValue(parent);
      if (!left || typeof left !== "object" || Object.keys(left).length) break;
      edit(path.slice(0, depth), undefined);
    }
  }
  if (next.replace(/\s/g, "") === "{}") next = "{}\n";
  if (!next.endsWith("\n")) next += "\n";
  return next;
}
