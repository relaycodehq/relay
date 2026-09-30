import {
  savedRuntimeMode,
  type InteractionMode,
  type RuntimeMode,
} from "../../shared/agent-modes";
import type { ProjectChatSend } from "../../shared/projects";
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
/**
 * Every project's new-thread composer shares one set of models: the ones last
 * picked there or last sent with in any thread.
 */
const newThreadModelsKey = "composer-models:new-thread";
const isNewThread = (key: string) => key.startsWith("new:");
function readNewThreadModels() {
  try {
    return JSON.parse(localStorage.getItem(newThreadModelsKey) || "null");
  } catch {
    return null;
  }
}
const saveNewThreadModels = ({ choice, claude, picks }: ComposerModels) =>
  localStorage.setItem(
    newThreadModelsKey,
    JSON.stringify({ choice, claude, picks }),
  );
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
    ...readModels((isNewThread(key) && readNewThreadModels()) || saved),
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
  if (isNewThread(key)) saveNewThreadModels(settings);
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
type SentModel = Pick<ProjectChatSend, "provider" | "choice" | "contextWindow">;
/** `models` with the model a message was sent with, in its agent's slot. */
function withSentModel(
  models: ComposerModels,
  sent: SentModel,
): ComposerModels {
  if (isPickAgent(sent.provider))
    return {
      ...models,
      picks: {
        ...models.picks,
        [sent.provider]: {
          model: sent.choice.model,
          reasoningEffort: sent.choice.reasoningEffort,
        },
      },
    };
  if (sent.provider === "claude")
    return {
      ...models,
      claude: {
        model: sent.choice.model,
        reasoningEffort: sent.choice.reasoningEffort,
        ...(sent.contextWindow ? { contextWindow: sent.contextWindow } : {}),
      },
    };
  return { ...models, choice: sent.choice };
}
/** The next new thread starts on the model a message just went out with. */
export function rememberSentModel(sent: SentModel) {
  const saved = readNewThreadModels();
  saveNewThreadModels(withSentModel(readModels(saved), sent));
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
    ...withSentModel(saved, sent),
    provider,
    runtimeMode: sent.runtimeMode,
    interactionMode: sent.interactionMode,
  });
}
