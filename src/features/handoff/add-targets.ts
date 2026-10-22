import {
  computerRouteSchema,
  type ComputerRoute,
  type PairedComputer,
  type SshHost,
} from "../../../shared/handoff";

/** What Add can reach: a computer over ssh or in WSL, or the one a pairing link names. */
export type Target =
  | { kind: "route"; name: string; route: ComputerRoute; detail: string }
  | { kind: "link"; name: string; link: string };

export const routeKey = (route: ComputerRoute) =>
  route.kind === "ssh" ? `ssh:${route.host}` : `wsl:${route.distro}`;

/** What typing names: a pairing link, a WSL distribution here, or an ssh host. */
export function fromTyped(
  text: string,
  distros: readonly string[],
): Target | { error: string } | undefined {
  // Copied as a command, `ssh box` is box.
  const typed = text.trim().replace(/^ssh\s+/, "");
  if (!typed) return undefined;
  if (typed.startsWith("relay-remote://"))
    return { kind: "link", name: "the computer in the link", link: typed };
  const distro = distros.find((d) => d.toLowerCase() === typed.toLowerCase());
  if (distro)
    return {
      kind: "route",
      name: distro,
      route: { kind: "wsl", distro },
      detail: "WSL on this computer",
    };
  if (/\s/.test(typed))
    return {
      error:
        "Relay connects to a host by name; put options like the port or user in ~/.ssh/config.",
    };
  const route = computerRouteSchema.safeParse({ kind: "ssh", host: typed });
  if (!route.success) return { error: "That isn't an SSH host." };
  return { kind: "route", name: typed, route: route.data, detail: "over ssh" };
}

/**
 * What Add offers to click: this computer's WSL distributions, which need no
 * setup, then the hosts ~/.ssh/config names; none already paired.
 */
export function suggestions(
  distros: readonly string[],
  hosts: readonly SshHost[],
  paired: readonly Pick<PairedComputer, "route">[],
) {
  const taken = new Set(
    paired.flatMap((c) => (c.route ? [routeKey(c.route)] : [])),
  );
  const all: Extract<Target, { kind: "route" }>[] = [
    ...distros.map((distro) => ({
      kind: "route" as const,
      name: distro,
      route: { kind: "wsl" as const, distro },
      detail: "WSL on this computer",
    })),
    ...hosts.map((h) => ({
      kind: "route" as const,
      name: h.host,
      route: { kind: "ssh" as const, host: h.host },
      detail: h.hostName
        ? `${h.user ? `${h.user}@` : ""}${h.hostName}`
        : "from ~/.ssh/config",
    })),
  ];
  return {
    offered: all.filter((t) => !taken.has(routeKey(t.route))),
    hidden: all.filter((t) => taken.has(routeKey(t.route))).length,
  };
}
