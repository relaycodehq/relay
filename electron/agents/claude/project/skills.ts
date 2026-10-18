// Claude Code's skills for a folder, found on disk as T3 Code finds them
// (its ClaudeSkills). The CLI's own listings leave some out: its commands
// lack `user-invocable: false` skills, and the model's list lacks
// `disable-model-invocation: true` ones.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import {
  skillFrontmatter,
  textField,
  yamlBoolean,
} from "../../skill-frontmatter";
import type { AgentSkill } from "../../skill-presentation";

/** Where an administrator's Claude Code policy files live, if this platform has one. */
export function claudeManagedDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform !== "win32") return "/etc/claude-code";
  const data = env.PROGRAMDATA?.trim();
  return data ? join(data, "ClaudeCode") : undefined;
}

/**
 * The settings files Claude Code merges `skillOverrides` from, weakest first:
 * the user's, the folder's shared and local ones, the repository root's local
 * one when the folder sits deeper (its plain settings.json isn't read), and
 * the administrator's managed policy, which wins outright.
 */
export function skillOverrideFiles(
  configDir: string,
  cwd: string | undefined,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  const root = cwd ? repositoryRoot(cwd) : undefined;
  const managedDir = claudeManagedDir(platform, env);
  const managed = managedDir && join(managedDir, "managed-settings.json");
  return [
    join(configDir, "settings.json"),
    ...(cwd
      ? [
          join(cwd, ".claude", "settings.json"),
          join(cwd, ".claude", "settings.local.json"),
        ]
      : []),
    ...(root && root !== resolve(cwd!)
      ? [join(root, ".claude", "settings.local.json")]
      : []),
    ...(managed ? [managed] : []),
  ];
}

/** The nearest folder from `cwd` up that holds `.git`. */
function repositoryRoot(cwd: string) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

type Override = { enabled: boolean; userInvocationOnly: boolean };
const overrideValues: Record<string, Override> = {
  on: { enabled: true, userInvocationOnly: false },
  "name-only": { enabled: true, userInvocationOnly: false },
  "user-invocable-only": { enabled: true, userInvocationOnly: true },
  off: { enabled: false, userInvocationOnly: false },
};

/**
 * Each skill's `skillOverrides` entry, the strongest file's. Claude Code
 * checks a file's whole map: one unknown value drops every entry in it.
 */
export async function readSkillOverrides(files: readonly string[]) {
  const overrides = new Map<string, Override>();
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    // JSON with comments and trailing commas, as Claude Code reads its settings.
    const errors: ParseError[] = [];
    const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
    if (errors.length) continue;
    const map = (parsed as { skillOverrides?: unknown } | null)?.skillOverrides;
    if (typeof map !== "object" || map === null || Array.isArray(map)) continue;
    const entries = Object.entries(map);
    if (
      entries.some(([, v]) => typeof v !== "string" || !(v in overrideValues))
    )
      continue;
    for (const [name, value] of entries)
      overrides.set(name, overrideValues[value as string]);
  }
  return overrides;
}

/**
 * Claude Code's skills for `cwd`: `<config>/skills`, then `cwd`'s
 * `.claude/skills`. The user's copy of a name wins, as in the CLI. A skill is
 * named by its folder, which `/name` runs even when its frontmatter names it
 * otherwise; a skill whose frontmatter doesn't parse isn't loaded at all.
 */
export async function discoverClaudeSkills(
  configDir: string,
  cwd?: string,
): Promise<AgentSkill[]> {
  // The CLI reads a relative CLAUDE_CONFIG_DIR from its own folder.
  const config =
    cwd && !isAbsolute(configDir) ? resolve(cwd, configDir) : configDir;
  const overrides = await readSkillOverrides(skillOverrideFiles(config, cwd));
  const roots = [
    { dir: join(config, "skills"), scope: "user" },
    ...(cwd ? [{ dir: join(cwd, ".claude", "skills"), scope: "project" }] : []),
  ];
  const found = new Map<string, AgentSkill>();
  for (const root of roots) {
    const entries = await readdir(root.dir).catch(() => [] as string[]);
    for (const entry of entries.sort()) {
      const path = join(root.dir, entry, "SKILL.md");
      const text = await readFile(path, "utf8").catch(() => undefined);
      if (text === undefined) continue;
      const frontmatter = skillFrontmatter(text, true);
      if (frontmatter.kind === "malformed") continue;
      const name = entry.trim();
      if (!name || found.has(name)) continue;
      const fields = frontmatter.kind === "parsed" ? frontmatter.fields : {};
      const override = overrides.get(name);
      const description = textField(fields, "description");
      found.set(name, {
        name,
        path,
        enabled: override?.enabled ?? true,
        scope: root.scope,
        ...(description ? { description } : {}),
        ...(yamlBoolean(fields["disable-model-invocation"]) === true ||
        override?.userInvocationOnly
          ? { userInvocationOnly: true }
          : {}),
        ...(yamlBoolean(fields["user-invocable"]) === false
          ? { userInvocable: false }
          : {}),
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
