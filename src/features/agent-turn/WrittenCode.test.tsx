// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WrittenCode as Written } from "../../../shared/projects";
import { WrittenCode } from "./WrittenCode";

// Highlighting loads a grammar off the main thread; the rows only need the lines there.
vi.mock("./CodeLines", () => ({
  useLines: (_path: string, code: string) => code.split("\n").map(() => []),
  Line: ({ gutter }: { gutter: string | number }) => <div className="line">{gutter}</div>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(file: Written) {
  const host = document.createElement("div");
  act(() => createRoot(host).render(<WrittenCode file={file} shownPath={file.path} />));
  return { size: host.querySelector(".written-head")!.lastElementChild!.textContent, lines: host.querySelectorAll(".line").length };
}

it("doesn't count or draw the newline that ends a file as a line", () => {
  expect(render({ kind: "whole", path: "a.ts", content: "a\nb\n" })).toEqual({ size: "2 lines", lines: 2 });
  expect(render({ kind: "patch", path: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b\n" })).toEqual({ size: "+1 −1", lines: 2 });
  expect(render({ kind: "swap", path: "a.ts", edits: [{ old: "a\n", new: "b\n" }] })).toEqual({ size: "+1 −1", lines: 2 });
});

it("says why a file that may hold secrets shows nothing", () => {
  expect(render({ kind: "whole", path: ".env", content: "", cut: true, secret: true }).size).toBe("not kept, may hold secrets");
});
