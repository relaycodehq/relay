import type { NetworkInterfaceInfo } from "node:os";
import { expect, it } from "vitest";
import { lanAddresses, lanPeer } from "./lan";

const v4 = (address: string, internal = false) =>
  ({ address, family: "IPv4", internal }) as NetworkInterfaceInfo;

it("names the Wi-Fi and Ethernet addresses, not containers, VMs or VPNs", () => {
  expect(
    lanAddresses({
      lo0: [v4("127.0.0.1", true)],
      en0: [v4("192.168.0.140"), { ...v4("fe80::1"), family: "IPv6" } as NetworkInterfaceInfo],
      en7: [v4("10.0.0.12")],
      docker0: [v4("172.17.0.1")],
      bridge100: [v4("192.168.64.1")],
      utun4: [v4("10.8.0.2")],
      tailscale0: [v4("100.100.1.2")],
      "vEthernet (WSL)": [v4("172.28.16.1")],
      // A public address on a real interface isn't the local network's.
      eth1: [v4("203.0.113.9")],
    }),
  ).toEqual(["192.168.0.140", "10.0.0.12"]);
});

it("lets in private, link-local and loopback peers only", () => {
  for (const ok of [
    "192.168.1.20",
    "::ffff:10.1.2.3",
    "172.20.0.4",
    "169.254.3.3",
    "127.0.0.1",
    "fe80::1",
    "fd12::3",
  ])
    expect(lanPeer(ok), ok).toBe(true);
  for (const no of [
    undefined,
    "8.8.8.8",
    "172.32.0.1",
    "100.64.0.1",
    "2001:db8::1",
  ])
    expect(lanPeer(no), String(no)).toBe(false);
});
