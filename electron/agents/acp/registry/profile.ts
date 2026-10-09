import { agentName, type RegistryProvider } from "../../../../shared/agents";
import { findExecutable } from "../../../platform/executables";
import type { AcpProfile, AcpWish } from "../profiles";
import type { InstalledAgent } from "./install";

/**
 * Relay's approval modes in the words ACP agents use for theirs. Agents name
 * their modes freely, so these are the common names; the first one an agent
 * offers wins, and an agent offering none keeps its own default.
 */
export function registryWishes({
  runtime,
  interaction,
  readOnly,
}: Parameters<AcpProfile["wishes"]>[0]): AcpWish[] {
  if (readOnly || interaction === "plan")
    return [{ option: "mode", value: ["plan", "read-only", "readonly", "ask"] }];
  switch (runtime) {
    case "auto-accept-edits":
      return [
        { option: "mode", value: ["acceptEdits", "auto_edit", "autoEdit", "auto-edit", "default"] },
      ];
    case "full-access":
      return [
        {
          option: "mode",
          value: ["bypassPermissions", "yolo", "full-access", "bypass", "default"],
        },
      ];
    default:
      return [{ option: "mode", value: ["default", "ask"] }];
  }
}

/** How Relay runs an agent it installed from the ACP registry. */
export function registryProfile(
  provider: RegistryProvider,
  io: {
    installed(): Promise<InstalledAgent | undefined>;
    /** Installs it from the registry when it's missing. */
    ensure(): Promise<InstalledAgent>;
  },
): AcpProfile {
  return {
    provider,
    get name() {
      return agentName(provider);
    },
    setUp: async () => {
      await io.ensure();
    },
    command: async () => {
      const found = await io.installed();
      if (!found)
        throw new Error(
          `${agentName(provider)} isn't installed. Install it again in Settings → Agents.`,
        );
      return {
        command: found.command === "node" ? await findExecutable("node") : found.command,
        args: found.args,
        env: found.env,
      };
    },
    wishes: registryWishes,
    // Whichever sign-in it offers first.
    authMethod: async () => undefined,
    install: `Install ${agentName(provider)} in Settings → Agents.`,
  };
}
