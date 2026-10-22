import {
  app,
  clipboard,
  ClipboardItem,
  nativeImage,
  nativeTheme,
  shell,
  type WebContents,
} from "electron";
import { z } from "zod";
import { fetchThemes, searchThemes } from "../../shared/open-vsx";
import { textSchema } from "../../shared/validation";
import { menuAcceleratorsSchema } from "../../shared/shortcuts";
import { setApplicationMenu } from "../app/menu";
import { takes, type ApiContext, type Handlers } from "./context";

/** The window and the OS around it: chrome, zoom, badge, clipboard, links. */
export function desktopHandlers(ctx: ApiContext) {
  const { window, menubar, store } = ctx;
  const interfaceScales = new WeakMap<WebContents, number>();
  return {
    applyAppearance: takes(
      [
        z
          .object({
            mode: z.enum(["system", "light", "dark"]),
            background: z.string().regex(/^#[0-9a-f]{6}$/i),
            glass: z.boolean(),
            icon: z
              .string()
              .max(2_000_000)
              .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
          })
          .strict(),
      ],
      (appearance) => {
        // Native chrome (vibrancy, menus, scrollbars) follows the theme's mode.
        // Pinning a resolved kind in system mode would also pin the renderer's
        // prefers-color-scheme, so it could never see the OS go dark again.
        nativeTheme.themeSource = appearance.mode;
        const icon = nativeImage.createFromDataURL(appearance.icon);
        if (!icon.isEmpty() && process.platform === "darwin")
          app.dock?.setIcon(icon);
        // Remembered, so the next windows, and the next launch, start clear.
        window.clear = appearance.glass;
        if ((store.get().glass !== false) !== appearance.glass)
          void store
            .update((s) => {
              s.glass = appearance.glass;
            })
            .catch((e) => console.warn("Could not save frosted glass:", e));
        for (const win of window.all()) {
          // A clear window lets its macOS vibrancy show through the page.
          win.setBackgroundColor(
            appearance.glass && process.platform === "darwin"
              ? "#00000000"
              : appearance.background,
          );
          if (!icon.isEmpty() && process.platform !== "darwin")
            win.setIcon(icon);
        }
      },
    ),
    tintTitleBar: takes(
      [
        z
          .object({
            color: z.string().regex(/^#[0-9a-f]{6}$/i),
            symbolColor: z.string().regex(/^#[0-9a-f]{6}$/i),
          })
          .strict(),
      ],
      (colors) => {
        // Only Linux uses the native overlay for its window controls.
        if (process.platform === "linux")
          window.caller()?.setTitleBarOverlay(colors);
      },
    ),
    setInterfaceScale: takes([z.number().min(0.5).max(2)], (scale) => {
      const contents = window.caller()?.webContents;
      if (!contents) return;
      // Keep whatever ⌘+ and ⌘− added on top of the old size. A fresh page
      // starts from 1: Chromium restores the last session's zoom, which
      // already has the scale in it and would compound on every launch.
      const previous = interfaceScales.get(contents);
      const own = previous ? contents.getZoomFactor() / previous : 1;
      interfaceScales.set(contents, scale);
      window.interfaceScale = scale;
      contents.setZoomFactor(own * scale);
    }),
    setMenuShortcuts: takes([menuAcceleratorsSchema], (menu) => {
      setApplicationMenu(window, menu);
    }),
    ignoreMenuShortcuts: takes([z.boolean()], (ignore) => {
      window.caller()?.webContents.setIgnoreMenuShortcuts(ignore);
    }),
    searchThemes: takes(
      [z.string().max(200), z.number().int().min(0).max(100_000).optional()],
      (query, offset) => searchThemes(query, offset),
    ),
    fetchThemes: takes(
      [
        z.object({
          namespace: z.string(),
          name: z.string(),
          version: z.string(),
        }),
      ],
      (extension) => fetchThemes(extension),
    ),
    setBadge: takes([z.number().int().min(0).max(9999)], (count) => {
      menubar.setWaiting(count);
      window.setBadge(count);
    }),
    windowControl: takes(
      [z.enum(["minimize", "toggleMaximize", "close"])],
      (action) => {
        const win = window.caller();
        if (action === "minimize") win?.minimize();
        else if (action === "close") win?.close();
        else if (win?.isMaximized()) win.unmaximize();
        else win?.maximize();
      },
    ),
    isMaximized: () => window.caller()?.isMaximized() ?? false,
    setSidebarShown: takes([z.boolean(), z.boolean()], (shown, toggled) =>
      window.fitSidebar(shown, toggled),
    ),
    // With `html`, apps that take it get that instead: a message's screenshots ride along in it.
    writeClipboard: takes(
      [
        textSchema,
        z
          .string()
          .max(64 * 1024 * 1024)
          .optional(),
      ],
      async (text, html) => {
        await (html
          ? clipboard.write([
              new ClipboardItem({ "text/plain": text, "text/html": html }),
            ])
          : clipboard.writeText(text));
      },
    ),
    writeClipboardImage: takes(
      [
        z
          .string()
          .max(64 * 1024 * 1024)
          .startsWith("data:image/"),
      ],
      async (dataUrl) => {
        const image = nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) throw new Error("Couldn't read that image.");
        const png = new Blob([new Uint8Array(image.toPNG())]);
        await clipboard.write([new ClipboardItem({ "image/png": png })]);
      },
    ),
    readClipboard: () => clipboard.readText(),
    openExternal: takes([z.string().max(4096)], async (url) => {
      const u = new URL(url);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Unsupported URL.");
      await shell.openExternal(u.href);
    }),
  } satisfies Handlers;
}
