import { homedir } from "node:os";
import type { AgentProvider } from "../../../shared/agents";
import type { AgentTools, AgentToolListing } from "../../../shared/agent-tools";
import type { ProviderCommand } from "../../../shared/commands";
import { hasAccounts } from "../../../shared/agent-accounts";
import { accountFor, accountLabel, accountHome, signedInAs } from "../accounts";
import { discoverCursorSkills } from "../cursor/skills";
import { discoverAntigravitySkills } from "../antigravity";
import { inspectCodex } from "./codex";
import { inspectClaude, claudeFiles } from "./claude";
import { skillItem, sourceOf } from "./presentation";

/**
 * Every call reads afresh. This page describes new sessions, never rewrites
 * configuration. `known` is what an agent Relay can only ask by starting it
 * has listed already, undefined before it has.
 */
export async function inspectAgentTools(
  provider: AgentProvider,
  root: string | undefined,
  known: () => Promise<ProviderCommand[] | undefined>,
): Promise<AgentTools> {
  const cwd = root ?? homedir();
  const account = hasAccounts(provider) ? accountFor(provider) : undefined;
  let inventory: Pick<AgentTools, "skills" | "servers">;
  if (provider === "codex" || provider === "claude") {
    try {
      inventory =
        provider === "codex"
          ? await inspectCodex(cwd, await signedInAs(provider, account!))
          : await inspectClaude(cwd, claudeFiles(cwd, account!));
    } catch {
      inventory = {
        skills: {
          items: [],
          error:
            "The agent's skills could not be read. Check its installation and refresh to try again.",
        },
        servers: {
          items: [],
          error:
            "The agent's MCP configuration could not be read. Check its installation and refresh to try again.",
        },
      };
    }
  } else {
    const servers: AgentToolListing = {
      items: [],
      note: "This agent does not expose an MCP configuration inventory to Relay yet. This does not mean it has no servers.",
    };
    let skills: AgentToolListing;
    try {
      if (provider === "cursor" || provider === "antigravity") {
        const list =
          provider === "cursor"
            ? await discoverCursorSkills(root)
            : await discoverAntigravitySkills(
                cwd,
                accountHome("antigravity", account!),
              );
        skills = {
          items: list.map(skillItem),
          note: "Read from this agent's skill folders. Session policies may further restrict availability.",
        };
      } else {
        const list = await known();
        skills = !list
          ? {
              items: [],
              note: "This agent lists its skills only once it runs, and opening this page doesn't start it. Start a thread with it, then refresh.",
            }
          : {
              items: list
                .filter((c) => c.skill || provider === "muse")
                .map((c) => ({
                  id: c.name,
                  name: c.displayName || c.name,
                  description: c.description,
                  source: sourceOf(c.source),
                  state: "enabled",
                  detail:
                    "Offered by the agent's skill catalog. The agent did not report a file path.",
                })),
              note: "Only skills offered by the agent are listed. Disabled skills and exact paths are not reported by this agent.",
            };
      }
    } catch {
      skills = {
        items: [],
        error: "This agent could not list its skills. Refresh to try again.",
      };
    }
    inventory = { skills, servers };
  }
  // Relay's own tools are supplied for threads, rather than stored in provider config.
  if (provider !== "cursor") {
    inventory.servers.items = inventory.servers.items.filter(
      (server) => server.name !== "relay",
    );
    inventory.servers.items.push({
      id: "relay",
      name: "relay",
      source: "builtin",
      state:
        provider === "codex" ||
        provider === "claude" ||
        provider === "opencode" ||
        provider === "muse" ||
        provider === "antigravity"
          ? "enabled"
          : "unknown",
      transport: "HTTP",
      description: "Threads, previews and tools for working in Relay.",
      detail:
        "Provided by Relay when a thread starts. This is not a live connection check; helper jobs and reviewers use a restricted tool set.",
    });
  }
  return {
    ...inventory,
    checkedAt: Date.now(),
    ...(hasAccounts(provider)
      ? { account: accountLabel(provider, account!) }
      : {}),
  };
}
