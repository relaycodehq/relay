import { BrowserWindow } from "electron";
import { join } from "node:path";
import type { ProjectChatEvent, ProjectChatsEvent } from "../../shared/events";
import { pickSound, SoundCues } from "../../shared/sound-cues";
import { customFileId } from "../../shared/sounds";
import type { Store } from "../app/store";
import { loadPage } from "../app/page";
import { CustomSounds } from ".";

/** How long the hidden player lingers after a sound, for the next one to come quickly. */
const lingerMs = 30_000;

/**
 * Thread sounds while Relay sits in the menubar with its window closed: the
 * window's own player is gone with it, so a hidden one opens for the sound
 * and closes again once things are quiet. Threads' own windows play nothing,
 * so they count as closed here. Headless Relay has no menubar and plays
 * nothing.
 */
export class MenubarSounds {
  private cues: SoundCues;
  private custom: CustomSounds;
  private player: { win: BrowserWindow; loaded: Promise<void> } | undefined;
  private linger: ReturnType<typeof setTimeout> | undefined;

  /** `hears` says whether a thread's sounds are this player's to play. */
  constructor(
    private store: Store,
    hears: (chatId: string) => boolean,
  ) {
    this.custom = new CustomSounds(store);
    this.cues = new SoundCues({
      hears,
      play: (cues) => this.play(cues),
    });
  }

  chatEvent(event: ProjectChatEvent) {
    this.cues.message(event.chatId, event.message);
  }

  chatsEvent(event: ProjectChatsEvent) {
    this.cues.list(event.projectId, event.chats);
  }

  dispose() {
    clearTimeout(this.linger);
    this.player?.win.destroy();
    this.player = undefined;
  }

  private async play(cues: Parameters<typeof pickSound>[0]) {
    const state = this.store.get();
    const pick = pickSound(
      cues,
      state.sounds ?? {},
      (id) => state.projects?.find((p) => p.id === id)?.settings?.sounds,
    );
    if (!pick) return false;
    const fileId = customFileId(pick.sound);
    const bytes = fileId ? await this.custom.bytes(fileId) : undefined;
    const { win, loaded } = this.open();
    await loaded;
    if (win.isDestroyed()) return false;
    win.webContents.send("relay:play-sound", { ...pick, bytes });
    clearTimeout(this.linger);
    this.linger = setTimeout(() => this.dispose(), lingerMs);
    return true;
  }

  private open() {
    if (this.player && !this.player.win.isDestroyed()) return this.player;
    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Hidden pages are throttled; a sound waits on nothing.
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.on("closed", () => {
      if (this.player?.win === win) this.player = undefined;
    });
    this.player = { win, loaded: loadPage(win, "sounds") };
    return this.player;
  }
}
