// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WrittenCode as Written } from "../../../../shared/projects";
import { WrittenCode } from "./WrittenCode";

const highlighted: string[] = [];

// Highlighting loads a grammar off the main thread; a line's token here is its text.
vi.mock("./CodeLines", () => ({
  useLines: (_path: string, code: string) => {
    highlighted.push(code);
    return code.split("\n").map((content) => [{ content }]);
  },
  Line: ({ gutter, tokens }: { gutter: string | number; tokens: { content: string }[] }) => (
    <div className="line">{`${gutter}${tokens.map((t) => t.content).join("")}`}</div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(file: Written) {
  const host = document.createElement("div");
  act(() => createRoot(host).render(<WrittenCode file={file} shownPath={file.path} />));
  const lines = [...host.querySelectorAll(".line")].map((line) => line.textContent);
  return { size: host.querySelector(".written-head")!.lastElementChild!.textContent, lines: lines.length, shown: lines };
}

it("doesn't count or draw the newline that ends a file as a line", () => {
  expect(render({ kind: "whole", path: "a.ts", content: "a\nb\n" })).toMatchObject({ size: "2 lines", lines: 2 });
  expect(render({ kind: "patch", path: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b\n" })).toMatchObject({ size: "+1 −1", lines: 2 });
  expect(render({ kind: "swap", path: "a.ts", edits: [{ old: "a\n", new: "b\n" }] })).toMatchObject({ size: "+1 −1", lines: 2 });
});

it("highlights a patch's old code and new code apart, without its hunk headers", () => {
  highlighted.length = 0;
  const diff = "@@ -1,2 +1,2 @@\n keep\n-old();\n+next();\n@@ -9 +9 @@\n-x\n+y";
  expect(render({ kind: "patch", path: "a.ts", diff }).shown).toEqual(["keep", "−old();", "+next();", "−x", "+y"]);
  expect(highlighted).toEqual(["keep\nold();\nx", "keep\nnext();\ny"]);
});

it("says why a file that may hold secrets shows nothing", () => {
  expect(render({ kind: "whole", path: ".env", content: "", cut: true, secret: true }).size).toBe("not kept, may hold secrets");
});
