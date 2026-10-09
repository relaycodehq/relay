import type { ProviderCommand } from "../../../shared/commands";
import type { AcpProvider } from "./profiles";
import { parseUpdate } from "./protocol";

/** The slash commands each agent listed last, in any of its sessions. */
const heard = new Map<AcpProvider, ProviderCommand[]>();

/** Keeps the commands an `available_commands_update` lists. */
export function hearCommands(provider: AcpProvider, raw: unknown) {
  const update = parseUpdate(raw);
  if (update?.sessionUpdate !== "available_commands_update") return;
  heard.set(
    provider,
    update.availableCommands.map((command) => ({
      name: command.name.replace(/^\//, ""),
      description: (command.description ?? "").slice(0, 300),
      source: "other",
      ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
    })),
  );
}

export const heardCommands = (provider: AcpProvider) => heard.get(provider);
