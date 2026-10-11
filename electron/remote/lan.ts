import type { NetworkInterfaceInfo } from "node:os";

/**
 * This computer on the local network, for phone access that allows it. Only
 * private addresses count: a phone on the same Wi-Fi reaches one of them, and
 * nothing from the internet comes in through a router's NAT to them.
 */

const v4 = (ip: string) => ip.split(".").map(Number);

function privateV4(ip: string) {
  const [a, b] = v4(ip);
  return (
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

/** A connection from the local network: private, link-local or this computer. */
export function lanPeer(address: string | undefined) {
  if (!address) return false;
  const ip = address.replace(/^::ffff:/i, "").toLowerCase();
  if (ip.includes(":"))
    return /^(fc|fd|fe[89ab])/.test(ip) || ip === "::1";
  const [a, b] = v4(ip);
  return privateV4(ip) || (a === 169 && b === 254) || a === 127;
}

// Containers, VMs and VPNs: addresses a phone on the Wi-Fi can't reach.
const virtual =
  /^(docker|br-|veth|virbr|vmnet|vmenet|vboxnet|bridge|utun|tun|tap|wg|zt|lxc|lxd|cni|flannel|podman|cali|tailscale|awdl|llw|anpi)|vEthernet|VirtualBox|VMware|Hyper-V|WSL/i;

/** The private IPv4 addresses of this computer's real network interfaces. */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const found = Object.entries(interfaces).flatMap(([name, infos = []]) =>
    virtual.test(name)
      ? []
      : infos
          .filter(
            (i) => i.family === "IPv4" && !i.internal && privateV4(i.address),
          )
          .map((i) => i.address),
  );
  return [...new Set(found)];
}
