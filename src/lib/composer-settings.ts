import {
  savedRuntimeMode,
  type InteractionMode,
  type RuntimeMode,
} from "../../shared/agent-modes";
import type { ProjectChatSend } from "../../shared/projects";
import {
  newThreadModelsSchema,
  type NewThreadModels,
} from "../../shared/new-thread-models";
import {
  agentProviders,
  isAgentProvider,
  type AgentProvider,
} from "../../shared/agents";
import {
  ultraplanKindSchema,
  type UltraplanKind,
} from "../../shared/ultraplan";
import {
  aiSettingsSchema,
  claudeEfforts,
  modelSchema,
  reasoningEffortSchema,
  type ModelChoice,
  type ReasoningEffort,
} from "../../shared/settings";

type Provider = AgentProvider | "message";
/**
 * Agents whose model and effort the composer keeps in `picks`. Codex and
 * Claude keep settings of their own: Fast mode, and the context window.
 */
export const pickAgents = agentProviders.filter(
  (p) => p !== "codex" && p !== "claude",
);
export const isPickAgent = (provider: string): provider is AgentProvider =>
  (pickAgents as string[]).includes(provider);
/** A model and effort, for an agent with no settings of its own beyond them. */
interface AgentPick {
  model: string;
  reasoningEffort: ReasoningEffort;
}
/** What a chat composer starts from: its agent, each agent's model, its modes. */
export interface ComposerSettings {
  /** The agent picked here; unset follows the default agent setting. */
  provider?: Provider;
  /** Codex's model; unset follows the line-question setting. */
  choice?: ModelChoice;
  claude: {
    model: string;
    reasoningEffort: ReasoningEffort;
    contextWindow?: "200k";
  };
  /** Every other agent's model and effort; Codex and Claude keep theirs above. */
  picks: Partial<Record<AgentProvider, AgentPick>>;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  /** Plan with a council first; see shared/ultraplan. */
  ultraplan: boolean;
  /** The council's kind, kept while Ultraplan is off. */
  council: UltraplanKind;
}
const storageKey = (key: string) => "composer-settings:" + key;
function read(key: string) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(key)) || "null");
  } catch {
    return null;
  }
}
const isProvider = (value: unknown): value is Provider =>
  value === "message" || isAgentProvider(value);
function readPicks(value: unknown): ComposerSettings["picks"] {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([provider, pick]) => {
      const model = modelSchema.safeParse(pick?.model).data ?? "";
      const reasoningEffort =
        reasoningEffortSchema.safeParse(pick?.reasoningEffort).data ?? "";
      return isAgentProvider(provider)
        ? [[provider, { model, reasoningEffort }]]
        : [];
    }),
  );
}
function pickedProvider(key: string, saved: any): Provider | undefined {
  if (isProvider(saved?.agent)) return saved.agent;
  // Composers once saved whichever agent they showed, so a new thread's Codex
  // may only have been the old default. A thread's agent was real.
  if (!isProvider(saved?.provider)) return;
  return key.startsWith("new:") && saved.provider === "codex"
    ? undefined
    : saved.provider;
}
/** The agent a composer runs: its pick, else the default for its kind. */
export const composerProvider = (
  picked: Provider | undefined,
  shared: boolean,
  fallback: AgentProvider = "codex",
): Provider => picked ?? (shared ? "message" : fallback);
type ComposerModels = Pick<ComposerSettings, "choice" | "claude" | "picks">;
function readModels(saved: any): ComposerModels {
  return {
    choice: aiSettingsSchema.shape.questions.safeParse(saved?.choice).data,
    claude: {
      model: modelSchema.safeParse(saved?.claude?.model).data ?? "",
      reasoningEffort: claudeEfforts.includes(saved?.claude?.reasoningEffort)
        ? reasoningEffortSchema.parse(saved.claude.reasoningEffort)
        : "",
      ...(saved?.claude?.contextWindow === "200k"
        ? { contextWindow: "200k" as const }
        : {}),
    },
    picks: readPicks(saved?.picks),
  };
}
const blankChoice: ModelChoice = {
  model: "",
  fast: false,
  reasoningEffort: "",
};
/** Each agent's model in `models`, the way desktop and phone share them. */
export function newThreadModelsOf({
  choice,
  claude,
  picks,
}: ComposerModels): NewThreadModels {
  return {
    ...Object.fromEntries(
      pickAgents.map((p) => [p, { choice: { ...blankChoice, ...picks[p] } }]),
    ),
    codex: { choice: choice ?? blankChoice },
    claude: {
      choice: {
        model: claude.model,
        fast: false,
        reasoningEffort: claude.reasoningEffort,
      },
      ...(claude.contextWindow ? { contextWindow: claude.contextWindow } : {}),
    },
  };
}
/** `models` with each agent in `models` on its model there; the others keep theirs. */
export function withNewThreadModels(
  models: ComposerModels,
  remembered: NewThreadModels,
): ComposerModels {
  let next = models;
  for (const provider of agentProviders) {
    const entry = remembered[provider];
    if (!entry) continue;
    const { choice, contextWindow } = entry;
    next = isPickAgent(provider)
      ? {
          ...next,
          picks: {
            ...next.picks,
            [provider]: {
              model: choice.model,
              reasoningEffort: choice.reasoningEffort,
            },
          },
        }
      : provider === "claude"
        ? {
            ...next,
            claude: {
              model: choice.model,
              reasoningEffort: choice.reasoningEffort,
              ...(contextWindow ? { contextWindow } : {}),
            },
          }
        : {
            ...next,
            // Default follows the line-question setting.
            choice:
              choice.model || choice.reasoningEffort || choice.fast
                ? choice
                : undefined,
          };
  }
  return next;
}
/**
 * Every project's new-thread composer starts on the same models, kept on the
 * desktop and shared with the phone. This copy opens a composer on them at once.
 */
