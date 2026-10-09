// Agents that speak the Agent Client Protocol: one runtime, a profile each.
import type { AgentRuntime } from "../types";
import { acpCatalog } from "./catalog";
import type { AgentProvider, RegistryProvider } from "../../../shared/agents";
import { acpProfiles, type AcpProfile } from "./profiles";
import { runAcp } from "./run";
import { closeAcpSession, detachAcp, disposeAcp, reattachAcp } from "./sessions";
import type { SdkIo } from "../agent-updates";
import {
  currentAntigravity,
  newestAntigravity,
  updateAntigravity,
} from "./antigravity-install";
import { signInAcp, signOutAcp } from "./sign-in";
import { AcpRegistry, acpRegistry, registryProfile } from "./registry";

export type { AcpProvider } from "./profiles";
export { configureAntigravity } from "./antigravity-install";
export {
  AcpRegistry,
  acpRegistry,
  configureAcpRegistry,
} from "./registry";

/** Who `provider` is signed in as, for an ACP agent Relay signs in; undefined when it can't tell. */
export const acpAccount = async (provider: AgentProvider) =>
  (acpProfiles as Partial<Record<AgentProvider, AcpProfile>>)[provider]?.account?.();

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
  const catalog = acpCatalog(profile);
  return {
    run: (options) => runAcp(profile, options),
    closeSession: (key) => closeAcpSession(profile, key),
    ...(profile.authMethod && {
      signIn: async () => {
        await signInAcp(profile);
        catalog.forget();
      },
      signOut: async () => {
        await signOutAcp(profile);
        catalog.forget();
      },
    }),
    models: catalog.models,
    defaults: catalog.defaults,
    commands: catalog.commands,
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
  account: async () => acpProfiles.antigravity.account?.(),
};

/** The registry agents for Settings' agent cards. */
export const registryUpdatesIo = (registry: AcpRegistry) => ({
  providers: () => registry.state.installed.map((agent) => agent.provider),
  sdk: (provider: RegistryProvider) => registry.sdkIo(provider),
});
