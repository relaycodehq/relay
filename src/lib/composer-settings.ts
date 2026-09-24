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

/** What a chat composer starts from: its agent, each agent's model, its modes. */
export interface ComposerSettings {
  provider: "codex" | "claude" | "message";
  /** Codex's model; unset follows the line-question setting. */
  choice?: ModelChoice;
  claude: { model: string; reasoningEffort: ReasoningEffort };
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
/** The settings saved under `key`; with none yet, `inherit`'s, on its agent. */
export function loadComposerSettings(
  key: string,
  shared: boolean,
  inherit?: { settingsKey: string; provider?: "codex" | "claude" },
): ComposerSettings {
  let saved = read(key);
  if (!saved && inherit) {
    saved = read(inherit.settingsKey);
    if (inherit.provider) saved = { ...saved, provider: inherit.provider };
  }
  return {
    provider: ["codex", "claude", "message"].includes(saved?.provider)
      ? saved.provider
      : shared
        ? "message"
        : "codex",
    choice: aiSettingsSchema.shape.questions.safeParse(saved?.choice).data,
    claude: {
      model: modelSchema.safeParse(saved?.claude?.model).data ?? "",
      reasoningEffort: claudeEfforts.includes(saved?.claude?.reasoningEffort)
        ? reasoningEffortSchema.parse(saved.claude.reasoningEffort)
        : "",
    },
    runtimeMode: savedRuntimeMode(saved?.runtimeMode ?? saved?.mode),
    interactionMode: saved?.interactionMode === "plan" ? "plan" : "default",
    ultraplan: saved?.ultraplan === true,
    council: ultraplanKindSchema.catch("angles").parse(saved?.council),
  };
}
export function saveComposerSettings(key: string, settings: ComposerSettings) {
  localStorage.setItem(storageKey(key), JSON.stringify(settings));
}
/**
 * Puts each agent's model and effort back on Default, keeping the agent and
 * modes. A new thread's pick stays with the thread it started.
 */
export function resetComposerModels(key: string) {
  const saved = read(key);
  if (!saved) return;
  saveComposerSettings(key, {
    ...loadComposerSettings(key, false),
    choice: undefined,
    claude: { model: "", reasoningEffort: "" },
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
    "provider" | "choice" | "runtimeMode" | "interactionMode"
  >,
) {
  saveComposerSettings(key, {
    ...loadComposerSettings(key, false),
    provider,
    ...(sent.provider === "claude"
      ? {
          claude: {
            model: sent.choice.model,
            reasoningEffort: sent.choice.reasoningEffort,
          },
        }
      : { choice: sent.choice }),
    runtimeMode: sent.runtimeMode,
    interactionMode: sent.interactionMode,
  });
}
