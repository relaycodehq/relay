import type { SearchMode } from "./types";

const labels: Record<SearchMode, string> = {
  all: "All",
  files: "Files",
  text: "Text",
  symbols: "Symbols",
};

const placeholders: Record<SearchMode, string> = {
  all: "Search files, text and symbols…",
  files: "Go to file…  (Name:42 jumps to a line)",
  text: "Find in files…",
  symbols: "Go to symbol…",
};

export const modeLabel = (mode: SearchMode) => labels[mode];
export const modePlaceholder = (mode: SearchMode) => placeholders[mode];

/** The tabs, which have Symbols only when the host can look symbols up. */
export function modesFor(hasSymbols: boolean): SearchMode[] {
  return hasSymbols
    ? ["all", "files", "text", "symbols"]
    : ["all", "files", "text"];
}

/** Symbols is not a tab without a lookup, so the palette opens on All instead. */
export function startingMode(initial: SearchMode, hasSymbols: boolean) {
  return initial === "symbols" && !hasSymbols ? "all" : initial;
}

/** The tab `step` places from `current`, wrapping around either end. */
export function modeAfter(
  modes: SearchMode[],
  current: SearchMode,
  step: 1 | -1,
) {
  return modes[(modes.indexOf(current) + step + modes.length) % modes.length];
}

/** Which sections a tab shows. */
export function sectionsShownIn(mode: SearchMode, hasSymbols: boolean) {
  const all = mode === "all";
  return {
    files: all || mode === "files",
    text: all || mode === "text",
    symbols: hasSymbols && (all || mode === "symbols"),
  };
}
