// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { doubleShiftDetector, useDoubleShift } from "./useDoubleShift";

let clock = 0;
const key = (
  type: "keydown" | "keyup",
  init: KeyboardEventInit & { key: string },
) => new KeyboardEvent(type, init);
const tap = (
  d: ReturnType<typeof doubleShiftDetector>,
  gap: number,
  init: KeyboardEventInit = {},
) => {
  clock += gap;
  d.keydown(key("keydown", { key: "Shift", shiftKey: true, ...init }));
  d.keyup(key("keyup", { key: "Shift", shiftKey: false }));
};
const detect = () => {
  clock = 1000;
  const fire = vi.fn();
  return { fire, d: doubleShiftDetector(fire, () => clock) };
};

it("fires on two quick taps", () => {
  const { fire, d } = detect();
  tap(d, 0);
  tap(d, 200);
  expect(fire).toHaveBeenCalledTimes(1);
});

it("needs the second tap soon enough, and starts over after firing", () => {
  const { fire, d } = detect();
  tap(d, 0);
  tap(d, 500);
  expect(fire).not.toHaveBeenCalled();
  tap(d, 100);
  expect(fire).toHaveBeenCalledTimes(1);
  tap(d, 100);
  expect(fire).toHaveBeenCalledTimes(1);
});

it("ignores a key typed between the taps, so Shift+letter typing never fires", () => {
  const { fire, d } = detect();
  tap(d, 0);
  d.keydown(key("keydown", { key: "a" }));
  tap(d, 100);
  expect(fire).not.toHaveBeenCalled();
});

it("ignores a held Shift's repeats and another modifier", () => {
  const { fire, d } = detect();
  d.keydown(key("keydown", { key: "Shift", shiftKey: true }));
  d.keydown(key("keydown", { key: "Shift", shiftKey: true, repeat: true }));
  d.keyup(key("keyup", { key: "Shift" }));
  expect(fire).not.toHaveBeenCalled();
  tap(d, 50, { ctrlKey: true });
  tap(d, 50, { metaKey: true });
  expect(fire).not.toHaveBeenCalled();
});

it("needs a release between: both Shift keys pressed together is no double", () => {
  const { fire, d } = detect();
  clock += 0;
  d.keydown(key("keydown", { key: "Shift", shiftKey: true }));
  clock += 50;
  d.keydown(key("keydown", { key: "Shift", shiftKey: true }));
  expect(fire).not.toHaveBeenCalled();
});

it("ignores Shift while an input method is composing", () => {
  const { fire, d } = detect();
  tap(d, 0, { isComposing: true });
  tap(d, 100, { isComposing: true });
  expect(fire).not.toHaveBeenCalled();
});

it("forgets the first tap after a click", () => {
  const { fire, d } = detect();
  tap(d, 0);
  d.reset();
  tap(d, 100);
  expect(fire).not.toHaveBeenCalled();
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("listens on the window while enabled, in the capture phase", async () => {
  vi.useFakeTimers();
  const onDouble = vi.fn();
  function Probe({ on }: { on: boolean }) {
    useDoubleShift(onDouble, on);
    return null;
  }
  const press = () => {
    // An editor that stops the event on its own element must not hide it.
    const input = document.createElement("input");
    input.addEventListener("keydown", (e) => e.stopPropagation());
    host.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Shift",
        bubbles: true,
        shiftKey: true,
      }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Shift", bubbles: true }),
    );
    input.remove();
  };
  await act(async () => root.render(<Probe on />));
  press();
  vi.advanceTimersByTime(120);
  press();
  expect(onDouble).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe on={false} />));
  press();
  vi.advanceTimersByTime(120);
  press();
  expect(onDouble).toHaveBeenCalledTimes(1);
});
