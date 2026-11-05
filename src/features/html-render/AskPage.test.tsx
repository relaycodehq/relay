// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({ api: {} }));
vi.mock("../../lib/window-focus", () => ({ useWindowFocused: () => false }));
import { AskPage } from "./AskPage";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

afterEach(() => unmount?.());

it("pauses a page that loads while the window is unfocused", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  unmount = () => act(() => root.unmount());
  act(() =>
    root.render(
      <AskPage
        chatId="chat"
        page={{ id: "page", title: "Pick one", pages: [{}], created: 0 }}
        busy={false}
        onAnswer={() => {}}
      />,
    ),
  );
  const frame = host.querySelector("iframe")!;
  // The page loads after mounting; what was posted before went to the blank document.
  const post = vi.fn();
  Object.defineProperty(frame, "contentWindow", {
    value: { postMessage: post },
  });
  act(() => frame.dispatchEvent(new Event("load")));

  expect(post).toHaveBeenCalledWith(
    { relayRender: "pause", paused: true },
    "*",
  );
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ relayRender: "theme" }),
    "*",
  );
});
