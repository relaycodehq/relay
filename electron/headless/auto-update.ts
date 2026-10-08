import type { UpdateState } from "../../shared/updates";

/** What auto-updating needs of ./updater's HeadlessUpdater. */
export interface Updates {
  readonly now: UpdateState;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
}

export interface AutoUpdateHost {
  /** `relay settings`' auto-update, read afresh each time. */
  enabled(): Promise<boolean>;
  /** A thread is working or a handoff is on its way: the restart waits. */
  busy(): boolean;
}

const hour = 60 * 60_000;

/**
 * Keeps a headless Relay on the newest release: it looks every few hours,
 * as the desktop does, and with auto-update on downloads what's out and
 * installs it once nothing is working. Agents carry on through the restart
 * in the agent host, so a thread that keeps working past `waitAtMost`
 * doesn't hold the update back for good. With it off, the update is only
 * said: in the log, `relay status`, and the laptop's Settings → Computers.
 */
export function keepUpdated(
  updates: Updates,
  host: AutoUpdateHost,
  {
    firstAfter = 60_000,
    every = 4 * hour,
    waitAtMost = 6 * hour,
    poll = 5 * 60_000,
  } = {},
) {
  let running: Promise<void> | undefined;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref?.());
  const pass = async () => {
    const found = await updates.check();
    if (found.status !== "available" && found.status !== "ready") return;
    if (!(await host.enabled()))
      return console.log(
        `Relay ${found.version} is out; relay update installs it.`,
      );
    console.log(
      `Relay ${found.version} is out; installing it once no thread is working.`,
    );
    const ready = await updates.download();
    if (ready.status !== "ready")
      return console.warn(
        `Couldn't download Relay ${found.version}:`,
        ready.status === "error" ? ready.message : ready.status,
      );
    for (const since = Date.now(); host.busy();) {
      if (!(await host.enabled())) return;
      if (Date.now() - since > waitAtMost) break;
      await sleep(poll);
    }
    if (!(await host.enabled())) return;
    console.log(`Installing Relay ${ready.version}.`);
    const done = await updates.install();
    if (done.status === "error")
      console.warn(`Couldn't install Relay ${ready.version}:`, done.message);
  };
  /** One look now, unless one is already under way. */
  const run = () =>
    (running ??= pass()
      .catch((e) => console.warn("Checking for an update failed:", e))
      .finally(() => (running = undefined)));
  const first = setTimeout(() => void run(), firstAfter);
  const timer = setInterval(() => void run(), every);
  first.unref();
  timer.unref();
  return {
    run,
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
