import type { AgentModel } from "../../../shared/agents";
import {
  reasoningEffortSchema,
  type ModelChoice,
  type ReasoningEffort,
} from "../../../shared/settings";
import type { AcpConnection } from "./connection";
import type { AcpWish } from "./profiles";
import {
  choicesOf,
  configOptionSchema,
  type AcpConfigOption,
} from "./protocol";
import type { AcpSettings } from "./sessions";

/** Where `base` keeps the model of the older model list, which isn't a config option. */
const legacyModel = "\0model";

const optionIn = (settings: AcpSettings, category: string) =>
  settings.configOptions?.find((o) => o.category === category);

/** The efforts a `thought_level` option offers, when they're all efforts Relay knows. */
function effortsOf(settings: AcpSettings): ReasoningEffort[] {
  const option = optionIn(settings, "thought_level");
  if (!option) return [];
  const values = choicesOf(option).map((c) => c.value);
  const efforts = values.flatMap((v) => reasoningEffortSchema.safeParse(v).data ?? []);
  return efforts.length === values.length ? efforts : [];
}

/** The models a session offers, from its model option or the older model list. */
export function modelsOf(settings: AcpSettings): AgentModel[] {
  const efforts = effortsOf(settings);
  const option = optionIn(settings, "model");
  const listed = option
    ? choicesOf(option).map((c) => ({ id: c.value, name: c.name, description: c.description }))
    : (settings.models?.availableModels ?? []).map((m) => ({
        id: m.modelId,
        name: m.name || m.modelId,
        description: m.description ?? undefined,
      }));
  return listed.map((m) => ({
    id: m.id,
    name: m.name,
    description: (m.description ?? "").slice(0, 300),
    efforts,
  }));
}

/** The model a session runs and its effort, as it says. */
export function currentOf(settings: AcpSettings) {
  const model = optionIn(settings, "model")?.currentValue ?? settings.models?.currentModelId;
  const effort = reasoningEffortSchema.safeParse(
    optionIn(settings, "thought_level")?.currentValue,
  ).data;
  return {
    model: typeof model === "string" ? model : "",
    effort: effort ?? ("" as const),
  };
}

/**
 * Puts a session's settings where a turn wants them: its approval mode, then
 * its model and effort. Left on Default, a model or effort goes back to what
 * the session started with. Settings the agent doesn't offer are skipped.
 */
export async function applySettings(
  connection: AcpConnection,
  session: { id: string; settings: AcpSettings; base?: Record<string, string> },
  wishes: AcpWish[],
  choice: ModelChoice,
) {
  const sessionId = session.id;
  const { settings } = session;
  const base = (session.base ??= Object.fromEntries([
    ...(settings.configOptions ?? []).flatMap((o) =>
      typeof o.currentValue === "string" ? [[o.id, o.currentValue]] : [],
    ),
    ...(settings.models?.currentModelId
      ? [[legacyModel, settings.models.currentModelId]]
      : []),
  ]));
  const setOption = async (option: AcpConfigOption, value: string) => {
    if (option.currentValue === value) return;
    const reply = (await connection.request("session/set_config_option", {
      sessionId,
      configId: option.id,
      value,
    })) as { configOptions?: unknown } | null;
    const next = configOptionSchema.array().safeParse(reply?.configOptions).data;
    if (next) settings.configOptions = next;
    else option.currentValue = value;
  };
  const offers = (option: AcpConfigOption, value: string) =>
    choicesOf(option).some((c) => c.value === value);

  for (const wish of wishes) {
    // The first value the agent offers, by config option or else by mode.
    const values = typeof wish.value === "string" ? [wish.value] : wish.value;
    const found = values
      .map((value) => ({
        value,
        option: settings.configOptions?.find(
          (o) => (o.id === wish.option || o.category === wish.option) && offers(o, value),
        ),
      }))
      .find((f) => f.option);
    if (found?.option) {
      await setOption(found.option, found.value);
      continue;
    }
    const modes = settings.modes;
    const mode =
      wish.option === "mode" &&
      values.find((value) => modes?.availableModes.some((m) => m.id === value));
    if (modes && mode && modes.currentModeId !== mode) {
      await connection.request("session/set_mode", { sessionId, modeId: mode });
      modes.currentModeId = mode;
    }
  }

  const modelOption = optionIn(settings, "model");
  const model = choice.model || (modelOption ? base[modelOption.id] : undefined);
  if (modelOption && model && offers(modelOption, model)) await setOption(modelOption, model);
  else if (!modelOption && settings.models) {
    const models = settings.models;
    const wanted = choice.model || base[legacyModel];
    if (wanted && models.currentModelId !== wanted && models.availableModels.some((m) => m.modelId === wanted)) {
      await connection.request("session/set_model", { sessionId, modelId: wanted });
      models.currentModelId = wanted;
    }
  }

  // Read again: a model change can bring other effort levels.
  const effortOption = optionIn(settings, "thought_level");
  const effort = choice.reasoningEffort || (effortOption ? base[effortOption.id] : undefined);
  if (effortOption && effort && offers(effortOption, effort)) await setOption(effortOption, effort);
}
