import { ipcMain, type WebContents } from "electron";
import { ChatPushSender } from "../../shared/chat-pushes";
import type { ProjectChatEvent } from "../../shared/events";
import type { AppWindow } from "./window";

/**
 * Pushes a thread's messages to every Relay window, a streaming answer as a
 * patch on what that window last got (shared/chat-pushes). A page that starts
 * listening, or lost track, asks for whole copies again.
 */
export function serveChatPushes(window: AppWindow) {
  const sender = new ChatPushSender<WebContents>(structuredClone);
  ipcMain.on("relay:project-chat-resync", (event) => {
    if (window.trusts(event)) sender.resync(event.sender);
  });
  return (event: ProjectChatEvent) => {
    const pages = window
      .all()
      .filter((win) => !win.isDestroyed())
      .map((win) => win.webContents);
    for (const [page, push] of sender.pushes(event, pages))
      page.send("relay:project-chat", push);
  };
}
