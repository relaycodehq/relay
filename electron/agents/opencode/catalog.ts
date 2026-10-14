import { findExecutable, runExecutable } from "../../platform/executables";
import { memoOnce } from "../../util/memo";
import type { AgentDefaults, AgentModel } from "../../../shared/agents";
import type { ProviderCommand } from "../../../shared/commands";
import {
  modelSchema,
  reasoningEffortSchema,
  type ReasoningEffort,
} from "../../../shared/settings";
import { disposeOpenCode, openCode } from "./client";
import { skillCommands } from "../skill-presentation";
import {
  commandListSchema,
  skillListSchema,
  configSchema,
  parseOpenCodeResponse,
  providerListSchema,
  providerSchema,
} from "./events";

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
  const { all, connected } = parseOpenCodeResponse(
    "provider list",
    providerListSchema,
    await openCode("GET", "/provider"),
  );
  const signedIn = new Set(connected);
  return all
    .filter((entry) => signedIn.has(entry.id) && !hidden.has(entry.id))
    .map((entry) =>
      parseOpenCodeResponse(`${entry.id} provider`, providerSchema, entry),
    )
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
            group: provider.name ?? provider.id,
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

/**
 * Fetches models.dev afresh, which OpenCode does itself only hourly. The
 * server reads that list once, as it starts, so `restart` starts it again;
 * whatever it was running loses its connection.
 */
export async function refreshOpenCodeModels(restart: () => Promise<void>) {
  const done = await runExecutable(
    await findExecutable("opencode"),
    ["models", "--refresh"],
    60_000,
  );
  if (done.code !== 0)
    throw new Error(
      done.timedOut
        ? "OpenCode took too long to fetch its models."
        : `OpenCode couldn't fetch its models: ${done.output.trim().split("\n").at(-1) ?? ""}`,
    );
  await restart();
  disposeOpenCode("OpenCode restarted to load new models.");
  openCodeModels.forget();
}

/** The model OpenCode's config gives sessions in `root` that name none. */
export async function openCodeDefaults(root: string): Promise<AgentDefaults> {
  const config = parseOpenCodeResponse(
    "config",
    configSchema,
    await openCode("GET", "/config", { directory: root }),
  );
  return {
    model: modelSchema.safeParse(config.model).data ?? "",
    effort: "",
  };
}

/**
 * OpenCode's commands and skills in `root`, for the composer's menus. A skill
 * it also lists as a command is offered as the skill.
 */
export async function openCodeCommands(
  root: string,
): Promise<ProviderCommand[]> {
  const [commands, skills] = await Promise.all([
    openCode("GET", "/command", { directory: root }).then((r) =>
      parseOpenCodeResponse("command list", commandListSchema, r),
    ),
    openCode("GET", "/skill", { directory: root })
      .then((r) => parseOpenCodeResponse("skill list", skillListSchema, r))
      .catch(() => []),
  ]);
  return [
    ...commands
      .filter((c) => /^[a-zA-Z0-9_.:-]+$/.test(c.name) && c.source !== "skill")
      .slice(0, 500)
      .map((c) => ({
        name: c.name,
        source: "other" as const,
        description: (c.description ?? "").slice(0, 300),
        ...(c.hints?.length
          ? { argumentHint: c.hints.join(" ").slice(0, 80) }
          : {}),
      })),
    ...skillCommands(
      skills
        .filter((s) => s.name.trim() && s.location.trim())
        .map((s) => ({
          name: s.name.trim(),
          path: s.location.trim(),
          enabled: true,
          ...(s.description?.trim()
            ? { description: s.description.trim() }
            : {}),
        })),
    ),
  ];
}
