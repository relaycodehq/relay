import type { LspSymbol, LspSymbolKind } from "../../../../shared/language-servers";
import type { FileAuthors } from "../../../../shared/file-authors";

/** What PhpStorm puts usages and an author over: types and what can be called. */
const SHOWN: ReadonlySet<LspSymbolKind> = new Set([
  "class",
  "interface",
  "enum",
  "function",
  "method",
  "constructor",
]);

/** Kinds whose insides are a body of code, where a helper isn't worth a line of its own. */
const BODIES: ReadonlySet<LspSymbolKind> = new Set(["function", "method", "constructor"]);

/** A declaration to hint over, in the server's 0-based lines. */
export type Declaration = { name: string; line: number; character: number; endLine: number };

/** The declarations to hint over, one per line, in order. */
export function visionDeclarations(symbols: readonly LspSymbol[]): Declaration[] {
  const named = new Map<string, LspSymbol[]>();
  for (const symbol of symbols) {
    const same = named.get(symbol.name);
    if (same) same.push(symbol);
    else named.set(symbol.name, [symbol]);
  }
  const taken = new Set<number>();
  const shown: Declaration[] = [];
  for (const symbol of symbols) {
    if (!SHOWN.has(symbol.kind)) continue;
    // A callback's outline name ("useEffect() callback") is no name to count usages of.
    if (/[\s<]/.test(symbol.name)) continue;
    const container = containerOf(symbol, named);
    const inBody = !!container && BODIES.has(container.kind);
    if (inBody || taken.has(symbol.line)) continue;
    taken.add(symbol.line);
    shown.push({
      name: symbol.name,
      line: symbol.line,
      character: symbol.character,
      endLine: symbol.endLine ?? symbol.line,
    });
  }
  return shown.sort((a, b) => a.line - b.line);
}

/** The innermost symbol of the container's name whose lines hold `symbol`: several symbols may share a name. */
function containerOf(symbol: LspSymbol, named: Map<string, LspSymbol[]>) {
  const holds = (outer: LspSymbol) =>
    outer !== symbol && outer.line <= symbol.line && (outer.endLine ?? outer.line) >= symbol.line;
  const same = (symbol.container && named.get(symbol.container)) || [];
  // A server whose ranges don't nest still names the container.
  return same.filter(holds).sort((a, b) => b.line - a.line)[0] ?? same[0];
}

/** What PhpStorm calls code none of which is committed yet. */
export const NEW_CODE = "new *";

/**
 * Who wrote most of these lines, and how many others did: "ada" or "ada +2",
 * with PhpStorm's " *" once some of them are edited and not committed yet
 * (undefined in `committedLines`), and "new *" when none of them is committed.
 */
export function codeAuthor(authors: FileAuthors, committedLines: Iterable<number | undefined>) {
  const counts = new Map<number, number>();
  let edited = false;
  for (const line of committedLines) {
    if (line === undefined) {
      edited = true;
      continue;
    }
    const author = authors.lines[line - 1];
    if (author === undefined || author < 0) continue;
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  if (!counts.size) return edited ? NEW_CODE : undefined;
  const [main] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const others = counts.size > 1 ? ` +${counts.size - 1}` : "";
  return `${authors.authors[main]}${others}${edited ? " *" : ""}`;
}

/** "3 usages", "1 usage", "no usages"; "Show usages" before they're counted. */
export function usagesLabel(count: number | undefined) {
  if (count === undefined) return "Show usages";
  if (count === 0) return "no usages";
  return count === 1 ? "1 usage" : `${count} usages`;
}
