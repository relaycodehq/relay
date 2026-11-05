// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SketchEditor } from "./ImageSketch";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

afterEach(() => unmount?.());

it("still closes when the screenshot can't be decoded", () => {
  const host = document.createElement("div");
  document.body.append(host);
  // The browser never decodes it, so no load reaches the editor.
  host.addEventListener("load", (event) => event.stopPropagation(), true);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  const onClose = vi.fn();
  const history = { past: [], present: [], future: [] };
  act(() =>
    root.render(
      <SketchEditor
        image={{
          id: "shot",
          name: "Broken.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,bm90IGEgcG5n",
        }}
        history={history}
        onClose={onClose}
      />,
    ),
  );
  act(() => host.querySelector("img")!.dispatchEvent(new Event("error")));

  act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Done"]')!.click(),
  );

  expect(onClose).toHaveBeenCalledWith(history, { width: 0, height: 0 });
});
