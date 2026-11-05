// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const typeset: string[] = [];

vi.mock("katex", async (importOriginal) => {
  const katex = (await importOriginal<typeof import("katex")>()).default;
  return {
    default: {
      ...katex,
      renderToString: (...args: Parameters<typeof katex.renderToString>) => {
        typeset.push(args[0]);
        return katex.renderToString(...args);
      },
    },
  };
});

vi.mock("katex/dist/katex.min.css", () => ({}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import { BlockMath, InlineMath } from "./MathView";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tex: string) {
  const element = document.createElement("div");
  const root = createRoot(element);
  act(() =>
    root.render(
      <>
        <InlineMath tex={tex} />
        <BlockMath tex={tex} closed />
      </>,
    ),
  );
  const shown = () => element.querySelectorAll(".katex").length;
  return { shown, unmount: () => act(() => root.unmount()) };
}

it("lays a formula out once, however often its thread is opened", async () => {
  const tex = "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}";
  const first = mount(tex);
  await vi.waitFor(() => expect(first.shown()).toBe(2));
  first.unmount();

  const again = mount(tex);
  expect(again.shown()).toBe(2);
  again.unmount();
  expect(typeset.filter((formula) => formula === tex)).toHaveLength(2);
});
