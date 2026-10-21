// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePoll } from "./poll";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.restoreAllMocks();
});

it("polls as asked in front, four times slower behind another window, and leaves off alone", async () => {
  let focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  let poll!: ReturnType<typeof usePoll>;
  function Probe() {
    poll = usePoll();
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  expect(poll(3000)).toBe(3000);
  focused = false;
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(poll(3000)).toBe(12_000);
  expect(poll(false)).toBe(false);
  focused = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(poll(3000)).toBe(3000);
});
