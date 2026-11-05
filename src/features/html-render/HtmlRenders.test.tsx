// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({ api: {} }));
vi.mock("../../lib/window-focus", () => ({ useWindowFocused: () => true }));
import { HtmlRenders } from "./HtmlRenders";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let resized: (width: number) => void;
let unmount: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly told: ResizeObserverCallback) {}

      observe() {
        resized = (width) =>
          this.told(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }

      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly told: IntersectionObserverCallback) {}

      observe() {
        this.told(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }

      disconnect() {}
    },
  );
});

afterEach(() => {
  unmount?.();
  vi.unstubAllGlobals();
});

it("keeps the height a loaded page reported when the thread narrows and the page's height stays", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  act(() =>
    root.render(
      <HtmlRenders
        chatId="chat"
        renders={[{ id: "r", title: "Chart", pages: [{}], created: 0 }]}
      />,
    ),
  );
  act(() => resized(600));
  const frame = host.querySelector("iframe")!;
  const box = host.querySelector<HTMLElement>(".html-render-frame")!;
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { relayRender: "size", height: 500 },
        source: frame.contentWindow,
      }),
    ),
  );
  expect(box.style.height).toBe("500px");

  // The page reports only a height that changed, so a narrower thread hears nothing.
  act(() => resized(590));

  expect(box.style.height).toBe("500px");
});
