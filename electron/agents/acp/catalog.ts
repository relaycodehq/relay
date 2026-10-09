import { homedir } from "node:os";
import type { AgentDefaults, AgentModel } from "../../../shared/agents";
import type { ProviderCommand } from "../../../shared/commands";
import { memoOnce } from "../../util/memo";
import { signedOutError } from "../errors";
import { withTimeout } from "../../util/timeout";
import { heardCommands } from "./commands";
import type { AcpProfile } from "./profiles";
import { acquireAcpAgent, openSession } from "./sessions";
import { currentOf, modelsOf } from "./settings";

const probeTimeout = 60_000;
/** Agents send their commands just after the session opens; this long is waited for them. */
const commandsWait = 1500;

/**
 * What a fresh session offers: models, the one it runs by default, and its
 * commands. ACP has no other way to ask, so a private process opens one.
 */
async function probe(profile: AcpProfile, cwd: string) {
  if ((await profile.account?.())?.signedIn === false)
    throw signedOutError(
      profile.provider,
      `${profile.name} is signed out. Sign in under Settings → AI models → Agents.`,
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
    return { models: modelsOf(settings), current: currentOf(settings) };
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
    commands: async (_root: string): Promise<ProviderCommand[]> => {
      const heard = heardCommands(profile.provider);
      if (heard) return heard;
      await fresh().catch(() => undefined);
      return heardCommands(profile.provider) ?? [];
    },
    forget: fresh.forget,
  };
}
