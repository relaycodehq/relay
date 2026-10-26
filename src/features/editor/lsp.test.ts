// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";

vi.mock("../language-servers/client", () => ({ lsp: {} }));
const { lspFeatures } = await import("./lsp");

describe("lspFeatures", () => {
  it("offers the same completion source every time it's asked", () => {
    // A new source per ask makes autocompletion restart its query on every update, forever.
    const state = EditorState.create({ doc: "int main() {}", extensions: lspFeatures("w", "main.cpp", () => {}) });
    const sources = () =>
      state.languageDataAt<unknown>("autocomplete", 0).concat(state.languageDataAt<unknown>("autocomplete", 5));
    const [first, second] = sources();
    expect(first).toBeTypeOf("function");
    expect(second).toBe(first);
  });
});
