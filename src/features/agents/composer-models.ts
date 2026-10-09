import {
  agentProviders,
  isAgentProvider,
  isRegistryProvider,
  runnableAgents,
  type AgentModel,
  type AgentProvider,
} from "../../../shared/agents";
import type {
  NewThreadModel,
  NewThreadModels,
} from "../../../shared/new-thread-models";
import { fastFor, fitModel, windowFor } from "../../../shared/model-fit";
import {
  claudeEfforts,
  modelSchema,
  reasoningEffortSchema,
  type ModelChoice,
  type ReasoningEffort,
} from "../../../shared/settings";

/**
 * The model a composer runs each agent on, one entry per agent in the shape
 * new threads and the phone share. An agent with no entry runs its Default,
 * except Codex, whose Default follows the line-question setting.
 */
export type ComposerModels = NewThreadModels;

/**
 * Agents whose model and effort the composer checks against their catalog and
 * nothing more. Codex and Claude have settings of their own: Codex's models
 * come with its own efforts, Claude's with a context window.
 */
export const isPickAgent = (provider: string): provider is AgentProvider =>
  isAgentProvider(provider) && provider !== "codex" && provider !== "claude";
let picks: { of: readonly AgentProvider[]; list: AgentProvider[] } | undefined;
/** The agents in `isPickAgent` this Relay runs; the same array until that changes. */
export function pickAgents() {
  const runnable = runnableAgents();
  if (picks?.of !== runnable)
    picks = { of: runnable, list: runnable.filter(isPickAgent) };
  return picks.list;
}

const blankChoice: ModelChoice = {
  model: "",
  fast: false,
  reasoningEffort: "",
};
const blank: NewThreadModel = { choice: blankChoice };
export const modelOf = (
  models: ComposerModels,
  provider: AgentProvider,
): NewThreadModel => models[provider] ?? blank;

export const withModel = (
  models: ComposerModels,
  provider: AgentProvider,
  next: NewThreadModel,
): ComposerModels => ({ ...models, [provider]: fitModel(provider, next) });

/** Every agent's entry, filling in the Default for those with none. */
export const newThreadModelsOf = (models: ComposerModels): NewThreadModels =>
  Object.fromEntries(runnableAgents().map((p) => [p, modelOf(models, p)]));

/** `models` with each agent in `remembered` on its model there; the others keep theirs. */
export function withNewThreadModels(
  models: ComposerModels,
  remembered: NewThreadModels,
): ComposerModels {
  let next = models;
  for (const provider of Object.keys(remembered).filter(isAgentProvider)) {
    const entry = remembered[provider];
    if (!entry) continue;
    const { choice } = entry;
    // Codex's Default follows the line-question setting.
    if (
      provider === "codex" &&
      !choice.model &&
      !choice.reasoningEffort &&
      !choice.fast
    ) {
      const { codex: _, ...rest } = next;
      next = rest;
    } else next = withModel(next, provider, entry);
  }
  return next;
}

/** Claude's model as the composer shows it, flat. */
export const claudeOf = (models: ComposerModels) => {
  const { choice, contextWindow } = modelOf(models, "claude");
  return {
    model: choice.model,
    reasoningEffort: choice.reasoningEffort,
    ...(contextWindow ? { contextWindow } : {}),
  };
};

/**
 * Claude on `model` at `reasoningEffort`. A 200k window picked before stays,
 * except on a `[1m]` model: picking one asks for 1M.
 */
export const claudeOn = (
  current: NewThreadModel,
  model: string,
  reasoningEffort: ReasoningEffort,
): NewThreadModel => ({
  choice: { model, reasoningEffort, fast: false },
  ...windowFor("claude", model, current.contextWindow),
});

/** The model and efforts an agent in `pickAgents()` runs; "" is its Default. */
export function livePick(
  entry: NewThreadModel | undefined,
  models: AgentModel[] | undefined,
) {
  const { model, reasoningEffort } = entry?.choice ?? blankChoice;
  const efforts = models?.find((m) => m.id === model)?.efforts ?? [];
  return {
    model,
    efforts,
    // An effort the model no longer lists runs as its default.
    reasoningEffort: efforts.includes(reasoningEffort)
      ? reasoningEffort
      : ("" as const),
  };
}

