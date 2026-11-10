// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { ProjectSearchFile } from "../../../shared/project-search";
import { useResultTree, type ResultTree } from "./useResultTree";

const file = (path: string): ProjectSearchFile => ({
  path,
  version: "v",
  matches: [{ line: 1, column: 0, length: 1, preview: "a", previewStart: 0 }],
});

it("scrolls back to the top for new results, not for a fold", () => {
  let tree: ResultTree | undefined;
  const scroller = document.createElement("div");
  function Probe({ files }: { files: ProjectSearchFile[] }) {
    tree = useResultTree(files);
    tree.scroller.current = scroller;
    return null;
  }
  const first = [file("a.ts"), file("b.ts")];
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe files={first} />));

  scroller.scrollTop = 300;
  act(() => tree!.fold("a.ts", true));
  expect(scroller.scrollTop).toBe(300);

  act(() => root.render(<Probe files={[file("c.ts")]} />));
  expect(scroller.scrollTop).toBe(0);
  act(() => root.unmount());
});
