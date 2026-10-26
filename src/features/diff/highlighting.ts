/**
 * How every diff view colours code. The Highlights lexers colour a 4,000-line
 * diff in about a fifth of Shiki's time with a fraction of its memory, so
 * only really long files start plain.
 */
export const HIGHLIGHTER = "highlights";

/** Past this many lines a side, a diff opens as plain text until asked. */
export const HIGHLIGHT_MAX_LINES = 20_000;
