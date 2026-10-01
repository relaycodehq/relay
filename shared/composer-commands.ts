import { runtimeModes, type RuntimeMode } from "./agent-modes";
import {
  agentName,
  agentProviders,
  agents,
  type AgentModel,
  type AgentProvider,
} from "./agents";
import type { ComposerCommand } from "./commands";
import {
  claudeEffortsFor,
  modelSchema,
  reasoningEffortsFor,
  withClaudeContextWindow,
  type ReasoningEffort,
} from "./settings";

/** Who a composer's message goes to; "message" is a note no agent answers. */
export type ComposerTarget = AgentProvider | "message";
/** What a desktop composer can send to; the phone only sends to agents. */
export const composerTargets: readonly ComposerTarget[] = [
  ...agentProviders,
  "message",
];

/** Each agent's models as far as they are known; Claude's say which also run with 1M. */
export type ModelCatalogs = Partial<
  Record<
    AgentProvider,
    readonly (AgentModel & { longContext?: boolean })[] | undefined
  >
>;

/**
 * The efforts an agent's model takes. A Codex or Claude model they don't list
 * takes every level; any other agent's, Default included, takes none.
 */
export function modelEfforts(
  provider: AgentProvider,
  model: string,
  catalogs: ModelCatalogs,
): ReasoningEffort[] {
  const models = catalogs[provider];
  if (provider === "codex") return reasoningEffortsFor(model, models);
  if (provider === "claude") return claudeEffortsFor(models, model);
  return models?.find((m) => m.id === model)?.efforts ?? [];
}

export interface ModelOption {
  provider: AgentProvider;
  /** A model id, or "default" for the agent's Default. */
  value: string;
  description: string;
}

/** Every model /model can switch to: the recipient's, its Default, then the rest. */
export function modelCommandOptions(
  recipient: ComposerTarget,
  catalogs: ModelCatalogs,
  /** The model each agent's Default runs, by name. */
  defaultNames: Partial<Record<AgentProvider, string>> = {},
): ModelOption[] {
  const listed = agentProviders.flatMap((provider) =>
    (catalogs[provider] ?? []).flatMap((m) => {
      const long = withClaudeContextWindow(m.id, "1m");
      return [
        { provider, value: m.id, description: m.name },
        ...(m.longContext && !catalogs[provider]?.some((o) => o.id === long)
          ? [{ provider, value: long, description: `${m.name} · 1M context` }]
          : []),
      ];
    }),
  );
  return [
    ...listed.filter((m) => m.provider === recipient),
    ...(recipient === "message"
      ? []
      : [
          {
            provider: recipient,
            value: "default",
            description: defaultNames[recipient]
              ? `${agentName(recipient)} default · ${defaultNames[recipient]}`
              : `${agentName(recipient)} default`,
          },
        ]),
    ...listed.filter((m) => m.provider !== recipient),
  ];
}

/** A composer's settings as its commands see them. */
export interface CommandSettings<T extends ComposerTarget = ComposerTarget> {
  recipient: T;
  /** What /provider may switch to. */
  targets: readonly T[];
  /** The recipient's model; "" is its Default. */
  model: string;
  fast: boolean;
  plan: boolean;
  catalogs: ModelCatalogs;
  defaultNames?: Partial<Record<AgentProvider, string>>;
}

/**
 * What a command changes. Each composer keeps its settings in its own shape,
 * so it applies the change itself.
 */
export type ComposerChange<T extends ComposerTarget = ComposerTarget> =
  | { command: "provider"; provider: T }
  /** The model goes to `provider`, which becomes the recipient; "" is Default. */
  | { command: "model"; provider: AgentProvider; model: string }
  | { command: "effort"; reasoningEffort: ReasoningEffort }
  | { command: "permissions"; runtimeMode: RuntimeMode }
  | { command: "plan"; plan: boolean }
  | { command: "fast"; fast: boolean };

const noAgent = "Choose an agent before changing agent settings.";

/**
 * A composer command's change to `settings`, or why it can't make one. A
 * command left without a value gets an error here; a composer that opens a
 * picker for it instead checks first.
 */
export function composerCommand<T extends ComposerTarget>(
  command: ComposerCommand,
  args: string,
  settings: CommandSettings<T>,
): ComposerChange<T> | string {
  const value = args.toLowerCase();
  const recipient: ComposerTarget = settings.recipient;
  if (command === "provider") {
    const provider = settings.targets.find((p) => p === value);
    return provider
      ? { command, provider }
      : `Choose one of: ${settings.targets.join(", ")}.`;
  }
  if (command === "model") {
    const option = modelCommandOptions(
      recipient,
      settings.catalogs,
      settings.defaultNames,
    ).find(
      (o) =>
        o.value.toLowerCase() === value ||
        o.description.toLowerCase() === value,
    );
    const model = option
      ? option.value === "default"
        ? ""
        : option.value
      : modelSchema.safeParse(args).data;
    const provider = option?.provider ?? recipient;
    if (model === undefined) return "Enter a valid model ID.";
    if (provider === "message") return noAgent;
    return { command, provider, model };
  }
  if (recipient === "message") return noAgent;
  if (
    args &&
    (command === "plan" || command === "fast") &&
    value !== "on" &&
    value !== "off"
  )
    return `Use /${command} on or /${command} off.`;
  const toggled = (on: boolean) =>
    value === "on" ? true : value === "off" ? false : !on;
  if (command === "effort") {
    const allowed = [
      "default",
      ...modelEfforts(recipient, settings.model, settings.catalogs),
    ];
    if (!allowed.includes(value))
      return `Choose one of: ${allowed.join(", ")}.`;
    return {
      command,
      reasoningEffort: value === "default" ? "" : (value as ReasoningEffort),
    };
  }
  if (command === "permissions") {
    const mode = runtimeModes.find(
      (m) => m.value === value || m.label.toLowerCase() === value,
    );
    if (!mode)
      return `Choose one of: ${runtimeModes.map((m) => m.value).join(", ")}.`;
    return { command, runtimeMode: mode.value };
  }
  if (command === "plan") return { command, plan: toggled(settings.plan) };
  if (!agents[recipient].fast)
    return `Fast mode is only available for ${agentProviders
      .filter((p) => agents[p].fast)
      .map(agentName)
      .join(" and ")}.`;
  return { command, fast: toggled(settings.fast) };
}
