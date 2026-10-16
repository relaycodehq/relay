// Whether someone sits at this computer with Relay in reach, so phones keep
// their news to themselves: a Relay window was in front within the last half
// hour, and the keyboard or mouse moved within the last two minutes. Walking
// away, locking the screen or sleeping hands the news back to the phone.
import { app, BrowserWindow, powerMonitor, webContents } from "electron";
import type { WebContents } from "electron";

/** How long after Relay was last in front someone still counts as working in it. */
export const recentMs = 30 * 60_000;
/** Seconds without input after which nobody counts as at the computer. */
export const idleSeconds = 120;
/** Walking away shows in no event, so it's looked for this often. */
const checkMs = 15_000;

export type PresenceEvent =
  | "blur"
  | "lock"
  | "unlock"
  | "suspend"
  | "resume"
  /** A key, the mouse or focus in a Relay window; only asked for where idle is unknown. */
  | "input";

export interface PresenceSignals {
  focused(): boolean;
  idleState(seconds: number): "active" | "idle" | "locked" | "unknown";
  on(event: PresenceEvent, listener: () => void): void;
}

export class Presence {
  private leftAt = -Infinity;
  private asleep = false;
  private inputAt?: number;
  private listeners = new Set<() => void>();

  constructor(
    private signals: PresenceSignals = electronSignals(),
    private now = () => Date.now(),
  ) {
    signals.on("blur", () => (this.leftAt = this.now()));
    signals.on("lock", () => this.changed());
    // Told before the network goes, so a phone hears it while it still can.
    signals.on("suspend", () => {
      this.asleep = true;
      this.changed();
    });
    // Unlocking too, as a resume can go missing.
    const awake = () => {
      this.asleep = false;
      this.changed();
    };
    signals.on("resume", awake);
    signals.on("unlock", awake);
  }

  present() {
    if (this.asleep) return false;
    const idle = this.idle();
    if (!this.signals.focused())
      return idle === false && this.now() - this.leftAt < recentMs;
    if (idle !== undefined) return !idle;
    // The system can't tell, so Relay's own windows have to: a window left in
    // front mustn't keep the phone quiet all night.
    this.followInput();
    return this.now() - this.inputAt! < idleSeconds * 1000;
  }

  /** Calls `listener` whenever presence may have changed; it compares for itself. */
  watch(listener: () => void) {
    this.listeners.add(listener);
    const timer = setInterval(listener, checkMs);
    timer.unref();
    return () => {
      clearInterval(timer);
      this.listeners.delete(listener);
    };
  }

  private followInput() {
    if (this.inputAt !== undefined) return;
    this.inputAt = this.now();
    this.signals.on("input", () => (this.inputAt = this.now()));
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  /** Undefined where the system can't tell, as on some Linux desktops. */
  private idle() {
    const state = this.signals.idleState(idleSeconds);
    return state === "unknown" ? undefined : state !== "active";
  }
}

function electronSignals(): PresenceSignals {
  return {
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    idleState: (seconds) => powerMonitor.getSystemIdleState(seconds),
    on: (event, listener) => {
      if (event === "blur") app.on("browser-window-blur", listener);
      else if (event === "lock") powerMonitor.on("lock-screen", listener);
      else if (event === "unlock") powerMonitor.on("unlock-screen", listener);
      else if (event === "suspend") powerMonitor.on("suspend", listener);
      else if (event === "resume") powerMonitor.on("resume", listener);
      else {
        const follow = (contents: WebContents) => {
          contents.on("before-input-event", listener);
          contents.on("before-mouse-event", listener);
        };
        webContents.getAllWebContents().forEach(follow);
        app.on("web-contents-created", (_, contents) => follow(contents));
        app.on("browser-window-focus", listener);
      }
    },
  };
}
