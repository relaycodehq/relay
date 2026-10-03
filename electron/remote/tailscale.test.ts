import { expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import {
  readTailscaleStatus,
  tailnetAddresses,
  tailnetPeer,
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
