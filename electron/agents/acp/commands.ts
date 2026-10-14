import type { ProviderCommand } from "../../../shared/commands";
import type { AcpProvider } from "./profiles";
import { parseUpdate } from "./protocol";
import { skillCommands } from "../skill-presentation";

/** The slash commands each agent listed last, in any of its sessions. */
const heard = new Map<AcpProvider, ProviderCommand[]>();

/**
 * Keeps the commands an `available_commands_update` lists. One named `$name`
 * is a skill, as T3 Code reads ACP agents' lists; the first of a name counts.
 */
export function hearCommands(provider: AcpProvider, raw: unknown) {
  const update = parseUpdate(raw);
  if (update?.sessionUpdate !== "available_commands_update") return;
  const seen = new Set<string>();
  heard.set(
    provider,
    update.availableCommands.flatMap((command): ProviderCommand[] => {
      const name = command.name.replace(/^\//, "").trim();
      if (!name || seen.has(name.toLowerCase())) return [];
      seen.add(name.toLowerCase());
      const description = (command.description ?? "").slice(0, 300);
      if (name.startsWith("$"))
        return name.length > 1
          ? skillCommands([
              {
                name: name.slice(1),
                path: `acp://skill/${encodeURIComponent(name.slice(1))}`,
                scope: "agent",
                enabled: true,
                ...(description.trim() ? { description } : {}),
              },
            ])
          : [];
      return [
        {
          name,
          description,
          source: "other",
          ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
        },
      ];
    }),
  );
}

export const heardCommands = (provider: AcpProvider) => heard.get(provider);
