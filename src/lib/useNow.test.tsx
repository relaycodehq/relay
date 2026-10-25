// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

afterEach(async () => {
  await act(async () => root?.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("stops ticking on blur, catches up on focus and honors disabled clocks", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  let now = 0;
  let renders = 0;
  function Probe({ enabled }: { enabled: boolean }) {
    now = useNow(1000, enabled);
    renders++;
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe enabled />));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(now).toBe(1000);
  focused = false;
  await act(async () => window.dispatchEvent(new Event("blur")));
  const before = renders;
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(renders).toBe(before);
  expect(now).toBe(1000);
  focused = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(now).toBe(11_000);
  await act(async () => root.render(<Probe enabled={false} />));
  await act(async () => vi.advanceTimersByTime(5000));
  expect(now).toBe(11_000);
  await act(async () => root.render(<Probe enabled />));
  expect(now).toBe(16_000);
});
