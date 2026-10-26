import type { LspLocation, LspSymbol } from "../../../shared/language-servers";
import { api } from "../../lib/api";
import { lsp } from "../language-servers/client";
import type { FileDocument } from "./documents";
import type { PickItem } from "./SymbolPicker";

/** A path that isn't relative to the project folder: absolute on macOS, Linux or Windows, or a UNC share. */
export const isOutsidePath = (path: string) => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);

/** How many different files get their lines read for a list of usages. */
const MAX_PREVIEW_FILES = 40;

/** Adds the text of each place's line, so the list can show what the usage looks like. */
export async function withPreviews(
  where: string,
  doc: FileDocument,
  items: PickItem[],
): Promise<PickItem[]> {
  const files = new Map<string, Promise<string[] | undefined>>();
  const readLines = (path: string) => {
    const text = isOutsidePath(path)
      ? lsp.readFile(where, path)
      : api.projectFile(where, path).then((file) => file.contents);
    return text.then((contents) => contents.split(/\r?\n/), () => undefined);
  };
  const linesOf = (path: string) => {
    let pending = files.get(path);
    if (pending) return pending;
    if (path === doc.path) pending = Promise.resolve(doc.text().split(/\r?\n/));
    else if (files.size > MAX_PREVIEW_FILES) pending = Promise.resolve(undefined);
    else pending = readLines(path);
    files.set(path, pending);
    return pending;
  };
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      preview: (await linesOf(item.path))?.[item.line - 1],
    })),
  );
}

/** A server's 0-based location as a list item with 1-based line and column. */
export const pickItemAt = (location: LspLocation): PickItem => ({
  path: location.path,
  line: location.line + 1,
  column: location.character + 1,
  outside: location.outside,
});

/** The file's symbols in file order, nested ones indented under the symbol they're in. */
export function structureItems(symbols: LspSymbol[]): PickItem[] {
  return [...symbols]
    .sort((a, b) => a.line - b.line || a.character - b.character)
    .map((symbol) => ({
      path: symbol.path,
      line: symbol.line + 1,
      column: symbol.character + 1,
      name: symbol.name,
      kind: symbol.kind,
      depth: symbol.container ? 1 : 0,
    }));
}
