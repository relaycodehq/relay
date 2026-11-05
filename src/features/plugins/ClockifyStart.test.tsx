// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClockifyStart } from "./ClockifyStart";

const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const YESTERDAY_23 = new Date(2026, 9, 13, 23, 0).getTime();

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function type(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("won't take a typed start further back than the service allows", () => {
  const onSet = vi.fn();
  act(() =>
    root.render(
      <ClockifyStart
        start={YESTERDAY_23}
        latest={() => Date.now()}
        onPreview={() => {}}
        onSet={onSet}
        onEditing={() => {}}
      />,
    ),
  );
  act(() =>
    host
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  const input = host.querySelector("input")!;
  // Read on the start's day: yesterday 8:00, 26 hours back.
  type(input, "8:00");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(onSet).not.toHaveBeenCalled();
});
