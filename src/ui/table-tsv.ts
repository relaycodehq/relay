/** A cell on one line: tabs and line breaks would split it into more cells or rows. */
export const tsvCell = (text: string) =>
  text.replace(/\s*[\t\r\n]\s*/g, " ").trim();

/** Rows of cells as tab-separated text, which spreadsheets paste as a grid. */
export const toTsv = (rows: string[][]) =>
  rows.map((row) => row.map(tsvCell).join("\t")).join("\n");

export interface CellAt {
  row: number;
  col: number;
}

/**
 * The rectangle a selection's cells span. A text selection runs in reading
 * order, so from the middle of one row to the middle of another it touches
 * every column; a spreadsheet would copy the whole rows then too.
 */
export function cellBlock(touched: CellAt[]) {
  if (!touched.length) return null;
  const rows = touched.map((c) => c.row);
  const cols = touched.map((c) => c.col);
  return {
    top: Math.min(...rows),
    bottom: Math.max(...rows),
    left: Math.min(...cols),
    right: Math.max(...cols),
  };
}
