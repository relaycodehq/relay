import { expect, it } from "vitest";
import { terminalText } from "./terminal-text";

it.each([
  [
    "colours",
    "\x1b[1m\x1b[31mFAIL\x1b[39m\x1b[22m a.test.ts",
    "FAIL a.test.ts",
  ],
  ["a cleared line", "\x1b[2K\x1b[1A\x1b[2Kdone", "done"],
  ["a window title", "\x1b]0;npm test\x07ok", "ok"],
  [
    "a link",
    "see \x1b]8;;https://x.dev\x1b\\docs\x1b]8;;\x1b\\ now",
    "see docs now",
  ],
  ["a saved cursor and charset", "\x1b7\x1b8\x1b(Bok", "ok"],
  ["keyboard modes", "\x1b[>5u\x1b[<uok", "ok"],
  ["a redrawn progress line", "10%\r50%\r100%\nnext", "100%\nnext"],
  ["Windows line ends", "a\r\nb\r\n", "a\nb\n"],
])("drops %s", (_, output, text) => {
  expect(terminalText(output)).toBe(text);
});

it("leaves plain output as it is, indent and all", () => {
  expect(terminalText(" M src/a.ts\n?? b.ts\n")).toBe(" M src/a.ts\n?? b.ts\n");
});
