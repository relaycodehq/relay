// Terminal output for the `relay` command: colour only on a terminal, and
// never when NO_COLOR asks for none.
const tty = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) =>
  tty ? `\x1b[${code}m${text}\x1b[0m` : text;

export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");
export const cyan = paint("36");
export const colorful = tty;

export const ok = (text: string) => `${green("✓")} ${text}`;
export const warn = (text: string) => `${yellow("!")} ${text}`;
export const fail = (text: string) => `${red("✗")} ${text}`;

/** "3h 12m", "5m", "40s". */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export const ago = (at: number, now = Date.now()) =>
  now - at < 60_000 ? "just now" : `${duration(now - at)} ago`;

/** Cuts `text` to `width` characters with an ellipsis. */
export const clip = (text: string, width: number) =>
  [...text].length <= width
    ? text
    : [...text].slice(0, width - 1).join("") + "…";

/** Columns padded to their widest cell; colour codes don't count toward width. */
export function table(rows: string[][]) {
  const visible = (cell: string) =>
    [...cell.replace(/\x1b\[[0-9;]*m/g, "")].length;
  const widths: number[] = [];
  for (const row of rows)
    row.forEach(
      (cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visible(cell))),
    );
  return rows
    .map((row) =>
      row
        .map((cell, i) =>
          i === row.length - 1
            ? cell
            : cell + " ".repeat(widths[i]! - visible(cell)),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
