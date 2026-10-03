import { expect, it } from "vitest";
import { pasteMarkdown, type PastedText } from "../../shared/pasted-texts";
import { namesItself, promptTitle } from "./thread-titles";

const log = Array.from(
  { length: 14 },
  (_, i) => `  at frame${i} (src/app.ts:${i + 1})`,
).join("\n");
const pastes: PastedText[] = [
  { n: 1, text: `TypeError: boom\n${log}` },
  { n: 3, text: "```ts\nconst a = 1;\n```\n\ntrailing prose" },
];
/** The message as the composer serialises it: pills where they were pasted. */
const message = (text: string, ...parts: PastedText[]) =>
  (text + parts.map(pasteMarkdown).join("")).trim();

it("names a thread after its text, or the paste when nothing was typed", () => {
  expect(promptTitle(message("@claude Fix it", ...pastes))).toBe("Fix it");
  expect(promptTitle("@opencode Write notes.md")).toBe("Write notes.md");
  expect(promptTitle(message("@claude", ...pastes))).toBe("TypeError: boom");
  expect(promptTitle(`@claude ${message("", ...pastes)}`)).toBe(
    "TypeError: boom",
  );
});
it("names a thread at send unless only screenshots were sent", () => {
  expect(namesItself("@claude Fix [Image #1] please")).toBe(true);
  expect(namesItself(message("@claude", ...pastes))).toBe(true);
  expect(namesItself("@claude [Image #1] [Image #2]")).toBe(false);
});
