import type { AgentProvider } from "../../shared/agents";
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
import {
  openCodeCommands,
  openCodeDefaults,
  openCodeModels,
} from "./opencode/catalog";
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
  models: cursorModels,
  defaults: cursorDefaults,
  commands: cursorCommands,
  dispose: async () => disposeCursor(),
  detach: detachCursor,
  reattach: (owns) => reattachCursorSessions(owns),
};

export const agentRuntimes: Record<AgentProvider, AgentRuntime> = {
  codex: counted("codex", codex),
  claude: counted("claude", claude),
  opencode: counted("opencode", opencode),
  cursor: counted("cursor", cursor),
};
export const agentRuntime = (provider: AgentProvider) =>
  agentRuntimes[provider];
export { hostAgents } from "./hosted-sessions";
export { setOpenCodeEnvRoot } from "./opencode/worktree-env";
