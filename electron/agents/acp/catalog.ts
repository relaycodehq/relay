import { homedir } from "node:os";
import type { AgentDefaults, AgentModel } from "../../../shared/agents";
import type { ProviderCommand } from "../../../shared/commands";
import { memoOnce } from "../../util/memo";
import { signedOutMessage } from "../../../shared/agent-error";
import { signedOutError } from "../errors";
import { withTimeout } from "../../util/timeout";
import { heardCommands } from "./commands";
import { skillCommands } from "../skill-presentation";
import type { AcpProfile } from "./profiles";
import { acquireAcpAgent, openSession, type AcpSettings } from "./sessions";
import { currentOf, modelsOf } from "./settings";

const probeTimeout = 60_000;
/** Agents send their commands just after the session opens; this long is waited for them. */
const commandsWait = 1500;

/** Whether the session already has models, by config option or by the older list. */
function hasModels(settings: AcpSettings) {
  return (
    settings.configOptions?.some((o) => o.category === "model") ||
    (settings.models?.availableModels?.length ?? 0) > 0
  );
}

/**
 * What a fresh session offers: models, the one it runs by default, and its
 * commands. ACP has no other way to ask, so a private process opens one.
 */
async function probe(profile: AcpProfile, cwd: string) {
  if ((await profile.account?.())?.signedIn === false)
    throw signedOutError(
      profile.provider,
      `${signedOutMessage(profile.name)} Sign in under Settings → AI & agents → Agents.`,
    );
  const agent = await acquireAcpAgent(profile, undefined, cwd);
  try {
    await withTimeout(
      openSession(agent, { cwd, mcpServers: [] }),
      probeTimeout,
      `${profile.name} didn't open a session in time.`,
    );
    const settings = agent.session!.settings;
    if (!heardCommands(profile.provider))
      await new Promise((resolve) => setTimeout(resolve, commandsWait));
    // Some agents send models in a config_option_update after the session
    // opens; give them a moment to arrive.
    if (!hasModels(settings))
      await new Promise((resolve) => setTimeout(resolve, commandsWait));
    const listed = modelsOf(settings);
    return {
      models: profile.models?.(listed) ?? listed,
      current: currentOf(settings),
    };
  } finally {
    agent.close();
  }
}

/** The catalog calls of the runtime for `profile`, each answer kept ten minutes. */
export function acpCatalog(profile: AcpProfile) {
  const fresh = memoOnce(() => probe(profile, homedir()), 10 * 60_000);
  return {
    models: async (): Promise<AgentModel[]> => (await fresh()).models,
    defaults: async (): Promise<AgentDefaults | null> => {
      const { current, models } = await fresh().catch(() => ({ current: undefined, models: [] }));
      if (!current) return null;
      return {
        model: models.some((m) => m.id === current.model) ? current.model : "",
        effort: current.effort,
      };
    },
    commands: async (root: string): Promise<ProviderCommand[]> => {
      const [heard, skills] = await Promise.all([
        heardCommands(profile.provider) ??
          fresh()
            .catch(() => undefined)
            .then(() => heardCommands(profile.provider) ?? []),
        profile.skills?.(root) ?? [],
      ]);
      return [...heard, ...skillCommands(skills)];
    },
    knownCommands: async (root: string) => {
      const heard = heardCommands(profile.provider);
      if (!heard) return undefined;
      const skills = (await profile.skills?.(root)) ?? [];
      return [...heard, ...skillCommands(skills)];
    },
    forget: fresh.forget,
  };
}
