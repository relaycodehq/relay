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
  type AgentModel,
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
import { readJson } from "./persisted-store";
import { composerSettingsKey } from "./thread-storage";

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
const read = (key: string): any => readJson(composerSettingsKey(key)) ?? null;
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
/** The model and efforts an agent in `picks` runs; "" is its Default. */
export function livePick(
  pick: AgentPick | undefined,
  models: AgentModel[] | undefined,
) {
  const { model, reasoningEffort } = pick ?? {
    model: "",
    reasoningEffort: "" as const,
  };
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
 * What a message to `to` runs on, from Codex's `selected` choice. Every agent
 * keeps its own model and effort; Codex-only settings never reach the others.
 */
export function messageChoice(
  to: string,
  selected: ModelChoice | undefined,
  claude: ComposerSettings["claude"],
  pick: AgentPick,
): ModelChoice | undefined {
  if (!selected) return undefined;
  if (to === "claude")
    return {
      ...selected,
      model: claude.model,
      reasoningEffort: claude.reasoningEffort,
      fast: false,
    };
  if (isPickAgent(to))
    return {
      model: pick.model,
      reasoningEffort: pick.reasoningEffort,
      fast: false,
    };
  return selected;
}
export const messageContext = (
  to: string,
  claude: ComposerSettings["claude"],
) =>
  to === "claude" && claude.contextWindow
    ? { contextWindow: claude.contextWindow }
    : {};
/** The agent a composer runs: its pick, else the default for its kind. */
export const composerProvider = (
  picked: Provider | undefined,
  shared: boolean,
  fallback: AgentProvider = "codex",
): Provider => picked ?? (shared ? "message" : fallback);
export type ComposerModels = Pick<
  ComposerSettings,
  "choice" | "claude" | "picks"
>;
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
export const cachedNewThreadModels = (): NewThreadModels | undefined =>
  newThreadModelsSchema.safeParse(readJson(newThreadModelsKey)).data;
export const cacheNewThreadModels = (models: NewThreadModels) =>
  localStorage.setItem(newThreadModelsKey, JSON.stringify(models));
/**
 * Where a new thread's composer stands with the agent last picked for one:
 * the one it took up or handed on (unset before the first answer), and the
 * pick it last saw here.
 */
export interface AgentFollow {
  adopted?: AgentProvider | null;
  known?: Provider;
}
/**
 * What to do as the last agent (`last`) or the pick here (`picked`) changes:
 * take up an agent picked elsewhere, or hand on one picked here. Its own pick
 * coming back as the last agent changes nothing.
 */
export function followLastAgent(
  at: AgentFollow,
  last: AgentProvider | null,
  picked: Provider | undefined,
): { at: AgentFollow; adopt?: AgentProvider; save?: AgentProvider } {
  if (last && last !== at.adopted)
    return { at: { adopted: last, known: last }, adopt: last };
  if (at.adopted === undefined) return { at: { adopted: last, known: picked } };
  if (picked === at.known) return { at };
  if (picked && picked !== "message")
    return { at: { adopted: picked, known: picked }, save: picked };
  return { at: { ...at, known: picked } };
}
/** Whether a composer saved settings under `key`. */
export const hasComposerSettings = (key: string) => read(key) !== null;
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
    // A thread this window has no settings for (started on the phone, or in
    // another build of Relay) opens on the models last used, like a new one.
    ...(isNewThread(key) || !saved
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
    composerSettingsKey(key),
    JSON.stringify({ ...settings, agent: provider }),
  );
}
/**
 * Hands a new thread's composer settings to the thread it started, on the
 * agent the first message went to. The new-thread composer keeps its models
 * and runtime mode, but Plan and Ultraplan were for that thread: the next one
 * starts in Build.
 */
export function startThreadSettings(
  from: string,
  to: string,
  provider: Provider,
) {
  const settings = loadComposerSettings(from);
  saveComposerSettings(to, { ...settings, provider });
  saveComposerSettings(from, {
    ...settings,
    interactionMode: "default",
    ultraplan: false,
  });
}
/**
 * A fork's composer starts on its source thread's models, on the agent of the
 * answer it was forked from, in Build like any new thread.
 */
export function forkThreadSettings(
  from: string,
  to: string,
  provider: AgentProvider | undefined,
) {
  const settings = loadComposerSettings(from);
  saveComposerSettings(to, {
    ...settings,
    ...(provider ? { provider } : {}),
    interactionMode: "default",
    ultraplan: false,
  });
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
