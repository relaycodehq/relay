/**
 * Turns an answer's markdown into the text an engine reads, cut into chunks:
 * a short first one so the voice starts while the rest is still being made,
 * then a few sentences per chunk.
 */

export const codePlaceholder = "Code block.";
export const firstChunkLimit = 100;
export const chunkLimit = 280;

export function speakableChunks(markdown: string): string[] {
  const sentences = speakableBlocks(markdown).flatMap(sentencesOf);
  return chunked(sentences);
}

/** Paragraphs, headings, list items and table rows as plain sentences, each ending in punctuation. */
export function speakableBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const add = (text: string) => {
    const spoken = finished(spokenInline(text));
    if (spoken) blocks.push(spoken);
  };
  const endParagraph = () => {
    if (paragraph.length) add(paragraph.join(" "));
    paragraph = [];
  };

  const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^(\s{0,3}>\s?)+/, "");
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      endParagraph();
      const mark = fence[1];
      const closes = new RegExp(`^\\s*${mark[0]}{${mark.length},}\\s*$`);
      while (++i < lines.length) {
        if (closes.test(lines[i].replace(/^(\s{0,3}>\s?)+/, ""))) break;
      }
      blocks.push(codePlaceholder);
      continue;
    }
    if (!line.trim()) {
      endParagraph();
      continue;
    }
    if (
      /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) ||
      /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line) ||
      /^\s{0,3}\[[^\]]+\]:\s*\S+/.test(line)
    ) {
      endParagraph();
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)(\s+#+)?\s*$/.exec(line);
    if (heading) {
      endParagraph();
      add(heading[1]);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      endParagraph();
      const cells = line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/);
      add(
        cells
          .map((c) => c.trim())
          .filter(Boolean)
          .join(", "),
      );
      continue;
    }
    const item = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(
      line,
    );
    if (item) {
      endParagraph();
      paragraph.push(item[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  endParagraph();
  return blocks;
}

/** One line of markdown as plain words: code and links by their text, symbols gone. */
export function spokenInline(text: string): string {
  // Code and escaped characters are set aside so nothing below rewrites them.
  const kept: string[] = [];
  const keep = (value: string) => `\u0000${kept.push(value) - 1}\u0000`;
  let out = text
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_, c: string) => keep(c))
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code: string) =>
      keep(spokenCode(code.trim())),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) => hostOf(url))
    .replace(/https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/g, hostOf)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/\s*(?:→|⟶|⇒|->|=>)\s*/g, " to ")
    .replace(/\s+/g, " ")
    .trim();
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]);
  return out;
}

// Said as words rather than letter by letter.
const wordExtensions = new Set([
  "json",
  "yaml",
  "toml",
  "lock",
  "swift",
  "java",
]);

/**
 * A file name or path in inline code as a person would say it: just the
 * name, which the screen shows the folders of, with its extension spelled
 * out, since every engine reads ".ts" as "tess".
 */
function spokenCode(code: string) {
  const file = /^[\w./@-]*?([\w.@-]+)\.([A-Za-z][A-Za-z0-9]{0,4})$/.exec(code);
  if (!file || !/[/.]/.test(code) || /^\d/.test(file[2])) return code;
  const name = file[1].replace(/[-_.]+/g, " ").trim();
  const ext = file[2];
  const said = wordExtensions.has(ext.toLowerCase())
    ? ext.toLowerCase()
    : ext.toUpperCase().split("").join(" ");
  return `${name} dot ${said}`;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function finished(text: string) {
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return "";
  return /[.!?…:;]["'”’)\]]*$/.test(text) ? text : `${text}.`;
}

/**
 * Cuts after . ! ? or … when a space and something other than a lowercase
 * letter follow, so "e.g. this", "1.5" and "app.ts" stay whole.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["'”’)\]]*)\s+(?=[^\p{Ll}])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function chunked(sentences: string[]) {
  const out: string[] = [];
  let current = "";
  const limit = () => (out.length ? chunkLimit : firstChunkLimit);
  for (const sentence of sentences) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (joined.length <= limit()) {
      current = joined;
      continue;
    }
    if (current) out.push(current);
    let rest = sentence;
    while (rest.length > limit()) {
      const at = breakAt(rest, limit());
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    current = rest;
  }
  if (current) out.push(current);
  return out;
}

/** Where to cut a sentence longer than `limit`: after a clause if one is near, else at a space. */
function breakAt(text: string, limit: number) {
  const head = text.slice(0, limit + 1);
  let clause = -1;
  for (const m of head.matchAll(/[,;:—–]\s|\s[-–—]\s/g)) {
    clause = m.index + m[0].length;
  }
  if (clause > limit * 0.4 && clause <= limit) return clause;
  const space = head.lastIndexOf(" ");
  return space > 0 ? space : limit;
}
