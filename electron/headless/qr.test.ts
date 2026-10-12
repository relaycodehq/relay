import { expect, it } from "vitest";
import { encode } from "uqr";
import { terminalQr } from "./qr";

/** The modules a coloured rendering shows: the cell's background is the
 * top module, a lower half block in the foreground colour the bottom one. */
function colourModules(text: string) {
  const rows: boolean[][] = [];
  for (const line of text.split("\n")) {
    const top: boolean[] = [],
      bottom: boolean[] = [];
    let fg = "",
      bg = "";
    for (const [, codes, ch] of line.matchAll(/\x1b\[([0-9;]*)m|(.)/gsu)) {
      if (codes !== undefined) {
        const fgCode = /38;5;(\d+)/.exec(codes)?.[1];
        const bgCode = /48;5;(\d+)/.exec(codes)?.[1];
        if (fgCode) fg = fgCode;
        if (bgCode) bg = bgCode;
        continue;
      }
      top.push(bg === "16");
      bottom.push(ch === "▄" ? fg === "16" : bg === "16");
    }
    rows.push(top, bottom);
  }
  return rows;
}

/** The modules a plain rendering shows: its glyphs draw the light ones. */
function plainModules(text: string) {
  const rows: boolean[][] = [];
  for (const line of text.split("\n")) {
    const top: boolean[] = [],
      bottom: boolean[] = [];
    for (const ch of line) {
      top.push(ch === " " || ch === "▄");
      bottom.push(ch === " " || ch === "▀");
    }
    rows.push(top, bottom);
  }
  return rows;
}

it("draws every module of the code, in colour and without", () => {
  const link = "relay-remote://pair?h=100.64.0.1&p=47821&k=key&c=code&n=Mini";
  const { data } = encode(link, { ecc: "M", border: 2 });
  expect(colourModules(terminalQr(link)).slice(0, data.length)).toEqual(data);
  expect(
    plainModules(terminalQr(link, { color: false })).slice(0, data.length),
  ).toEqual(data);
  // Full blocks and upper halves leave a seam under each row in Terminal.app.
  expect(terminalQr(link)).not.toMatch(/[█▀]/);
  expect(terminalQr(link, { color: false })).not.toContain("\x1b[");
});