/**
 * What a composer runs `provider` on: its own model and effort, Fast only if
 * it has it. Codex's is `models.codex`, which may be unset and follow a
 * setting, so a caller with that resolved passes it as `codex`.
 */
export function agentChoice(
  provider: AgentProvider,
  models: ComposerModels,
  pick: Pick<ReturnType<typeof livePick>, "model" | "reasoningEffort">,
  codex: ModelChoice = modelOf(models, "codex").choice,
): ModelChoice {
  const { choice } = modelOf(models, provider);
  const fast = fastFor(provider, choice.fast);
  if (provider === "codex")
    return { ...codex, fast: fastFor("codex", codex.fast) };
  if (provider === "claude") return { ...choice, fast };
  return { model: pick.model, reasoningEffort: pick.reasoningEffort, fast };
}

/**
 * What a message to `to` runs on, from Codex's `selected` choice, which a
 * message to people takes too. Every agent keeps its own model and effort.
 */
export function messageChoice(
  to: string,
  models: ComposerModels,
  selected: ModelChoice | undefined,
  pick: Pick<ReturnType<typeof livePick>, "model" | "reasoningEffort">,
): ModelChoice | undefined {
  if (!selected || !isAgentProvider(to)) return selected;
  return agentChoice(to, models, pick, selected);
}

export const messageContext = (to: string, models: ComposerModels) => {
  const { contextWindow } = modelOf(models, "claude");
  return to === "claude" && contextWindow ? { contextWindow } : {};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function readEffort(provider: AgentProvider, value: unknown): ReasoningEffort {
  // Claude only takes its own levels; the rest are Codex's.
  if (provider === "claude")
    return claudeEfforts.find((e) => e === value) ?? "";
  return reasoningEffortSchema.safeParse(value).data ?? "";
}

/** A model as saved, keeping the fields that read; none when it isn't one. */
function readModel(
  provider: AgentProvider,
  value: unknown,
): NewThreadModel | undefined {
  if (!isRecord(value) || !isRecord(value.choice)) return;
  const { choice } = value;
  return fitModel(provider, {
    choice: {
      model: modelSchema.safeParse(choice.model).data ?? "",
      reasoningEffort: readEffort(provider, choice.reasoningEffort),
      fast: choice.fast === true,
    },
    ...(value.contextWindow === "200k"
      ? { contextWindow: "200k" as const }
      : {}),
  });
}

/**
 * Composers saved Codex's model as `choice`, Claude's as `claude` and the
 * rest as `picks`, each with its own fields. Read as the entry that agent
 * would have in `models`.
 */
function readLegacyModel(
  provider: AgentProvider,
  saved: Record<string, unknown>,
): NewThreadModel | undefined {
  if (provider === "codex")
    return readModel(provider, { choice: saved.choice });
  if (provider === "claude")
    return readModel(provider, {
      choice: saved.claude,
      contextWindow: isRecord(saved.claude)
        ? saved.claude.contextWindow
        : undefined,
    });
  return isRecord(saved.picks)
    ? readModel(provider, { choice: saved.picks[provider] })
    : undefined;
}

/**
 * The models in a composer's saved settings. An agent's entry in `models`
 * wins; one with none there reads from the older keys, so settings saved
 * before `models` existed keep their picks.
 */
export function readComposerModels(saved: unknown): ComposerModels {
  if (!isRecord(saved)) return {};
  const current = isRecord(saved.models) ? saved.models : {};
  const models: ComposerModels = {};
  // Registry agents came after the older keys, so only `models` has theirs.
  const added = Object.keys(current).filter(
    (p) => isAgentProvider(p) && isRegistryProvider(p),
  ) as AgentProvider[];
  for (const provider of [...agentProviders, ...added]) {
    const entry =
      readModel(provider, current[provider]) ??
      readLegacyModel(provider, saved);
    if (entry) models[provider] = entry;
  }
  return models;
}
