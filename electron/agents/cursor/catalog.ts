import { memoOnce } from "../../memo";
import type { AgentDefaults, AgentModel } from "../../../shared/agents";
import type { ProviderCommand } from "../../../shared/commands";
import {
  modelSchema,
  reasoningEffortSchema,
  type ReasoningEffort,
} from "../../../shared/settings";
import { cursorFileCommands } from "./commands";
import { cursorCall } from "./connection";
import type { CursorModel } from "./protocol";
import { currentSdk } from "./sdk";

/** The model Cursor picks for whoever doesn't pick one. */
const defaultModel = "auto";
const effortParameter = /effort|reason|think/i;

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Who makes a model, read from its name and id, since the SDK doesn't say. */
const makers: [RegExp, string][] = [
  [/composer|^auto|cursor/, "Cursor"],
  [/claude|opus|sonnet|haiku/, "Anthropic"],
  [/gpt|codex|^o\d|openai/, "OpenAI"],
  [/gemini|gemma/, "Google"],
  [/grok/, "xAI"],
  [/kimi|moonshot/, "Moonshot"],
  [/deepseek/, "DeepSeek"],
  [/glm|zai/, "Z.ai"],
  [/qwen/, "Alibaba"],
];
const makerOf = (model: { id: string; name: string }) => {
  const text = `${model.name} ${model.id}`.toLowerCase().trim();
  return makers.find(([pattern]) => pattern.test(text))?.[1] ?? "Other";
};

/** One SDK model as the picker lists it; its effort levels are the settings that name one. */
function agentModelOf(model: CursorModel): AgentModel {
  const parameter = model.parameters.find((p) => effortParameter.test(p.id));
  const efforts = (parameter?.values ?? []).flatMap((v): ReasoningEffort[] => {
    const effort = reasoningEffortSchema.safeParse(v).data;
    return effort ? [effort] : [];
  });
  const fallback = model.defaults.find((d) => d.id === parameter?.id)?.value;
  const defaultEffort = reasoningEffortSchema.safeParse(fallback).data;
  return {
    id: model.id,
    name: model.name,
    description: model.description.slice(0, 300),
    group: makerOf(model),
    efforts,
    ...(defaultEffort ? { defaultEffort } : {}),
  };
}

/**
 * The models Cursor offers this account. Asked again after a minute. It won't
 * download the SDK to answer: that's Settings' job, and an unset Cursor just
 * has no models yet.
 */
export const cursorModels = memoOnce(async (): Promise<AgentModel[]> => {
  const sdk = await currentSdk();
  if (!sdk) throw new Error("Cursor isn't set up yet.");
  const found = await cursorCall(sdk, "models", {});
  return found
    .filter((model) => modelSchema.safeParse(model.id).success)
    .map(agentModelOf)
    .sort((a, b) => byName(a.group!, b.group!) || byName(a.name, b.name));
});

/** Forgets the list, e.g. after signing in as someone else. */
export const forgetCursorModels = cursorModels.forget;

export async function cursorDefaults(): Promise<AgentDefaults | null> {
  const models = await cursorModels().catch(() => []);
  return {
    model: models.some((m) => m.id === defaultModel) ? defaultModel : "",
    effort: "",
  };
}

/** Cursor's SDK doesn't list commands, so they're read from the folders it reads. */
export const cursorCommands = (root: string): Promise<ProviderCommand[]> =>
  cursorFileCommands(root);
