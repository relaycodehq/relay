const EXTERNAL = /^[a-z][a-z0-9+.-]*:|^\/\//i;

/** A relative path from the file's folder to the project root, or null if it leaves it. */
export function projectPath(from: string, src: string): string | null {
  if (EXTERNAL.test(src)) return null;
  let clean: string;
  try {
    clean = decodeURI(src.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (!parts.pop()) return null;
  }
  return parts.join("/") || null;
}

export type MarkdownLink =
  | { kind: "section"; id: string }
  | { kind: "file"; path: string }
  | { kind: "outside" };

/**
 * Where a link in the Markdown file at `from` leads: a heading in the same
 * file, another file in the project, or out of it. Undefined for a URL with a
 * scheme, which the renderer handles itself.
 */
export function markdownLink(
  from: string,
  href: string,
): MarkdownLink | undefined {
  if (EXTERNAL.test(href)) return undefined;
  const hash = href.indexOf("#");
  let id = "";
  try {
    id = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
  } catch {
    id = href.slice(hash + 1);
  }
  if (hash === 0) return { kind: "section", id };
  const path = projectPath(from, href);
  if (!path) return { kind: "outside" };
  return path === from && id ? { kind: "section", id } : { kind: "file", path };
}

/** GitHub's anchor for a heading: lower case, punctuation gone, spaces as hyphens. */
export function headingSlug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/**
 * The anchor of each heading in order, numbered like GitHub's when two read
 * the same (`setup`, `setup-1`).
 */
export function headingSlugs(texts: string[]) {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = headingSlug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  });
}
