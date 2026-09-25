import type { AgentProvider } from "../../shared/agents";
import { claudeArgs } from "../../shared/settings";
import { runCodex } from "../rooms/codex";
import { closeCodexConnection } from "../rooms/codex-connection";
import { runClaude } from "../rooms/claude";
import {
  askClaudeSide,
  claudeDefaults,
  closeClaudeSession,
  listClaudeCommands,
  listClaudeModels,
} from "../rooms/claude-project";
import { codexDefaults, codexModels, codexSkills } from "../provider-commands";
import { presentSkill } from "../skill-presentation";
import { runOpenCode } from "./opencode/run";
import { disposeOpenCode } from "./opencode/client";
import {
  openCodeCommands,
  openCodeDefaults,
  openCodeModels,
} from "./opencode/catalog";
import type { AgentRuntime } from "./types";

const codex: AgentRuntime = {
  run: runCodex,
  closeSession: (key) => closeCodexConnection(key).catch(() => {}),
  models: codexModels,
  defaults: codexDefaults,
  commands: async (root) => (await codexSkills(root)).map(presentSkill),
};

const claude: AgentRuntime = {
  run: (options) => runClaude({ ...options, ...claudeArgs(options.choice) }),
  closeSession: async (key) => closeClaudeSession(key),
  models: listClaudeModels,
  defaults: async (root) => {
    const defaults = await claudeDefaults(root);
    return defaults
      ? { model: defaults.appliedModel, effort: defaults.appliedEffort }
      : null;
  },
  commands: listClaudeCommands,
  askSide: ({ choice, ...options }) =>
    askClaudeSide({ ...options, model: claudeArgs(choice).model }),
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
};

export const agentRuntimes: Record<AgentProvider, AgentRuntime> = {
  codex,
  claude,
  opencode,
};
export const agentRuntime = (provider: AgentProvider) =>
  agentRuntimes[provider];
