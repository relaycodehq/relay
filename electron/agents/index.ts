import {
  isRegistryProvider,
  type AgentProvider,
  type BuiltinProvider,
  type RegistryProvider,
} from "../../shared/agents";
import { claudeArgs } from "../../shared/settings";
import { runCodex } from "./codex/codex";
import {
  closeCodexConnection,
  reattachCodexSessions,
} from "./codex/codex-connection";
import { runClaude } from "./claude/claude";
import {
  askClaudeSide,
  claudeDefaults,
  closeClaudeSession,
  listClaudeCommands,
  listClaudeModels,
  reattachClaudeSessions,
  reloadClaudeSession,
} from "./claude/project";
import { codexDefaults, codexModels, codexSkills } from "./provider-commands";
import { presentSkill } from "./skill-presentation";
import { runOpenCode } from "./opencode/run";
import { detachOpenCode, disposeOpenCode } from "./opencode/client";
import { reattachOpenCodeServer } from "./opencode/server";
import { runCursor } from "./cursor/run";
import {
  closeCursorConnection,
  detachCursor,
  disposeCursor,
  reattachCursorSessions,
} from "./cursor/connection";
import { cursorCommands, cursorDefaults, cursorModels } from "./cursor/catalog";
import { signInCursor, signOutCursor } from "./cursor/account";
import {
  openCodeCommands,
  openCodeDefaults,
  openCodeModels,
} from "./opencode/catalog";
import { acpRegistry, acpRuntime, registryRuntime } from "./acp";
import type { AgentRuntime } from "./types";
import { counted } from "./usage-count";
import {
  claudeAgentDefaults,
  codexAgentDefaults,
} from "../../shared/agent-defaults";

const codex: AgentRuntime = {
  run: runCodex,
  closeSession: (key) => closeCodexConnection(key).catch(() => {}),
  models: codexModels,
  defaults: async (root) => {
    const [defaults, models] = await Promise.all([
      codexDefaults(root),
      codexModels(),
    ]);
    return codexAgentDefaults(defaults, models);
  },
  commands: async (root) => (await codexSkills(root)).map(presentSkill),
  reattach: (owns) => reattachCodexSessions(owns),
};

const claude: AgentRuntime = {
  run: (options) => runClaude({ ...options, ...claudeArgs(options.choice) }),
  closeSession: async (key) => closeClaudeSession(key),
  reloadSession: reloadClaudeSession,
  models: listClaudeModels,
  defaults: async (root) => {
    const [defaults, models] = await Promise.all([
      claudeDefaults(root),
      listClaudeModels(),
    ]);
    return defaults ? claudeAgentDefaults(defaults, models) : null;
  },
  commands: listClaudeCommands,
  askSide: ({ choice, ...options }) =>
    askClaudeSide({ ...options, model: claudeArgs(choice).model }),
  reattach: reattachClaudeSessions,
};

/**
 * OpenCode works in one `opencode serve` Relay starts on first use. Its
 * sessions live in OpenCode's own storage, so there is nothing to close.
 */
const opencode: AgentRuntime = {
  run: runOpenCode,
  closeSession: async () => {},
  models: openCodeModels,
  defaults: openCodeDefaults,
  commands: openCodeCommands,
  dispose: async () => disposeOpenCode(),
  detach: detachOpenCode,
  reattach: (owns) => reattachOpenCodeServer(owns),
};

/**
 * Cursor runs its SDK in a worker Relay starts per thread; the SDK itself is
 * downloaded on first use. Its sessions are the SDK's own agents.
 */
const cursor: AgentRuntime = {
  run: runCursor,
  closeSession: closeCursorConnection,
  signIn: () => signInCursor(),
  signOut: signOutCursor,
  models: cursorModels,
  defaults: cursorDefaults,
  commands: cursorCommands,
  dispose: async () => disposeCursor(),
  detach: detachCursor,
  reattach: (owns) => reattachCursorSessions(owns),
};

const builtinRuntimes: Record<BuiltinProvider, AgentRuntime> = {
  codex: counted("codex", codex),
  claude: counted("claude", claude),
  opencode: counted("opencode", opencode),
  cursor: counted("cursor", cursor),
  amp: counted("amp", acpRuntime("amp")),
  antigravity: counted("antigravity", acpRuntime("antigravity")),
};
/** Registry agents' runtimes, made as threads or Relay's start ask for them. */
const registryRuntimes = new Map<RegistryProvider, AgentRuntime>();

export function agentRuntime(provider: AgentProvider): AgentRuntime {
  if (!isRegistryProvider(provider)) return builtinRuntimes[provider];
  let runtime = registryRuntimes.get(provider);
  if (!runtime) {
    runtime = counted(provider, registryRuntime(provider));
    registryRuntimes.set(provider, runtime);
  }
  return runtime;
}

/**
 * Every runtime that may have sessions: the built-in ones and each registry
 * agent's. Startup makes the installed ones first, so their hosted sessions
 * are reattached.
 */
export const agentRuntimes = (): [AgentProvider, AgentRuntime][] => [
  ...(Object.entries(builtinRuntimes) as [AgentProvider, AgentRuntime][]),
  ...registryRuntimes,
];

export const everyAgentRuntime = () =>
  agentRuntimes().map(([, runtime]) => runtime);

/** Reads the installed registry agents and makes their runtimes, so their sessions reattach. */
export async function loadRegistryAgents() {
  for (const agent of await acpRegistry().load()) agentRuntime(agent.provider);
}

/** Stops a registry agent's sessions before Relay deletes it. */
export async function forgetRegistryRuntime(provider: RegistryProvider) {
  await registryRuntimes.get(provider)?.dispose?.();
  registryRuntimes.delete(provider);
}

export { hostAgents } from "./hosted-sessions";
export { setOpenCodeEnvRoot } from "./opencode/worktree-env";
