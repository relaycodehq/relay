import type { CodexSkill } from "./provider-commands";
import type { ProviderCommand } from "../../shared/commands";

type Source = NonNullable<ProviderCommand["source"]>;

/** The scope names Codex reports, by the section the skill picker files them under. */
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

function skillSource(skill: CodexSkill): Source {
  const path = skill.path.replaceAll("\\", "/");
  if (["/.codex/plugins/", "/.agents/plugins/"].some((d) => path.includes(d)))
    return "app";
  const scope = skill.scope?.trim().toLowerCase() ?? "";
  return sourceOfScope.get(scope) ?? "other";
}

/** `pdf-tools:extract_text` reads as "Pdf Tools Extract Text". */
const titleCase = (name: string) =>
  name
    .replace(/[\s:_-]+/g, " ")
    .trim()
    .replace(
      /(^| )(.)/g,
      (_, gap: string, first: string) => gap + first.toUpperCase(),
    );

/** The picker's row for a skill; `name` stays the id Codex knows it by, never the label. */
export function presentSkill(skill: CodexSkill): ProviderCommand {
  return {
    name: "skill:" + skill.name,
    displayName: skill.interface?.displayName?.trim() || titleCase(skill.name),
    source: skillSource(skill),
    description:
      skill.shortDescription ||
      skill.interface?.shortDescription ||
      skill.description ||
      "Codex skill",
  };
}
