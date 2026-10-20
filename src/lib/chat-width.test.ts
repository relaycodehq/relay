// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { settingsBridge } from "../../tests/unit/settings-file-bridge";

const css = () =>
  document.documentElement.style.getPropertyValue("--thread-width");

it("updates the reading column when settings.json changes or drops its width", async () => {
  localStorage.clear();
  vi.resetModules();
  const bridge = settingsBridge();
  const width = await import("./chat-width");
  width.initChatWidth();
  expect(css()).toBe("1040px");
  bridge.change({ chat: { width: 1400 } });
  expect(css()).toBe("1400px");
  bridge.change({ chat: { width: 99999 } });
  expect(css()).toBe("1600px");
  bridge.change({});
  expect(css()).toBe("1040px");
});

it("doesn't jump back to older values while its own saves are on their way", async () => {
  localStorage.clear();
  vi.resetModules();
  const bridge = settingsBridge();
  const width = await import("./chat-width");
  width.initChatWidth();
  bridge.hold();
  width.setChatWidth(1200);
  width.setChatWidth(1300);
  // Another window's view of the file from before the drag finished.
  bridge.change({ chat: { width: 1200 } });
  expect(css()).toBe("1300px");
  bridge.release();
  await vi.waitFor(() =>
    expect(bridge.file.values).toEqual({ chat: { width: 1300 } }),
  );
  expect(css()).toBe("1300px");
  expect(bridge.saves).toEqual([
    [{ path: ["chat", "width"], value: 1200 }],
    [{ path: ["chat", "width"], value: 1300 }],
  ]);
});
