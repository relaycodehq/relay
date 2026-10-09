import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  knowRegistryAgents,
  registryIdOf,
  registryIdPattern,
  registryProvider,
  type RegistryProvider,
} from "../../../../shared/agents";
import type {
  InstalledRegistryAgent,
  RegistryAgentsState,
  RegistryListing,
} from "../../../../shared/acp-registry";
import type { SdkIo } from "../../agent-updates";
import {
  fetchIcon,
  fetchRegistry,
  isListed,
  listingOf,
  machineTarget,
  planFor,
  type Fetch,
  type RegistryEntry,
} from "./catalog";
import { installInto, installedIn, type InstalledAgent } from "./install";

export { registryProfile } from "./profile";
export {
  archivePath,
  fetchRegistry,
  machineTarget,
  planFor,
  registryTarget,
  type AgentPlan,
  type Fetch,
} from "./catalog";
export { installInto, installedIn, type InstalledAgent } from "./install";

/** How long a registry answer is kept before Settings asks again. */
const registryLifetime = 10 * 60_000;

/**
 * The agents Relay installs from the ACP registry: each in its own folder
 * under `root`, named by its registry id.
 */
export class AcpRegistry {
  private entries?: { at: number; list: Promise<RegistryEntry[]> };
  private icons = new Map<string, Promise<string | undefined>>();
  private busy: RegistryAgentsState["busy"] = {};
  private installed: InstalledRegistryAgent[] = [];
  private listeners = new Set<(state: RegistryAgentsState) => void>();

  constructor(
    private readonly root: string,
    private readonly fetch: Fetch,
    private readonly target = machineTarget(),
  ) {}

  /** Reads what's installed, and lets the rest of Relay know the agents by name. */
  async load() {
    const ids = await readdir(this.root).catch(() => [] as string[]);
    const found = await Promise.all(
      ids
        .filter((id) => registryIdPattern.test(id))
        .map(async (id) => {
          const agent = await installedIn(this.dirOf(id));
          return agent && toInstalled(id, agent);
        }),
    );
    this.installed = found.filter((agent) => !!agent);
    knowRegistryAgents(this.installed);
    this.emit();
    return this.installed;
  }

  get state(): RegistryAgentsState {
    return { installed: this.installed, busy: this.busy };
  }

  onChange(listener: (state: RegistryAgentsState) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Every agent the registry lists, as this machine would get it. */
  async listing(fresh = false): Promise<RegistryListing[]> {
    const entries = await this.registry(fresh);
    return Promise.all(
      entries.filter(isListed).map(async (entry) => {
        const icon = await this.icon(entry.id);
        return { ...listingOf(entry, this.target), ...(icon && { icon }) };
      }),
    );
  }

  /** Installs, or updates to, the registry's version of `id`. */
  async install(id: string) {
    if (this.busy[id] === "removing")
      throw new Error("It's being removed; try again in a moment.");
    this.setBusy(id, "installing");
    try {
      const entry = (await this.registry(true)).find((e) => e.id === id);
      if (!entry) throw new Error(`The ACP registry no longer lists ${id}.`);
      const plan = planFor(entry, this.target);
      const icon = await this.icon(id);
      await installInto(
        this.dirOf(id),
        plan,
        { fetch: this.fetch },
        { name: entry.name, ...(icon && { icon }) },
      );
      await this.load();
    } finally {
      this.setBusy(id, undefined);
    }
    return this.state;
  }

  /** Deletes `id` and everything Relay downloaded for it. */
  async remove(id: string) {
    if (!registryIdPattern.test(id)) throw new Error(`No agent ${id}.`);
    this.setBusy(id, "removing");
    try {
      await rm(this.dirOf(id), { recursive: true, force: true });
      await this.load();
    } finally {
      this.setBusy(id, undefined);
    }
    return this.state;
  }

  /** What's on disk for `provider`. */
  current(provider: RegistryProvider) {
    return installedIn(this.dirOf(registryIdOf(provider)));
  }

  /** What's on disk for `provider`, installed first when it's missing. */
  async ensure(provider: RegistryProvider): Promise<InstalledAgent> {
    const found = await this.current(provider);
    if (found) return found;
    await this.install(registryIdOf(provider));
    const installed = await this.current(provider);
    if (!installed) throw new Error(`Installing ${provider} left nothing to run.`);
    return installed;
  }

  /** What Settings' agent cards ask of an installed registry agent. */
  sdkIo(provider: RegistryProvider): SdkIo {
    const id = registryIdOf(provider);
    return {
      source: "the ACP registry",
      installed: async () => (await this.current(provider))?.version,
      newest: async () => {
        const entry = (await this.registry(false)).find((e) => e.id === id);
        return entry && planFor(entry, this.target).version;
      },
      install: async (version) => {
        const entry = (await this.registry(true)).find((e) => e.id === id);
        const offered = entry && planFor(entry, this.target).version;
        if (version && offered && version !== offered)
          throw new Error(`${version} isn't offered any more; ${offered} is.`);
        await this.install(id);
      },
      account: async () => undefined,
    };
  }

  private dirOf(id: string) {
    if (!registryIdPattern.test(id)) throw new Error(`No agent ${id}.`);
    return join(this.root, id);
  }

  private registry(fresh: boolean) {
    const cached = this.entries;
    if (!fresh && cached && Date.now() - cached.at < registryLifetime)
      return cached.list;
    const list = fetchRegistry(this.fetch);
    this.entries = { at: Date.now(), list };
    // A failed answer isn't kept.
    list.catch(() => {
      if (this.entries?.list === list) this.entries = cached;
    });
    return list;
  }

  private icon(id: string) {
    let icon = this.icons.get(id);
    if (!icon) {
      const saved = this.installed.find((a) => a.id === id)?.icon;
      icon = saved ? Promise.resolve(saved) : fetchIcon(this.fetch, id);
      this.icons.set(id, icon);
    }
    return icon;
  }

  private setBusy(id: string, what: RegistryAgentsState["busy"][string] | undefined) {
    const { [id]: _, ...rest } = this.busy;
    this.busy = what ? { ...rest, [id]: what } : rest;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }
}

function toInstalled(id: string, agent: InstalledAgent): InstalledRegistryAgent {
  return {
    provider: registryProvider(id),
    id,
    name: agent.name ?? id,
    version: agent.version,
    via: agent.via,
    ...(agent.icon && { icon: agent.icon }),
  };
}

let registry: AcpRegistry | undefined;
/** Where registry agents go on this machine; set once by the app. */
export function configureAcpRegistry(next: AcpRegistry) {
  registry = next;
}
export function acpRegistry() {
  if (!registry) throw new Error("The ACP registry isn't set up in this process.");
  return registry;
}