const newThreadModelsKey = "composer-models:new-thread";
const isNewThread = (key: string) => key.startsWith("new:");
export function cachedNewThreadModels(): NewThreadModels | undefined {
  try {
    return newThreadModelsSchema.safeParse(
      JSON.parse(localStorage.getItem(newThreadModelsKey) || "null"),
    ).data;
  } catch {
    return undefined;
  }
}
export const cacheNewThreadModels = (models: NewThreadModels) =>
  localStorage.setItem(newThreadModelsKey, JSON.stringify(models));
/** The settings saved under `key`; with none yet, `inherit`'s, on its agent. */
export function loadComposerSettings(
  key: string,
  inherit?: { settingsKey: string; provider?: AgentProvider },
): ComposerSettings {
  let saved = read(key);
  let provider = pickedProvider(key, saved);
  if (!saved && inherit) {
    saved = read(inherit.settingsKey);
    provider = inherit.provider ?? pickedProvider(inherit.settingsKey, saved);
  }
  return {
    provider,
    ...(isNewThread(key)
      ? withNewThreadModels(readModels(saved), cachedNewThreadModels() ?? {})
      : readModels(saved)),
    runtimeMode: savedRuntimeMode(saved?.runtimeMode ?? saved?.mode),
    interactionMode: saved?.interactionMode === "plan" ? "plan" : "default",
    ultraplan: saved?.ultraplan === true,
    council: ultraplanKindSchema.catch("angles").parse(saved?.council),
  };
}
export function saveComposerSettings(
  key: string,
  { provider, ...settings }: ComposerSettings,
) {
  localStorage.setItem(
    storageKey(key),
    JSON.stringify({ ...settings, agent: provider }),
  );
}
/**
 * Hands a new thread's composer settings to the thread it started, on the
 * agent the first message went to. The new-thread composer keeps its models.
 */
export function startThreadSettings(
  from: string,
  to: string,
  provider: Provider,
) {
  saveComposerSettings(to, { ...loadComposerSettings(from), provider });
}
/**
 * Opens a composer on what a message was sent with. The choice is the model
 * of the agent it went to, so it goes to that agent's slot; the others keep
 * their own.
 */
export function saveSentSettings(
  key: string,
  provider: ComposerSettings["provider"],
  sent: Pick<
    ProjectChatSend,
    "provider" | "choice" | "contextWindow" | "runtimeMode" | "interactionMode"
  >,
) {
  const saved = loadComposerSettings(key);
  saveComposerSettings(key, {
    ...saved,
    ...withNewThreadModels(saved, {
      [sent.provider]: {
        choice: sent.choice,
        ...(sent.contextWindow ? { contextWindow: sent.contextWindow } : {}),
      },
    }),
    provider,
    runtimeMode: sent.runtimeMode,
    interactionMode: sent.interactionMode,
  });
}
