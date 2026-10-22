import type { Store } from "./store";

export const PING_URL = "https://ping.relaycode.io/";
const checkEvery = 60 * 60 * 1000;
const firstAfter = 60 * 1000;
const timeout = 15_000;

export interface PingOptions {
  kind: "desktop" | "headless";
  version: string;
  /** False for builds from source and tests, which nobody else runs. */
  live: boolean;
  enabled: () => boolean;
  store: Pick<Store, "get" | "update">;
  send?: (body: string) => Promise<boolean>;
  now?: () => Date;
}

async function post(body: string) {
  const res = await fetch(PING_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeout),
  });
  return res.ok;
}

/**
 * Tells relaycode.io once a UTC day that a copy of Relay is in use, so the
 * day's pings count the people using it. The ping holds the version, the
 * platform and whether it's the desktop app or a headless one; no ID, so two
 * days of the same install can't be linked. Off with `usagePing: false` in
 * settings.json, or `DO_NOT_TRACK=1`.
 */
export class DailyPing {
  private timers: NodeJS.Timeout[] = [];
  private sending = false;
  constructor(private o: PingOptions) {}

  start() {
    if (!this.o.live || process.env.DO_NOT_TRACK === "1") return;
    this.timers.push(
      setTimeout(() => void this.tick(), firstAfter).unref(),
      setInterval(() => void this.tick(), checkEvery).unref(),
    );
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  async tick() {
    const day = (this.o.now?.() ?? new Date()).toISOString().slice(0, 10);
    if (this.sending || !this.o.enabled() || this.o.store.get().pingedOn === day)
      return;
    this.sending = true;
    try {
      const body = JSON.stringify({
        kind: this.o.kind,
        version: this.o.version,
        platform: `${process.platform}-${process.arch}`,
      });
      // Offline or refused, the next hour tries again.
      if (!(await (this.o.send ?? post)(body).catch(() => false))) return;
      await this.o.store.update((s) => {
        s.pingedOn = day;
      });
    } finally {
      this.sending = false;
    }
  }
}
