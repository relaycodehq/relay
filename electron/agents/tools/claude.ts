import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentTool, AgentToolListing } from "../../../shared/agent-tools";
import { accountFor, accountHome } from "../accounts";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import {
  claudeManagedDir,
  discoverClaudeSkills,
  readSkillOverrides,
  skillOverrideFiles,
} from "../claude/project/skills";
import { readConfig } from "./json";
import { record, serverItem, skillItem, strings } from "./presentation";

type ClaudeFiles = {
  configDir: string;
  userFile: string;
  settingsFiles: string[];
  managedMcp?: string;
};
export function claudeFiles(
  cwd: string,
  account = accountFor("claude"),
): ClaudeFiles {
  const configDir = resolve(cwd, accountHome("claude", account));
  const managed = claudeManagedDir();
  return {
    configDir,
    userFile:
      account !== SYSTEM_ACCOUNT || process.env.CLAUDE_CONFIG_DIR?.trim()
        ? join(configDir, ".claude.json")
        : join(homedir(), ".claude.json"),
    settingsFiles: skillOverrideFiles(configDir, cwd),
    ...(managed ? { managedMcp: join(managed, "managed-mcp.json") } : {}),
  };
}

/** File inspection only: opening Settings must not launch the user's MCP commands. */
export async function inspectClaude(cwd: string, files = claudeFiles(cwd)) {
  const [settings, user, project, managed, skillList] =
    await Promise.allSettled([
      Promise.allSettled(files.settingsFiles.map(readConfig)),
      readConfig(files.userFile),
      readConfig(join(cwd, ".mcp.json")),
      files.managedMcp
        ? readConfig(files.managedMcp)
        : Promise.resolve({} as Record<string, unknown>),
      discoverClaudeSkills(files.configDir, cwd),
    ]);
  const settingsList =
    settings.status === "fulfilled"
      ? settings.value.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        )
      : [];
  const settingsIncomplete =
    settings.status === "rejected" ||
    settings.value.some((result) => result.status === "rejected");
  // Claude concatenates list settings across files; a later scalar wins.
  const listed = (key: string) => settingsList.flatMap((s) => strings(s[key]));
  const skills: AgentToolListing =
    skillList.status === "fulfilled"
      ? { items: skillList.value.map(skillItem) }
      : {
          items: [],
          error: "Claude's skills could not be read. Refresh to try again.",
        };
  const servers: AgentToolListing = {
    items: [],
    note: "Read from Claude's configuration files without connecting. Cloud connectors, custom plugin config paths and runtime-only servers are not listed. Plugin server availability is confirmed only when a session loads. Managed policies may further restrict availability.",
  };
  if (
    settingsIncomplete ||
    [user, project, managed].some((result) => result.status === "rejected")
  ) {
    servers.error =
      "Some of Claude's configuration files could not be read. The inventory may be incomplete.";
  }
  const userData: Record<string, unknown> =
    user.status === "fulfilled" ? user.value : {};
  const local = projectEntry(record(userData.projects), cwd);
  const disabled = new Set(strings(local.disabledMcpServers));
  const rejectedProject = new Set([
    ...listed("disabledMcpjsonServers"),
    ...strings(local.disabledMcpjsonServers),
  ]);
  // Unapproved .mcp.json servers still load: Relay's sessions are non-interactive with project
  // settings on, where Claude approves them itself. Only a rejection keeps one out.
  const found = new Map<string, AgentTool>();
  const add = (
    values: unknown,
    source: AgentTool["source"],
    path: string,
    projectScope = false,
  ) => {
    for (const [name, config] of Object.entries(record(values))) {
      const item = serverItem(name, config, source, path);
      if (disabled.has(name) || (projectScope && rejectedProject.has(name)))
        item.state = "disabled";
      found.set(name, item);
    }
  };
  // Claude's whole-entry precedence: local > project > user > plugins.
  add(userData.mcpServers, "personal", files.userFile);
  if (project.status === "fulfilled")
    add(project.value.mcpServers, "repo", join(cwd, ".mcp.json"), true);
  add(local.mcpServers, "repo", files.userFile);
  if (
    managed.status === "fulfilled" &&
    Object.hasOwn(managed.value, "mcpServers")
  ) {
    found.clear();
    add(managed.value.mcpServers, "managed", files.managedMcp!);
  } else {
    for (const value of settingsList)
      add(value.managedMcpServers, "managed", "Claude managed settings");
  }
  servers.items = [...found.values()];
  if (
    servers.error ||
    settingsList.some((s) => s.allowedMcpServers || s.deniedMcpServers)
  ) {
    for (const item of servers.items)
      if (item.state !== "disabled") item.state = "unknown";
  }

  // Installed plugin metadata gives precise roots, without scanning arbitrary cache trees.
  try {
    const installed = await readConfig(
      join(files.configDir, "plugins", "installed_plugins.json"),
    );
    const enabled = Object.assign(
      {},
      ...settingsList.map((s) => record(s.enabledPlugins)),
    ) as Record<string, unknown>;
    const overrides = await readSkillOverrides(files.settingsFiles);
    let pluginError = false;
    for (const [id, entries] of Object.entries(record(installed.plugins))) {
      try {
        if (!Array.isArray(entries)) continue;
        const entry = entries
          .map(record)
          .find(
            (e) =>
              typeof e.installPath === "string" &&
              isAbsolute(e.installPath) &&
              (e.scope === "user" ||
                e.scope === "managed" ||
                (typeof e.projectPath === "string" &&
                  resolve(e.projectPath) === resolve(cwd))),
          );
        if (!entry || typeof entry.installPath !== "string") continue;
        const pluginName = id.split("@")[0];
        if (!(
          managed.status === "fulfilled" &&
          Object.hasOwn(managed.value, "mcpServers")
        )) {
          const manifest = await readConfig(
            join(entry.installPath, ".claude-plugin", "plugin.json"),
          );
          const pluginMcpFile = join(entry.installPath, ".mcp.json");
          const pluginConfig = await readConfig(pluginMcpFile);
          const definitions = {
            ...record(pluginConfig.mcpServers ?? pluginConfig),
            ...record(manifest.mcpServers),
          };
          for (const [serverName, raw] of Object.entries(definitions)) {
            const name = `plugin:${pluginName}:${serverName}`;
            const item = serverItem(
              name,
              raw,
              "plugins",
              Object.hasOwn(record(manifest.mcpServers), serverName)
                ? join(entry.installPath, ".claude-plugin", "plugin.json")
                : pluginMcpFile,
            );
            item.state =
              enabled[id] === false || disabled.has(name)
                ? "disabled"
                : "unknown";
            item.detail =
              "Provided by an installed plugin. Its availability depends on plugin settings and session-time resolution. No server was started to inspect it.";
            servers.items.push(item);
          }
        }
        const pluginSkills = await discoverClaudeSkills(entry.installPath);
        for (const skill of pluginSkills) {
          const name = `${pluginName}:${skill.name}`;
          const override = overrides.get(name);
          const item = skillItem({
            ...skill,
            name,
            scope: "plugins",
            enabled: enabled[id] !== false && override?.enabled !== false,
          });
          if (
            enabled[id] !== true &&
            enabled[id] !== false &&
            item.state !== "disabled"
          )
            item.state = "unknown";
          skills.items.push(item);
        }
      } catch {
        pluginError = true;
      }
    }
    skills.note =
      "Includes repository, personal and installed plugin skills. A plugin with no explicit enable setting is marked Unknown. Runtime-only skills may be added by Claude.";
    if (pluginError) {
      skills.note += " Some installed plugin metadata could not be read.";
      servers.note += " Some installed plugin metadata could not be read.";
    }
  } catch {
    servers.note += " Some installed plugin metadata could not be read.";
    skills.note =
      "Repository and personal skills are listed. Installed plugin metadata could not be read.";
  }
  if (settingsIncomplete) {
    skills.error =
      "Some skill settings could not be read. Enable status may be incomplete.";
    for (const item of skills.items) item.state = "unknown";
  }
  return { skills, servers };
}

/**
 * Claude's own entry for the checkout. It keys projects by path, with forward
 * slashes on Windows, so the same folder may be spelled another way here.
 */
function projectEntry(projects: Record<string, unknown>, cwd: string) {
  if (Object.hasOwn(projects, cwd)) return record(projects[cwd]);
  const key = (path: string) => {
    const slashed = path.replaceAll("\\", "/").replace(/\/+$/, "");
    return process.platform === "win32" ? slashed.toLowerCase() : slashed;
  };
  const wanted = key(cwd);
  const found = Object.keys(projects).find((k) => key(k) === wanted);
  return record(found ? projects[found] : undefined);
}
