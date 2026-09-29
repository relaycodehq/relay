import {
  app,
  clipboard,
  ClipboardItem,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";
import { z } from "zod";
import { fetchThemes, searchThemes } from "../../shared/open-vsx";
import { textSchema } from "../../shared/validation";
import type { ApiContext, Handlers } from "./context";

/** The window and the OS around it: chrome, zoom, badge, clipboard, links. */
export function desktopHandlers(ctx: ApiContext) {
  const { window, menubar } = ctx;
  return {
    applyAppearance: (args) => {
      const appearance = z
        .object({
          mode: z.enum(["system", "light", "dark"]),
          background: z.string().regex(/^#[0-9a-f]{6}$/i),
          titlebar: z.string().regex(/^#[0-9a-f]{6}$/i),
          titlebarText: z.string().regex(/^#[0-9a-f]{6}$/i),
          icon: z
            .string()
            .max(2_000_000)
            .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict()
        .parse(args[0]);
      const win = window.win;
      // Native chrome (vibrancy, menus, scrollbars) follows the theme's mode.
      // Pinning a resolved kind in system mode would also pin the renderer's
      // prefers-color-scheme, so it could never see the OS go dark again.
      nativeTheme.themeSource = appearance.mode;
      win?.setBackgroundColor(appearance.background);
      // The window controls sit on the titlebar, so they wear its colours.
      if (process.platform === "linux")
        win?.setTitleBarOverlay({
          color: appearance.titlebar,
          symbolColor: appearance.titlebarText,
        });
      const icon = nativeImage.createFromDataURL(appearance.icon);
      if (!icon.isEmpty()) {
        if (process.platform === "darwin") app.dock?.setIcon(icon);
        else win?.setIcon(icon);
      }
    },
    setInterfaceScale: (args) => {
      const scale = z.number().min(0.5).max(2).parse(args[0]);
      const contents = window.win?.webContents;
      if (!contents) return;
      // Keep whatever ⌘+ and ⌘− added on top of the old size.
      const own = contents.getZoomFactor() / window.interfaceScale;
      window.interfaceScale = scale;
      contents.setZoomFactor(own * scale);
    },
    searchThemes: (args) =>
      searchThemes(
        z.string().max(200).parse(args[0]),
        z.number().int().min(0).max(100_000).optional().parse(args[1]),
      ),
    fetchThemes: (args) =>
      fetchThemes(
        z
          .object({
            namespace: z.string(),
            name: z.string(),
            version: z.string(),
          })
          .parse(args[0]),
      ),
    setBadge: (args) => {
      const count = z.number().int().min(0).max(9999).parse(args[0]);
      menubar.setWaiting(count);
      window.setBadge(count);
    },
    windowControl: (args) => {
      const action = z
        .enum(["minimize", "toggleMaximize", "close"])
        .parse(args[0]);
      const win = window.win;
      if (action === "minimize") win?.minimize();
      else if (action === "close") win?.close();
      else if (win?.isMaximized()) win.unmaximize();
      else win?.maximize();
    },
    isMaximized: () => window.win?.isMaximized() ?? false,
    writeClipboard: async (args) => {
      await clipboard.writeText(textSchema.parse(args[0]));
    },
    writeClipboardImage: async (args) => {
      const image = nativeImage.createFromDataURL(
        z
          .string()
          .max(64 * 1024 * 1024)
          .startsWith("data:image/")
          .parse(args[0]),
      );
      if (image.isEmpty()) throw new Error("Couldn't read that image.");
      const png = new Blob([new Uint8Array(image.toPNG())]);
      await clipboard.write([new ClipboardItem({ "image/png": png })]);
    },
    readClipboard: () => clipboard.readText(),
    openExternal: async (args) => {
      const u = new URL(z.string().max(4096).parse(args[0]));
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Unsupported URL.");
      await shell.openExternal(u.href);
    },
  } satisfies Handlers;
}
