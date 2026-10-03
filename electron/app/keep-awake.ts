// A sleeping computer drops off Tailscale, and a phone can't wake it again, so
// Relay keeps it from idling to sleep: always while plugged in, and on battery
// while it has work going or a paired device may call. The screen still turns
// off and locks; closing the lid still sleeps it.
import { powerMonitor, powerSaveBlocker } from "electron";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

/** Below this, on battery, the computer may sleep, so a forgotten one doesn't run flat. */
export const batteryFloor = 20;
const batteryEvery = 2 * 60_000;

export interface Power {
  hold(): number;
  release(id: number): void;
  onBattery(): boolean;
  /** Percent left, or undefined where Relay can't read it. */
  batteryLevel(): Promise<number | undefined>;
}

export class KeepAwake {
  private held?: number;
  private level?: { percent: number | undefined; at: number };
  private checking = Promise.resolve();

  constructor(
    private wants: {
      /** The user's setting. */
      enabled: () => boolean;
      /** Work going, or a paired device that may call: worth battery. */
      busy: () => boolean;
    },
    private power: Power = electronPower(),
    private now = () => Date.now(),
  ) {}

  refresh() {
    this.checking = this.checking.then(async () => {
      const keep =
        this.wants.enabled() &&
        (!this.power.onBattery() ||
          (this.wants.busy() && !(await this.flat())));
      if (keep && this.held === undefined) this.held = this.power.hold();
      if (!keep && this.held !== undefined) {
        this.power.release(this.held);
        this.held = undefined;
      }
    });
    return this.checking;
  }

  dispose() {
    if (this.held !== undefined) this.power.release(this.held);
    this.held = undefined;
  }

  private async flat() {
    if (!this.level || this.now() - this.level.at > batteryEvery)
      this.level = {
        percent: await this.power.batteryLevel().catch(() => undefined),
        at: this.now(),
      };
    return (
      this.level.percent !== undefined && this.level.percent < batteryFloor
    );
  }
}

const run = promisify(execFile);

function electronPower(): Power {
  return {
    // On macOS an assertion against idle sleep alone, as `caffeinate -i` takes.
    hold: () => powerSaveBlocker.start("prevent-app-suspension"),
    release: (id) => powerSaveBlocker.stop(id),
    onBattery: () => powerMonitor.isOnBatteryPower(),
    batteryLevel,
  };
}

async function batteryLevel(): Promise<number | undefined> {
  if (process.platform === "darwin") {
    const { stdout } = await run("/usr/bin/pmset", ["-g", "batt"]);
    return percent(stdout.match(/(\d+)%/)?.[1]);
  }
  if (process.platform === "linux") {
    const dir = "/sys/class/power_supply";
    const battery = (await readdir(dir)).find((name) => name.startsWith("BAT"));
    if (battery)
      return percent(await readFile(`${dir}/${battery}/capacity`, "utf8"));
  }
  return undefined;
}

function percent(text: string | undefined) {
  const value = Number(text?.trim());
  return text && Number.isFinite(value) ? value : undefined;
}
