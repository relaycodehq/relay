import type { CodexSkill } from "./provider-commands";
import type { ProviderCommand } from "../../shared/commands";

/** A skill an agent offers, as T3 Code's providers report one. */
export interface AgentSkill {
  /** What `$name` names, and what the agent runs it by. */
  name: string;
  path: string;
  /** Switched off in the agent's settings, so it won't run. */
  enabled: boolean;
  scope?: string;
  description?: string;
  shortDescription?: string;
  displayName?: string;
  /** The agent itself may not start it (Claude Code's `disable-model-invocation`). */
  userInvocationOnly?: true;
  /** Only the agent may start it (Claude Code's `user-invocable: false`). */
  userInvocable?: false;
}

/** Whether a pick can start the skill: switched on, and not kept for the agent. */
export const pickable = (
  skill: Pick<AgentSkill, "enabled" | "userInvocable">,
) => skill.enabled && skill.userInvocable !== false;

type Source = NonNullable<ProviderCommand["source"]>;

/** The scope names agents report, by the section the skill picker files them under. */
const scopeNames: [Source, string[]][] = [
  ["repo", ["repo", "repository"]],
  ["project", ["project", "workspace", "local"]],
  ["personal", ["user", "personal"]],
  ["system", ["system"]],
];
const sourceOfScope = new Map(
  scopeNames.flatMap(([source, names]) =>
    names.map((name) => [name, source] as const),
  ),
);

/** Whether a skill came with a plugin, by where Codex or a shared `.agents` keeps them. */
export const pluginSkill = (skill: Pick<AgentSkill, "path">) =>
  /\/\.(?:codex|agents)\/plugins\//.test(skill.path.replaceAll("\\", "/"));

function skillSource(skill: AgentSkill): Source {
  if (pluginSkill(skill)) return "app";
  const scope = skill.scope?.trim().toLowerCase() ?? "";
  return sourceOfScope.get(scope) ?? "other";
}

/** The picker's row for a skill; `name` stays the id the agent knows it by. */
export function presentSkill(skill: AgentSkill): ProviderCommand {
  return {
    name: skill.name,
    skill: true,
    ...(skill.displayName?.trim()
      ? { displayName: skill.displayName.trim() }
      : {}),
    source: skillSource(skill),
    description: (
      skill.shortDescription ||
      skill.description ||
      (skill.scope ? `${skill.scope} skill` : "Run provider skill")
    ).slice(0, 300),
  };
}

/** The rows for the skills a user may pick, once per name. */
export const skillCommands = (skills: readonly AgentSkill[]) => {
  const seen = new Set<string>();
  return skills.filter(pickable).flatMap((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [presentSkill(skill)];
  });
};

/** A skill as Codex's `skills/list` reports it. */
export function codexSkill(skill: CodexSkill): AgentSkill {
  const short =
    skill.shortDescription ?? skill.interface?.shortDescription ?? undefined;
  return {
    name: skill.name,
    path: skill.path,
    enabled: skill.enabled !== false,
    ...(skill.description ? { description: skill.description } : {}),
    ...(skill.scope ? { scope: skill.scope } : {}),
    ...(skill.interface?.displayName
      ? { displayName: skill.interface.displayName }
      : {}),
    ...(short ? { shortDescription: short } : {}),
  };
}
