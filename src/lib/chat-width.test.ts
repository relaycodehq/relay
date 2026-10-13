// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

it("updates the reading column when another window changes or resets its width", async () => {
  localStorage.clear();
  vi.resetModules();
  const width = await import("./chat-width");
  width.initChatWidth();
  const css = () =>
    document.documentElement.style.getPropertyValue("--thread-width");
  expect(css()).toBe("1040px");
  localStorage.setItem("relay-chat-width", "1400");
  const change = () =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "relay-chat-width",
        storageArea: localStorage,
      }),
    );
  change();
  expect(css()).toBe("1400px");
  localStorage.removeItem("relay-chat-width");
  change();
  expect(css()).toBe("1040px");
});
