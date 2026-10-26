// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { LspEdit } from "../../../shared/language-servers";
import { lsp } from "../language-servers/client";
import { formatWithServer } from "./lsp-format";

vi.mock("../language-servers/client", () => ({
  lsp: { change: vi.fn(async () => {}), format: vi.fn() },
}));

/** The server's answer for "let  a=1": one space after `let`, spaces around `=`. */
const formatted: LspEdit[] = [
  { line: 0, character: 3, endLine: 0, endCharacter: 5, newText: " " },
  { line: 0, character: 6, endLine: 0, endCharacter: 7, newText: " = " },
];

it("applies the server's edits to the text it was sent", async () => {
  const view = new EditorView({ doc: "let  a=1" });
  vi.mocked(lsp.format).mockResolvedValueOnce(formatted);
  await formatWithServer("w", "a.ts", view);
  expect(view.state.sliceDoc()).toBe("let a = 1");
});

it("leaves the text alone when it was edited while the server formatted it", async () => {
  const view = new EditorView({ doc: "let  a=1" });
  vi.mocked(lsp.format).mockImplementationOnce(async () => {
    view.dispatch({ changes: { from: 0, insert: "// x\n" } });
    return formatted;
  });
  await expect(formatWithServer("w", "a.ts", view)).rejects.toThrow(
    "changed while formatting",
  );
  expect(view.state.sliceDoc()).toBe("// x\nlet  a=1");
});
