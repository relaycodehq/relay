import { memoOnce } from "../../util/memo";
import type { AgentDefaults, AgentModel } from "../../../shared/agents";
import type { ProviderCommand } from "../../../shared/commands";
import {
  modelSchema,
  reasoningEffortSchema,
  type ReasoningEffort,
} from "../../../shared/settings";
import { openCode } from "./client";

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** OpenCode names a model `provider/model`, e.g. `openrouter/anthropic/claude-opus-5`. */
export function splitModel(
  id: string,
): { providerID: string; modelID: string } | undefined {
  const slash = id.indexOf("/");
  return slash > 0 && slash < id.length - 1
    ? { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) }
    : undefined;
}

type ProviderList = {
  all: {
    id: string;
    name: string;
    models: Record<
      string,
      {
        id: string;
        name: string;
        status?: string;
        capabilities?: { toolcall?: boolean };
        limit?: { context?: number };
        variants?: Record<string, unknown>;
      }
    >;
  }[];
  connected: string[];
};

/**
 * Anthropic's own models run through Relay's Claude agent, with its sign-in
 * and features; through OpenCode a Claude subscription is refused. Claude
 * models other providers resell, e.g. OpenRouter's, stay.
 */
const hidden = new Set(["anthropic"]);

/**
 * The models of the upstream providers OpenCode is signed in to. Asked again
 * after a minute, since connecting a provider in OpenCode adds its models.
 */
export const openCodeModels = memoOnce(async (): Promise<AgentModel[]> => {
  const { all, connected } = await openCode<ProviderList>("GET", "/provider");
  const signedIn = new Set(connected);
  return all
    .filter((provider) => signedIn.has(provider.id) && !hidden.has(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models).flatMap((model): AgentModel[] => {
        const id = `${provider.id}/${model.id}`;
        // Agents need tools; embedding, image and speech models have none.
        if (
          !modelSchema.safeParse(id).success ||
          !model.capabilities?.toolcall ||
          !model.limit?.context
        )
          return [];
        return [
          {
            id,
            name: model.name || model.id,
            // A reseller's model id names its maker, e.g. `anthropic/…`.
            description: model.id.includes("/")
              ? model.id.slice(0, model.id.indexOf("/")).replace(/^~/, "")
              : "",
            group: provider.name,
            efforts: Object.keys(model.variants ?? {}).flatMap(
              (v): ReasoningEffort[] => {
                const effort = reasoningEffortSchema.safeParse(v).data;
                return effort ? [effort] : [];
              },
            ),
            ...(model.status === "deprecated" ? { legacy: true } : {}),
            contextWindow: model.limit.context,
          },
        ];
      }),
    )
    .sort((a, b) => byName(a.group!, b.group!) || byName(a.name, b.name));
});

/** The model OpenCode's config gives sessions in `root` that name none. */
export async function openCodeDefaults(root: string): Promise<AgentDefaults> {
  const config = await openCode<{ model?: string }>("GET", "/config", {
    directory: root,
  });
  return {
    model: modelSchema.safeParse(config.model).data ?? "",
    effort: "",
  };
}

/** OpenCode's commands and skills in `root`, for the composer's `/` menu. */
export async function openCodeCommands(
  root: string,
): Promise<ProviderCommand[]> {
  const commands = await openCode<
    { name: string; description?: string; source?: string; hints?: string[] }[]
  >("GET", "/command", { directory: root });
  return commands
    .filter((c) => /^[a-zA-Z0-9_.:-]+$/.test(c.name))
    .slice(0, 500)
    .map((c) => ({
      name: c.name,
      source: "other" as const,
      description: (c.description ?? "").slice(0, 300),
      ...(c.hints?.length
        ? { argumentHint: c.hints.join(" ").slice(0, 80) }
        : {}),
    }));
}
