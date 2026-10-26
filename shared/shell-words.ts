// A shell command line read the way the shell splits it, enough to tell what
// each part runs: quotes, `;` and `&&` chains, pipes, heredocs, and the
// `/bin/zsh -lc '…'` Codex wraps every command in.

/** Codex runs everything as `/bin/zsh -lc '<command>'`; a label cut short may have lost the closing quote. */
export function unwrapShell(command: string): string {
  const wrapped = /^\s*(?:\S*\/)?(?:ba|z)?sh\s+-\w*c\s+(['"])([\s\S]*)$/.exec(command);
  if (!wrapped) return command;
  const quote = wrapped[1]!;
  const rest = wrapped[2]!.trimEnd();
  const inner = rest.endsWith(quote) ? rest.slice(0, -1) : rest;
  // Inside single quotes a quote is written '\''; inside double quotes, \" \\ \$ \`.
  return quote === "'" ? inner.replaceAll(`'\\''`, "'") : inner.replace(/\\(["\\$`])/g, "$1");
}

/** Where a line's quoted stretches start and end, so a `<<` or `|` inside them is text. */
function quotedSpans(line: string) {
  const spans: [number, number][] = [];
  let quote = "";
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) {
        spans.push([start, i]);
        quote = "";
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      start = i;
    }
  }
  if (quote) spans.push([start, line.length]);
  return spans;
}

/**
 * The delimiter of the first heredoc a line opens, `EOF` in `cat <<'EOF'`.
 * Quoted text isn't one, except inside a `"$(…)"`, where the shell runs it.
 */
export function heredocOpened(line: string): string | undefined {
  const spans = quotedSpans(line);
  for (const found of line.matchAll(/<<-?\s*(['"]?)(\w+)\1/g)) {
    const span = spans.find(([start, end]) => found.index > start && found.index < end);
    const substituted = span && line[span[0]] === '"' && line.slice(span[0], found.index).includes("$(");
    if (!span || substituted) return found[2];
  }
  return undefined;
}

/** The command without its heredoc bodies, which come back in the order they were opened. */
export function heredocs(command: string) {
  const lines = command.split("\n");
  const head: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    head.push(lines[i]!);
    const delimiter = heredocOpened(lines[i]!);
    if (!delimiter) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim() === delimiter);
    const stop = end === -1 ? lines.length : end;
    bodies.push(lines.slice(i + 1, stop).join("\n"));
    i = stop;
  }
  return { head: head.join("\n"), bodies };
}

/** Splits on ; && || and newlines, minding quotes. */
export function segments(line: string) {
  const out: string[] = [];
  let quote = "";
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
      current += c;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    const pair = line.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      out.push(current);
      current = "";
      i++;
    } else if (c === ";" || c === "\n") {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Words with their quotes taken off. */
export function wordsOf(segment: string) {
  return [...segment.matchAll(/'([^']*)'|"((?:\\.|[^"])*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

/** The words that aren't flags, redirections or heredoc marks. */
export const positional = (args: string[]) => args.filter((a) => !/^[-<>]/.test(a));

/** Programs that only trim what the one before them printed. */
const filters = new Set(["head", "tail", "cut", "sort", "uniq", "wc", "awk", "grep", "sed", "tr"]);

/** Where a segment's first `|` is, outside quotes; -1 when it has none. */
function pipeAt(segment: string) {
  let quote = "";
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "|" && segment[i + 1] !== "|") return i;
  }
  return -1;
}

/** The first stage of a pipeline when what comes after `|` only trims its output. */
export function firstStage(segment: string) {
  const at = pipeAt(segment);
  if (at === -1) return segment;
  const next = segment.slice(at + 1).trim().split(/\s+/)[0]!;
  return filters.has(next) ? segment.slice(0, at).trim() : segment;
}

/** What a segment pipes into: `node` in `cat <<EOF | node`. */
export function pipedInto(segment: string) {
  const at = pipeAt(segment);
  return at === -1 ? undefined : segment.slice(at + 1).trim();
}

/** Where a segment sends its output with `>`, quotes taken off. */
export function writesTo(segment: string) {
  const found = /(?:^|\s)>\s*(?:"([^"]+)"|'([^']+)'|([^\s&|;<>'"]+))/.exec(segment);
  return found ? (found[1] ?? found[2] ?? found[3]) : undefined;
}
