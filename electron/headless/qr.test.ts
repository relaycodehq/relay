import { expect, it } from "vitest";
import { encode } from "uqr";
import { terminalQr } from "./qr";

/** The modules a rendering shows, read back from its half blocks. */
function modules(text: string, color: boolean) {
  const rows: boolean[][] = [];
  for (const line of text.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    const top: boolean[] = [],
      bottom: boolean[] = [];
    for (const ch of line) {
      // In colour the glyph draws dark modules; plain, it draws light ones.
      const [t, b] =
        ch === "█"
          ? [true, true]
          : ch === "▀"
            ? [true, false]
            : ch === "▄"
              ? [false, true]
              : [false, false];
      top.push(color ? t : !t);
      bottom.push(color ? b : !b);
    }
    rows.push(top, bottom);
  }
  return rows;
}

it("draws every module of the code, in colour and without", () => {
  const link = "relay-remote://pair?h=100.64.0.1&p=47821&k=key&c=code&n=Mini";
  const { data } = encode(link, { ecc: "M", border: 2 });
  for (const color of [true, false]) {
    const drawn = modules(terminalQr(link, { color }), color);
    expect(drawn.slice(0, data.length)).toEqual(data);
  }
  expect(terminalQr(link)).toContain("\x1b[38;5;16;48;5;231m");
  expect(terminalQr(link, { color: false })).not.toContain("\x1b[");
});
