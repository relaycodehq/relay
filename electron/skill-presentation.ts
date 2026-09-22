// Adapted from T3 Code packages/client-runtime/src/providerSkills.ts (MIT).
// See THIRD_PARTY_NOTICES.md. Keep provider IDs separate from display labels.
import type { CodexSkill } from "./provider-commands";
import type { ProviderCommand } from "../shared/commands";
export function presentSkill(skill: CodexSkill): ProviderCommand {
  const path = skill.path.replaceAll("\\", "/");
  const scope = skill.scope?.trim().toLowerCase();
  const source =
    path.includes("/.codex/plugins/") || path.includes("/.agents/plugins/")
      ? "app"
      : scope === "repo" || scope === "repository"
        ? "repo"
        : ["project", "workspace", "local"].includes(scope ?? "")
          ? "project"
          : scope === "user" || scope === "personal"
            ? "personal"
            : scope === "system"
              ? "system"
              : "other";
  const displayName =
    skill.interface?.displayName?.trim() ||
    skill.name
      .split(/[\s:_-]+/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");
  return {
    name: "skill:" + skill.name,
    displayName,
    source,
    description:
      skill.shortDescription ||
      skill.interface?.shortDescription ||
      skill.description ||
      "Codex skill",
  };
}
