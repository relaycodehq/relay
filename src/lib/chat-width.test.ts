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

it("saves where a drag stops, and doesn't jump back to older values meanwhile", async () => {
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
  expect(bridge.saves).toEqual([[{ path: ["chat", "width"], value: 1300 }]]);
});

it("keeps a width saved before the file while the file can't take it", async () => {
  localStorage.clear();
  localStorage.setItem("relay-chat-width", "1300");
  vi.resetModules();
  const bridge = settingsBridge();
  bridge.refuse("settings.json has an error on line 2");
  const width = await import("./chat-width");
  width.initChatWidth();
  const file = await import("./settings-file");
  // The failed save hands the window the file's view, which says nothing of it.
  await vi.waitFor(() => expect(file.settingsSaveError()).toMatch(/line 2/));
  expect(css()).toBe("1300px");
  expect(localStorage.getItem("relay-chat-width")).toBe("1300");
});
