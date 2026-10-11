/**
 * The ways a phone or computer reaches a desktop's bridge: its addresses on
 * the local network and on Tailscale, tried in the order the user picked.
 * Every route carries the same pinned, encrypted channel, so the order is
 * about speed and reach, not trust.
 */
export type RouteKind = "local" | "tailscale";

/** Local network first: when both answer, it's the shorter way. */
export const defaultRoutes: readonly RouteKind[] = ["local", "tailscale"];

/** Most addresses a desktop hands out, or a phone keeps. */
export const maxHosts = 8;

// Tailscale's IPv4 comes from the shared CGNAT block, its IPv6 from its own
// prefix, and MagicDNS names end in ts.net.
export function routeKind(host: string): RouteKind {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  const [a, b] = bare.split(".").map(Number);
  if (a === 100 && b! >= 64 && b! <= 127) return "tailscale";
  if (bare.startsWith("fd7a:115c:a1e0:") || bare.endsWith(".ts.net"))
    return "tailscale";
  return "local";
}

/** The hosts by route, in the order given; within a route, as they came. */
export function orderHosts(
  hosts: readonly string[],
  routes: readonly RouteKind[] = defaultRoutes,
): string[] {
  const rank = (host: string) => {
    const i = routes.indexOf(routeKind(host));
    return i < 0 ? routes.length : i;
  };
  return hosts
    .map((host, i) => ({ host, i, rank: rank(host) }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.host);
}

/**
 * What a client keeps after the desktop names its addresses: those, plus the
 * one it came in by, which the desktop can't see (a forwarded port, the
 * emulator's loopback). Stale addresses go with the next connection.
 */
export function learnHosts(
  fresh: readonly string[],
  via: string,
): string[] {
  return [...new Set([...fresh.slice(0, maxHosts - 1), via])];
}
