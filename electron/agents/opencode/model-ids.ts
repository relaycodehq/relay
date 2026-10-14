import type { AgentModel } from "../../../shared/agents";

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
export const hiddenProviders = new Set(["anthropic"]);

/** A reseller's model id names its maker, e.g. `~anthropic/claude-opus-latest`. */
export const makerOf = (modelID: string) =>
  modelID.includes("/")
    ? modelID.slice(0, modelID.indexOf("/")).replace(/^~/, "")
    : "";

/**
 * The providers people use most, named as models.dev names them, except Zen:
 * models.dev calls OpenCode's own gateway "OpenCode", which reads as the agent.
 * OpenCode 2 sends only ids, so any other provider is shown by its id.
 */
const providerNames = new Map(
  Object.entries({
    opencode: "OpenCode Zen",
    "opencode-go": "OpenCode Go",
    openrouter: "OpenRouter",
    openai: "OpenAI",
    google: "Google",
    "github-copilot": "GitHub Copilot",
    xai: "xAI",
    deepseek: "DeepSeek",
    moonshotai: "Moonshot AI",
    zai: "Z.AI",
    "zai-coding-plan": "Z.AI Coding Plan",
    groq: "Groq",
    mistral: "Mistral",
    "amazon-bedrock": "Amazon Bedrock",
    vercel: "Vercel AI Gateway",
  }),
);

/**
 * OpenCode 2's models, which its ACP server names `provider/Name` in one long
 * list, filed under their provider as OpenCode 1's are.
 */
export function openCode2Models(listed: AgentModel[]): AgentModel[] {
  return listed.flatMap((model) => {
    const split = splitModel(model.id);
    if (!split) return [model];
    if (hiddenProviders.has(split.providerID)) return [];
    const prefix = `${split.providerID}/`;
    return [
      {
        ...model,
        name: model.name.startsWith(prefix)
          ? model.name.slice(prefix.length)
          : model.name,
        description: model.description || makerOf(split.modelID),
        group: providerNames.get(split.providerID) ?? split.providerID,
      },
    ];
  });
}
