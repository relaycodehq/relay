import { join } from "node:path";
import type { AgentToolListing, AgentTools } from "../../../shared/agent-tools";
import { withAppServer, readCodexSkills } from "../provider-commands";
import { codexSkill } from "../skill-presentation";
import { record, serverItem, skillItem, sourceOf } from "./presentation";

/** Source metadata comes from Codex's resolved configuration, including project trust. */
export function codexServers(response: unknown): AgentToolListing {
  const answer = record(response);
  const config = record(answer.config);
  if (!answer.config || typeof answer.config !== "object")
    throw new Error("Codex did not report its configuration.");
  const origins = record(answer.origins);
  return {
    items: Object.entries(record(config.mcp_servers)).map(([name, raw]) => {
      const prefix = `mcp_servers.${name}`;
      const key =
        [`${prefix}.url`, `${prefix}.command`, prefix].find((k) =>
          Object.hasOwn(origins, k),
        ) ?? Object.keys(origins).find((k) => k.startsWith(prefix + "."));
      const layer = record(record(key ? origins[key] : undefined).name);
      const type = typeof layer.type === "string" ? layer.type : undefined;
      const file =
        typeof layer.file === "string"
          ? layer.file
          : typeof layer.dotCodexFolder === "string"
            ? join(layer.dotCodexFolder, "config.toml")
            : undefined;
      return serverItem(
        name,
        raw,
        type === "system" ? "managed" : sourceOf(type),
        file,
      );
    }),
    note: "Resolved by Codex for this checkout. Plugin-provided servers and account connectors may be added when a session starts.",
  };
}
export async function inspectCodex(
  cwd: string,
  env?: Record<string, string>,
): Promise<Pick<AgentTools, "skills" | "servers">> {
  return withAppServer(
    cwd,
    "inspecting agent tools",
    async (wire) => {
      const [skills, servers] = await Promise.allSettled([
        wire
          .request("skills/list", { cwds: [cwd], forceReload: true })
          .then((value) => ({
            items: readCodexSkills(value, cwd).map(codexSkill).map(skillItem),
          })),
        wire
          .request("config/read", { cwd, includeLayers: false })
          .then(codexServers),
      ]);
      return {
        skills:
          skills.status === "fulfilled"
            ? skills.value
            : {
                items: [],
                error: "Codex could not list its skills. Refresh to try again.",
              },
        servers:
          servers.status === "fulfilled"
            ? servers.value
            : {
                items: [],
                error:
                  "Codex could not read its MCP configuration. Refresh to try again.",
              },
      };
    },
    { env },
  );
}
