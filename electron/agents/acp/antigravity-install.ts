import {
  entriesOf,
  fetchRegistry,
  machineTarget,
  planFor,
  type AgentPlan,
  type Fetch,
} from "./registry/catalog";
import { installInto, installedIn, type InstallIo } from "./registry/install";

/**
 * Google ships Antigravity's ACP server as a download, not a CLI on the
 * machine: Relay installs Google's own entry in the ACP registry into its
 * data folder like any registry agent, but only from Google's server.
 */
export type { Fetch } from "./registry/catalog";
export { registryTarget } from "./registry/catalog";

const registryId = "antigravity-acp";
/** Relay runs only what comes from Google's download server, whatever the registry says. */
const downloadHost = "https://dl.google.com/";

export interface InstalledAntigravity {
  version: string;
  command: string;
  args: string[];
}

type Release = Extract<AgentPlan, { kind: "binary" }>;

/** Antigravity's release for `target` in the ACP registry, refused unless it's Google's. */
export function releaseIn(registry: unknown, target: string): Release {
  const entry = entriesOf(registry).find((agent) => agent.id === registryId);
  if (!entry) throw new Error("The ACP registry has no usable Antigravity entry.");
  if (!entry.distribution.binary?.[target])
    throw new Error(`Antigravity has no build for ${target}.`);
  const plan = planFor(entry, target);
  if (
    plan.kind !== "binary" ||
    !plan.archive.startsWith(downloadHost) ||
    !plan.archive.endsWith(".zip")
  )
    throw new Error(
      `Refusing to download Antigravity from ${plan.kind === "binary" ? plan.archive : "npm"}.`,
    );
  return plan;
}

export async function latestAntigravity(fetch: Fetch, target = machineTarget()) {
  const entries = await fetchRegistry(fetch);
  return releaseIn({ agents: entries }, target);
}

/** The server Relay unpacked, if it's still all there. */
export async function installedAntigravity(
  root: string,
): Promise<InstalledAntigravity | undefined> {
  const found = await installedIn(root);
  return found && { version: found.version, command: found.command, args: found.args };
}

interface InstallOptions {
  /** The version wanted; the registry only offers its newest, so anything else fails. */
  version?: string;
  target?: string;
  extract?: InstallIo["extract"];
}

/** Downloads the registry's newest server into `root/<version>` and makes it the one Relay runs. */
export async function installAntigravity(
  root: string,
  fetch: Fetch,
  { version, target, extract }: InstallOptions = {},
): Promise<InstalledAntigravity> {
  const release = await latestAntigravity(fetch, target);
  if (version && version !== release.version)
    throw new Error(
      `Antigravity ${version} isn't offered any more; ${release.version} is.`,
    );
  const found = await installInto(root, release, { fetch, extract });
  return { version: found.version, command: found.command, args: found.args };
}

let setup: { root: string; fetch: Fetch } | undefined;
/** Where Antigravity goes on this machine; set once by the app. */
export function configureAntigravity(next: { root: string; fetch: Fetch }) {
  setup = next;
}
function antigravitySetup() {
  if (!setup) throw new Error("Antigravity isn't set up in this process.");
  return setup;
}

export const currentAntigravity = () =>
  installedAntigravity(antigravitySetup().root);

/** The server on disk, downloaded first if there isn't one. */
export async function ensureAntigravity() {
  const { root, fetch } = antigravitySetup();
  return (await installedAntigravity(root)) ?? installAntigravity(root, fetch);
}

export const newestAntigravity = async () =>
  (await latestAntigravity(antigravitySetup().fetch)).version;

export function updateAntigravity(version?: string) {
  const { root, fetch } = antigravitySetup();
  return installAntigravity(root, fetch, { version });
}
