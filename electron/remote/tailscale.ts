import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { z } from "zod";
import type { PhoneTailnet } from "../../shared/remote";
import { findExecutable } from "../platform/executables";

/**
 * Finds this computer on Tailscale. Phone access listens only on the tailnet
 * address, so a phone has to be on the same tailnet to reach Relay at all.
 */
export type TailnetProbe = (detail?: boolean) => Promise<PhoneTailnet>;

// Tailscale hands out IPv4 from the shared CGNAT block, which carriers use too;
// its IPv6 prefix is its own, so an interface carrying one is Tailscale's.
const cgnat = (ip: string) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
};
const tailscaleV6 = (ip: string) =>
  ip.toLowerCase().startsWith("fd7a:115c:a1e0:");

/** A connection that came over the tailnet, or from this computer itself. */
export function tailnetPeer(address: string | undefined) {
  if (!address) return false;
  const ip = address.replace(/^::ffff:/i, "");
  return cgnat(ip) || tailscaleV6(ip) || ip === "127.0.0.1" || ip === "::1";
}

/** The IPv4 addresses of this computer's Tailscale interface. */
export function tailnetAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const found = Object.entries(interfaces).flatMap(([name, infos = []]) =>
    /tailscale/i.test(name) || infos.some((i) => tailscaleV6(i.address))
      ? infos
          .filter((i) => i.family === "IPv4" && cgnat(i.address))
          .map((i) => i.address)
      : [],
  );
  return [...new Set(found)];
}

const peerSchema = z.object({
  HostName: z.string(),
  OS: z.string(),
  Online: z.boolean().optional(),
});
const statusSchema = z.object({
  BackendState: z.string(),
  Self: peerSchema
    .extend({ TailscaleIPs: z.array(z.string()).nullish() })
    .nullish(),
  Peer: z.record(z.string(), peerSchema).nullish(),
});

/** `tailscale status --json`, as Settings shows it. */
export function readTailscaleStatus(json: string): PhoneTailnet {
  const status = statusSchema.parse(JSON.parse(json));
  if (status.BackendState !== "Running")
    return { status: "stopped", addresses: [] };
  const phones = Object.values(status.Peer ?? {})
    .filter((p) => p.OS === "android" || p.OS === "iOS")
    .map((p) => ({ name: p.HostName, online: !!p.Online }))
    .sort((a, b) => Number(b.online) - Number(a.online));
  return {
    status: "connected",
    addresses: (status.Self?.TailscaleIPs ?? []).filter(cgnat),
    ...(status.Self?.HostName ? { name: status.Self.HostName } : {}),
    phones,
  };
}

// Where Tailscale's installers put the CLI when no PATH has it, like the
// macOS app's, which lives inside its bundle.
const cliPaths: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
  ],
  linux: [
    "/usr/bin/tailscale",
    "/usr/sbin/tailscale",
    "/usr/local/bin/tailscale",
  ],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
};

function cliStatus(cli: string) {
  return new Promise<string>((resolve, reject) =>
    execFile(
      cli,
      ["status", "--json"],
      { timeout: 3000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      // A stopped Tailscale exits non-zero but still prints its state.
      (error, stdout) => (stdout ? resolve(stdout) : reject(error)),
    ),
  );
}

/** The `tailscale` the user's shell runs first, else where its installers put it. */
const findCli = () =>
  findExecutable("tailscale").catch(() =>
    (cliPaths[process.platform] ?? []).find((p) => existsSync(p)),
  );

async function probe(): Promise<PhoneTailnet> {
  const cli = await findCli();
  if (cli)
    try {
      const status = readTailscaleStatus(await cliStatus(cli));
      if (status.status !== "connected" || status.addresses.length)
        return status;
    } catch {
      // An older or locked-down CLI: the interfaces still tell whether it's on.
    }
  const addresses = tailnetAddresses(networkInterfaces());
  if (addresses.length) return { status: "connected", addresses };
  return { status: cli ? "stopped" : "missing", addresses: [] };
}

/**
 * Without `detail` the interfaces answer alone, which is cheap enough to watch
 * with; Settings asks for the CLI's names and phones too, one probe serving a
 * few seconds of its polling. RELAY_REMOTE_TAILNET stands in addresses
 * instead, e.g. 127.0.0.1 for tests and the Android emulator, which reaches
 * this computer through its loopback.
 */
export function tailnetProbe(
  env: NodeJS.ProcessEnv = process.env,
): TailnetProbe {
  const fixed = env.RELAY_REMOTE_TAILNET;
  if (fixed) {
    const addresses = fixed.split(",").filter(Boolean);
    return async () => ({ status: "connected", addresses });
  }
  let last: { at: number; result: Promise<PhoneTailnet> } | undefined;
  return async (detail) => {
    if (!detail) {
      const addresses = tailnetAddresses(networkInterfaces());
      if (addresses.length) return { status: "connected", addresses };
    }
    if (!last || Date.now() - last.at > 2500)
      last = { at: Date.now(), result: probe() };
    return last.result;
  };
}
