import { shell } from "electron";
import { expect, it, vi } from "vitest";
import type { ApiContext } from "./context";
import { desktopHandlers } from "./desktop";

vi.mock("electron", () => ({
  app: {},
  clipboard: {},
  ClipboardItem: class {},
  nativeImage: {},
  nativeTheme: {},
  shell: { openExternal: vi.fn(async () => {}) },
}));

vi.mock("../app/menu", () => ({ setApplicationMenu: vi.fn() }));

function contents() {
  let zoom = 1;
  return {
    getZoomFactor: () => zoom,
    setZoomFactor: (next: number) => {
      zoom = next;
    },
  };
}

it("applies the interface size independently in each window and preserves manual zoom", () => {
  const main = contents();
  const thread = contents();
  let caller = main;
  const window = {
    interfaceScale: 1,
    caller: () => ({ webContents: caller }),
  };
  const handlers = desktopHandlers({ window } as unknown as ApiContext);
  const scale = 16 / 13;
  handlers.setInterfaceScale([scale]);
  caller = thread;
  handlers.setInterfaceScale([scale]);
  expect(main.getZoomFactor()).toBeCloseTo(scale);
  expect(thread.getZoomFactor()).toBeCloseTo(scale);

  main.setZoomFactor(scale * 1.5);
  caller = main;
  handlers.setInterfaceScale([11 / 13]);
  expect(main.getZoomFactor()).toBeCloseTo((11 / 13) * 1.5);
  expect(thread.getZoomFactor()).toBeCloseTo(scale);
  caller = thread;
  handlers.setInterfaceScale([11 / 13]);
  expect(thread.getZoomFactor()).toBeCloseTo(11 / 13);
  // Reinitializing after a renderer reload must not apply the scale twice.
  handlers.setInterfaceScale([11 / 13]);
  expect(thread.getZoomFactor()).toBeCloseTo(11 / 13);
});

it("opens web and mail links outside, and nothing else", async () => {
  const handlers = desktopHandlers({} as ApiContext);
  await handlers.openExternal(["mailto:someone@example.com"]);
  await handlers.openExternal(["https://example.com/"]);
  expect(shell.openExternal).toHaveBeenCalledWith("mailto:someone@example.com");
  expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/");
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://a:b@example.com/",
  ])
    await expect(handlers.openExternal([url])).rejects.toThrow(
      "Unsupported URL.",
    );
});
