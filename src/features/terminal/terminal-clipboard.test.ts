import { expect, it, vi } from "vitest";
import { pasteDecision, pasteText } from "./terminal-clipboard";

vi.mock("../../lib/api", () => ({ api: {} }));

it("drops the line break a single copied command ends with", () => {
  expect(pasteText("ssh host 'ls'\n")).toBe("ssh host 'ls'");
  expect(pasteText("ssh host 'ls'\r\n\n")).toBe("ssh host 'ls'");
});

it("keeps several lines as they were copied", () => {
  expect(pasteText("cd /tmp\nls\n")).toBe("cd /tmp\nls\n");
});

it("asks before several lines go to a program without bracketed paste", () => {
  expect(pasteDecision("cd /tmp\nls\n", false)).toEqual({
    hold: true,
    text: "cd /tmp\nls\n",
    lines: 2,
  });
  expect(pasteDecision("a\r\nb\r\nc", false)).toMatchObject({
    hold: true,
    lines: 3,
  });
});

it("pastes at once when it is one line, or the program takes bracketed paste", () => {
  expect(pasteDecision("ls -la\n", false)).toEqual({
    hold: false,
    text: "ls -la",
  });
  expect(pasteDecision("cd /tmp\nls\n", true)).toEqual({
    hold: false,
    text: "cd /tmp\nls\n",
  });
});
