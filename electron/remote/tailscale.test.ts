import { describe, expect, it, vi } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import type { PhoneTailnet } from "../../shared/remote";
import {
  readTailscaleStatus,
  tailnetAddresses,
  tailnetPeer,
  tailnetProbe,
} from "./tailscale";

const nic = (address: string): NetworkInterfaceInfo =>
  ({
    address,
    family: address.includes(":") ? "IPv6" : "IPv4",
    internal: false,
    netmask: "",
    mac: "00:00:00:00:00:00",
    cidr: null,
  }) as NetworkInterfaceInfo;

it("finds Tailscale's own interface, not a carrier's shared addresses", () => {
  expect(
    tailnetAddresses({
      en0: [nic("192.168.0.5")],
      // macOS names it utun*; Tailscale's IPv6 prefix gives it away.
      utun4: [nic("100.64.12.34"), nic("fd7a:115c:a1e0::7f01:4")],
      // A phone hotspot handing out carrier-grade NAT, without that prefix.
      bridge100: [nic("100.72.0.1")],
      tailscale0: [nic("100.101.2.3")],
    }),
  ).toEqual(["100.64.12.34", "100.101.2.3"]);
});

it("lets in connections from the tailnet or this computer, and nothing else", () => {
  expect(tailnetPeer("100.101.2.3")).toBe(true);
  expect(tailnetPeer("::ffff:100.101.2.3")).toBe(true);
  expect(tailnetPeer("fd7a:115c:a1e0::7f01:4")).toBe(true);
  expect(tailnetPeer("127.0.0.1")).toBe(true);
  expect(tailnetPeer("192.168.0.9")).toBe(false);
  expect(tailnetPeer("::ffff:192.168.0.9")).toBe(false);
  expect(tailnetPeer("100.128.0.1")).toBe(false);
  expect(tailnetPeer(undefined)).toBe(false);
});

it("reads the CLI's status: this computer's name and the phones on the tailnet", () => {
  const status = JSON.stringify({
    BackendState: "Running",
    Self: {
      HostName: "Studio Mac",
      OS: "macOS",
      Online: true,
      TailscaleIPs: ["100.64.12.34", "fd7a:115c:a1e0::7f01:4"],
    },
    Peer: {
      a: { HostName: "Old iPhone", OS: "iOS", Online: false },
      b: { HostName: "Build box", OS: "linux", Online: true },
      c: { HostName: "Z Fold7", OS: "android", Online: true },
    },
  });
  expect(readTailscaleStatus(status)).toEqual({
    status: "connected",
    addresses: ["100.64.12.34"],
    name: "Studio Mac",
    phones: [
      { name: "Z Fold7", online: true },
      { name: "Old iPhone", online: false },
    ],
  });
  expect(
    readTailscaleStatus(JSON.stringify({ BackendState: "NeedsLogin" })),
  ).toEqual({ status: "stopped", addresses: [] });
});

describe("watching for the tailnet with Tailscale off", () => {
  const off: PhoneTailnet = { status: "stopped", addresses: [] };
  const wifi = { en0: [nic("192.168.1.20")] };

  function watched() {
    let at = 0;
    let interfaces: Record<string, NetworkInterfaceInfo[]> = wifi;
    const ask = vi.fn(async () => off);
    const probe = tailnetProbe(
      {},
      { interfaces: () => interfaces, ask, now: () => at },
    );
    return {
      ask,
      // Phone access looks every 10s, as PhoneRemote's watch does.
      tenSecondsLater: () => {
        at += 10_000;
        return probe();
      },
      settingsFiveSecondsLater: () => {
        at += 5000;
        return probe(true);
      },
      network: (next: Record<string, NetworkInterfaceInfo[]>) =>
        (interfaces = next),
    };
  }

  it("asks the Tailscale CLI once a minute, not on every look", async () => {
    const { ask, tenSecondsLater } = watched();
    for (let look = 0; look < 60; look++) await tenSecondsLater();
    // 10 idle minutes; every look asked it before: 60.
    expect(ask).toHaveBeenCalledTimes(10);
  });

  it("asks again at once when the network changes", async () => {
    const { ask, tenSecondsLater, network } = watched();
    await tenSecondsLater();
    network({ ...wifi, utun4: [nic("10.0.0.2")] });
    await tenSecondsLater();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("answers from the interfaces alone once Tailscale is up", async () => {
    const { ask, tenSecondsLater, network } = watched();
    network({ ...wifi, tailscale0: [nic("100.101.102.103")] });
    expect(await tenSecondsLater()).toEqual({
      status: "connected",
      addresses: ["100.101.102.103"],
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks afresh for Settings' detail", async () => {
    const { ask, tenSecondsLater, settingsFiveSecondsLater } = watched();
    await tenSecondsLater();
    await settingsFiveSecondsLater();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
