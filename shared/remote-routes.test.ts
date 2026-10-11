import { expect, it } from "vitest";
import { learnHosts, maxHosts, orderHosts, routeKind } from "./remote-routes";

it("tells Tailscale addresses from the local network's", () => {
  expect(routeKind("100.101.2.3")).toBe("tailscale");
  expect(routeKind("[fd7a:115c:a1e0::1]")).toBe("tailscale");
  expect(routeKind("mac.tail1234.ts.net")).toBe("tailscale");
  // Outside the CGNAT block.
  expect(routeKind("100.128.0.1")).toBe("local");
  expect(routeKind("192.168.0.5")).toBe("local");
});

it("orders by route and keeps the desktop's order within one", () => {
  const hosts = ["100.101.2.3", "192.168.0.5", "10.0.0.7"];
  expect(orderHosts(hosts)).toEqual(["192.168.0.5", "10.0.0.7", "100.101.2.3"]);
  expect(orderHosts(hosts, ["tailscale", "local"])).toEqual([
    "100.101.2.3",
    "192.168.0.5",
    "10.0.0.7",
  ]);
});

it("keeps the address it came in by beside the desktop's, within the cap", () => {
  expect(learnHosts(["192.168.0.5"], "127.0.0.1")).toEqual([
    "192.168.0.5",
    "127.0.0.1",
  ]);
  expect(learnHosts(["192.168.0.5"], "192.168.0.5")).toEqual(["192.168.0.5"]);
  const many = Array.from({ length: 20 }, (_, i) => `10.0.0.${i}`);
  const kept = learnHosts(many, "127.0.0.1");
  expect(kept).toHaveLength(maxHosts);
  expect(kept.at(-1)).toBe("127.0.0.1");
});
