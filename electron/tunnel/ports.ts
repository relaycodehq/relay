import type { RemoteSite } from "../../shared/remote-tunnel";

/** How long one look at Sites answers for; a port missing from it looks again sooner. */
const freshMs = 15_000;
const recheckMs = 2_000;

/**
 * Which ports a phone's tunnel may reach: the ones Sites lists and the ones
 * typed into that phone's address bar. Typed ports last while this Relay
 * runs; the phone says them again when it opens one.
 */
export class TunnelPorts {
  private typed = new Map<string, Set<number>>();
  private looked?: { at: number; ports: Set<number> };
  private looking?: Promise<Set<number>>;

  constructor(
    private sites: () => Promise<RemoteSite[]>,
    private now: () => number = Date.now,
  ) {}

  type(deviceId: string, port: number) {
    const ports = this.typed.get(deviceId) ?? new Set<number>();
    ports.add(port);
    this.typed.set(deviceId, ports);
  }

  async allowed(deviceId: string, port: number) {
    if (this.typed.get(deviceId)?.has(port)) return true;
    const age = this.looked ? this.now() - this.looked.at : Infinity;
    if (age < freshMs && this.looked!.ports.has(port)) return true;
    // A server started since the last look counts.
    if (age < recheckMs) return false;
    return (await this.look()).has(port);
  }

  private look() {
    this.looking ??= this.sites()
      .then((sites) => {
        const ports = new Set(sites.map((s) => s.port));
        this.looked = { at: this.now(), ports };
        return ports;
      })
      .finally(() => (this.looking = undefined));
    return this.looking;
  }
}
