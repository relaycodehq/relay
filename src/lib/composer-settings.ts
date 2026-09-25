import {
  savedRuntimeMode,
  type InteractionMode,
  type RuntimeMode,
} from "../../shared/agent-modes";
import type { ProjectChatSend } from "../../shared/projects";
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

type Provider = "codex" | "claude" | "message";
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
const providers: unknown[] = ["codex", "claude", "message"];
const isProvider = (value: unknown): value is Provider =>
  providers.includes(value);
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
  fallback: "codex" | "claude" = "codex",
): Provider => picked ?? (shared ? "message" : fallback);
/** The settings saved under `key`; with none yet, `inherit`'s, on its agent. */
export function loadComposerSettings(
  key: string,
  inherit?: { settingsKey: string; provider?: "codex" | "claude" },
): ComposerSettings {
  let saved = read(key);
  let provider = pickedProvider(key, saved);
  if (!saved && inherit) {
    saved = read(inherit.settingsKey);
    provider = inherit.provider ?? pickedProvider(inherit.settingsKey, saved);
  }
  return {
    provider,
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
 * agent the first message went to, and puts the new-thread composer's models
 * back on Default.
 */
export function startThreadSettings(
  from: string,
  to: string,
  provider: Provider,
) {
  saveComposerSettings(to, { ...loadComposerSettings(from), provider });
  resetComposerModels(from);
}
/**
 * Puts each agent's model and effort back on Default, keeping the agent,
 * modes and Claude's context window. A new thread's pick stays with the
 * thread it started.
 */
export function resetComposerModels(key: string) {
  const saved = read(key);
  if (!saved) return;
  const settings = loadComposerSettings(key);
  saveComposerSettings(key, {
    ...settings,
    choice: undefined,
    claude: {
      model: "",
      reasoningEffort: "",
      ...(settings.claude.contextWindow
        ? { contextWindow: settings.claude.contextWindow }
        : {}),
    },
  });
}
/**
 * Opens a composer on what a message was sent with. A Claude message's choice
 * is Claude's model, so it goes there; the other agent keeps its own.
 */
export function saveSentSettings(
  key: string,
  provider: ComposerSettings["provider"],
  sent: Pick<
    ProjectChatSend,
    "provider" | "choice" | "contextWindow" | "runtimeMode" | "interactionMode"
  >,
) {
  saveComposerSettings(key, {
    ...loadComposerSettings(key),
    provider,
    ...(sent.provider === "claude"
      ? {
          claude: {
            model: sent.choice.model,
            reasoningEffort: sent.choice.reasoningEffort,
            ...(sent.contextWindow
              ? { contextWindow: sent.contextWindow }
              : {}),
          },
        }
      : { choice: sent.choice }),
    runtimeMode: sent.runtimeMode,
    interactionMode: sent.interactionMode,
  });
}
