import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";
import {
  accelerator,
  command,
  type MenuShortcutId,
} from "../../shared/shortcuts";
import type { AppWindow } from "./window";

/** Accelerators the user picked in Settings; the rest keep their defaults. */
export type MenuAccelerators = Partial<Record<MenuShortcutId, string[]>>;

export function setApplicationMenu(
  window: AppWindow,
  custom: MenuAccelerators = {},
) {
  const mac = process.platform === "darwin";
  const contents = () => window.win?.webContents;
  // Roles would bring back their default keys when a shortcut is cleared, so
  // these do the work themselves.
  const view = (
    id: MenuShortcutId,
    item: MenuItemConstructorOptions,
  ): MenuItemConstructorOptions[] => {
    const [first, ...more] =
      custom[id] ??
      command(id)
        .defaults(mac)
        .map((c) => accelerator(c, mac))
        .filter((a): a is string => !!a);
    return [
      { ...item, accelerator: first },
      // A second or third key works through an item nobody sees.
      ...more.map((accelerator) => ({
        ...item,
        accelerator,
        visible: false,
        acceleratorWorksWhenHidden: true,
      })),
    ];
  };
  const zoom = (by: number) => {
    const c = contents();
    c?.setZoomLevel(c.getZoomLevel() + by);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Relay",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          ...view("reload", {
            label: "Reload",
            click: () => contents()?.reload(),
          }),
          ...view("devtools", {
            label: "Toggle Developer Tools",
            click: () => contents()?.toggleDevTools(),
          }),
          { type: "separator" },
          // Back to the interface size from Settings, not to 100%.
          ...view("actual-size", {
            label: "Actual Size",
            click: () => contents()?.setZoomFactor(window.interfaceScale),
          }),
          ...view("zoom-in", { label: "Zoom In", click: () => zoom(0.5) }),
          ...view("zoom-out", { label: "Zoom Out", click: () => zoom(-0.5) }),
          { type: "separator" },
          ...view("fullscreen", {
            label: "Toggle Full Screen",
            click: () => window.win?.setFullScreen(!window.win.isFullScreen()),
          }),
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Show Logs",
            click: () => void shell.openPath(app.getPath("logs")),
          },
        ],
      },
    ]),
  );
}
