// Agents that speak the Agent Client Protocol: one runtime, a profile each.
import type { AgentRuntime } from "../types";
import { acpCatalog } from "./catalog";
import type { AgentProvider, RegistryProvider } from "../../../shared/agents";
import { runAccount } from "../accounts";
import {
  antigravityBatches,
  antigravityCredentialRevision,
} from "../antigravity";
import { acpProfiles, antigravityProfile, type AcpProfile } from "./profiles";
import { runAcp } from "./run";
import {
  closeAcpSession,
  detachAcp,
  disposeAcp,
  reattachAcp,
} from "./sessions";
import type { SdkIo } from "../agent-updates";
import {
  currentAntigravity,
  newestAntigravity,
  updateAntigravity,
} from "../antigravity";
import { signInAcp, signOutAcp } from "./sign-in";
import { AcpRegistry, acpRegistry, registryProfile } from "./registry";

export type { AcpProvider } from "./profiles";
export { configureAntigravity } from "../antigravity";
export { AcpRegistry, acpRegistry, configureAcpRegistry } from "./registry";

/** Who `provider` is signed in as, for an ACP agent Relay signs in; undefined when it can't tell. */
export const acpAccount = async (provider: AgentProvider) =>
  (acpProfiles as Partial<Record<AgentProvider, AcpProfile>>)[
    provider
  ]?.account?.();

/** The runtime for one of Relay's own ACP agents. */
export const acpRuntime = (provider: keyof typeof acpProfiles) =>
  profileRuntime(acpProfiles[provider]);

/** The runtime for an agent installed from the ACP registry. */
export function registryRuntime(provider: RegistryProvider): AgentRuntime {
  const registry = () => acpRegistry();
  return profileRuntime(
    registryProfile(provider, {
      installed: () => registry().current(provider),
      ensure: () => registry().ensure(provider),
    }),
  );
}

function profileRuntime(profile: AcpProfile): AgentRuntime {
  const catalogs = new Map<string, ReturnType<typeof acpCatalog>>();
  const revisions = new Map<string, string | undefined>();
  const selected = async (account?: string) => {
    if (profile.provider !== "antigravity") return profile;
    const who = await runAccount("antigravity", account);
    const bound = antigravityProfile(who.env, who.id);
    return {
      ...bound,
      credentialsRevision: await antigravityCredentialRevision(
        bound.home!,
        !!who.env.AGY_ACP_FORCE_FILE_STORAGE,
      ),
    };
  };
  const catalog = async () => {
    const current = await selected();
    const key = current.accountKey ?? "default";
    let found = catalogs.get(key);
    // A different login or auth setting under the same account invalidates its catalog too.
    const revision = current.credentialsRevision;
    if (!found || revisions.get(key) !== revision) {
      catalogs.set(key, (found = acpCatalog(current)));
      revisions.set(key, revision);
    }
    return found;
  };
  const forget = () => {
    catalogs.clear();
    revisions.clear();
  };
  return {
    run: async (options) => runAcp(await selected(options.account), options),
    closeSession: (key) => {
      if (profile.provider === "antigravity") antigravityBatches.drop(key);
      return closeAcpSession(profile, key);
    },
    ...(profile.provider === "antigravity"
      ? { subagents: (key: string) => antigravityBatches.get(key) }
      : {}),
    ...(profile.authMethod && {
      signIn: async () => {
        await signInAcp(await selected());
        forget();
      },
      signOut: async () => {
        await signOutAcp(await selected());
        forget();
      },
    }),
    models: async () => (await catalog()).models(),
    // Asks a fresh session again; ACP has no call to refresh the list itself.
    reloadModels: async () => forget(),
    defaults: async () => (await catalog()).defaults(),
    commands: async (root) => (await catalog()).commands(root),
    knownCommands: async (root) => (await catalog()).knownCommands(root),
    dispose: async () => disposeAcp(profile),
    detach: () => detachAcp(profile),
    reattach: (owns) => reattachAcp(profile, owns),
  };
}

/** What Settings' agent rows ask of Antigravity: the server Relay downloaded, and whether it's signed in. */
export const antigravityIo: SdkIo = {
  source: "Google",
  installed: async () => (await currentAntigravity())?.version,
  newest: newestAntigravity,
  install: async (version) => {
    await updateAntigravity(version);
  },
  account: async () => {
    const who = await runAccount("antigravity");
    return antigravityProfile(who.env, who.id).account?.();
  },
};

/** The registry agents for Settings' agent cards. */
export const registryUpdatesIo = (registry: AcpRegistry) => ({
  providers: () => registry.state.installed.map((agent) => agent.provider),
  sdk: (provider: RegistryProvider) => registry.sdkIo(provider),
});
