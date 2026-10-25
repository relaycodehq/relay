/** Where a picked result takes the editor. */
export interface OpenTarget {
  path: string;
  /** 1-based. */
  line?: number;
  /** 0-based offset into the line. */
  column?: number;
}

/** A symbol the host's language servers know by name, for the Symbols section. */
export interface SearchSymbol {
  name: string;
  /** "class", "function" and so on, as the language server calls it. */
  kind?: string;
  /** The class, module or namespace it lives in. */
  container?: string;
  path: string;
  /** 1-based. */
  line: number;
  /** 0-based. */
  column?: number;
}

export type SearchMode = "all" | "files" | "text" | "symbols";
