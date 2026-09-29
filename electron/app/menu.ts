import { Menu } from "electron";
import type { AppWindow } from "./window";

export function setApplicationMenu(window: AppWindow) {
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
          // Cmd/Ctrl R belongs to Replace in the local code editor.
          { role: "reload", accelerator: "CmdOrCtrl+Shift+R" },
          { role: "toggleDevTools" },
          { type: "separator" },
          {
            // Back to the interface size from Settings, not to 100%.
            label: "Actual Size",
            accelerator: "CmdOrCtrl+0",
            click: () =>
              window.win?.webContents.setZoomFactor(window.interfaceScale),
          },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}
