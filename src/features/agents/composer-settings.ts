import {
  runtimeModeSchema,
  savedRuntimeMode,
  type InteractionMode,
  type RuntimeMode,
} from "../../../shared/agent-modes";
import type {
  ProjectChatSend,
  SentComposerSettings,
} from "../../../shared/projects";
import {
  newThreadModelsSchema,
  type NewThreadModels,
} from "../../../shared/new-thread-models";
import { isAgentProvider, type AgentProvider } from "../../../shared/agents";
import { readJson, writeJson } from "../../lib/persisted-store";
import { composerSettingsKey } from "../../lib/thread-storage";
import {
  readComposerModels,
  withNewThreadModels,
  type ComposerModels,
} from "./composer-models";

type Provider = AgentProvider | "message";

/** What a chat composer starts from: its agent, each agent's model, its modes. */
export interface ComposerSettings {
  /** The agent picked here; unset follows the default agent setting. */
  provider?: Provider;
  /** Each agent's model; see ComposerModels. */
  models: ComposerModels;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  /**
   * The thread's last message these settings know of. One sent without them,
   * from the phone, another computer or an agent, replaces them; see withSent.
   */
  sent?: string;
  /**
   * A new thread's draft took the shared picks when it was created; from then
   * on only picks in it change it, not sends or picks elsewhere.
   */
  frozen?: true;
}

const read = (key: string): any => readJson(composerSettingsKey(key)) ?? null;
const isProvider = (value: unknown): value is Provider =>
  value === "message" || isAgentProvider(value);
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
  fallback: AgentProvider = "codex",
): Provider => picked ?? fallback;

/**
 * Every project's new-thread composer starts on the same models, kept on the
 * desktop and shared with the phone. This copy opens a composer on them at once.
 */
const newThreadModelsKey = "composer-models:new-thread";
const isNewThread = (key: string) => key.startsWith("new:");
export const cachedNewThreadModels = (): NewThreadModels | undefined =>
  newThreadModelsSchema.safeParse(readJson(newThreadModelsKey)).data;
export const cacheNewThreadModels = (models: NewThreadModels) =>
  writeJson(newThreadModelsKey, models);
/** The same for the access a new thread starts on. */
const newThreadModeKey = "composer-mode:new-thread";
export const cachedNewThreadRuntimeMode = (): RuntimeMode | undefined =>
  runtimeModeSchema.safeParse(readJson(newThreadModeKey)).data;
export const cacheNewThreadRuntimeMode = (mode: RuntimeMode) =>
  writeJson(newThreadModeKey, mode);
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

/** Where a composer with nothing saved yet starts from. */
export interface InheritedSettings {
  /** The composer whose settings it starts on. */
  settingsKey: string;
  /** The agent it starts on, instead of that composer's. */
  provider?: AgentProvider;
}

/** The settings saved under `key`; with none yet, `inherit`'s, on its agent. */
export function loadComposerSettings(
  key: string,
  inherit?: InheritedSettings,
): ComposerSettings {
  let saved = read(key);
  let provider = pickedProvider(key, saved);
  const own = !!saved;
  if (!saved && inherit) {
    saved = read(inherit.settingsKey);
    provider = inherit.provider ?? pickedProvider(inherit.settingsKey, saved);
  }
  const frozen = own && isNewThread(key) && saved?.frozen === true;
  return {
    provider,
    // Shared defaults belong only to new drafts. Existing conversations
    // restore their own last send, never another thread's model picks.
    models:
      isNewThread(key) && !frozen
        ? withNewThreadModels(
            readComposerModels(saved),
            cachedNewThreadModels() ?? {},
          )
        : readComposerModels(saved),
    runtimeMode:
      (isNewThread(key) && !frozen && cachedNewThreadRuntimeMode()) ||
      savedRuntimeMode(saved?.runtimeMode ?? saved?.mode),
    interactionMode: saved?.interactionMode === "plan" ? "plan" : "default",
    // An inherited one's last message says nothing about this conversation.
    ...(own && typeof saved?.sent === "string" ? { sent: saved.sent } : {}),
    ...(frozen ? { frozen } : {}),
  };
}

export function saveComposerSettings(
  key: string,
  { provider, ...settings }: ComposerSettings,
) {
  writeJson(composerSettingsKey(key), { ...settings, agent: provider });
}

/**
 * Hands a new thread's composer settings to the thread it started, on the
 * agent the first message went to. The new-thread composer keeps its models
 * and runtime mode, but Plan was for that thread: the next one
 * starts in Build.
 */
export function startThreadSettings(
  from: string,
  to: string,
  provider: Provider,
) {
  const { frozen: _, ...settings } = loadComposerSettings(from);
  saveComposerSettings(to, { ...settings, provider });
  // The next draft here is a new one, created on the shared picks.
  saveComposerSettings(from, {
    ...settings,
    interactionMode: "default",
  });
  // A composer still open on it would save its frozen picks back over this.
  for (const listener of threadStartListeners.get(from) ?? []) listener();
}

const threadStartListeners = new Map<string, Set<() => void>>();

/** Calls `listener` when the draft under `key` starts a thread; returns the unsubscribe. */
export function onThreadStarted(key: string, listener: () => void) {
  const listeners = threadStartListeners.get(key) ?? new Set();
  threadStartListeners.set(key, listeners.add(listener));
  return () => {
    listeners.delete(listener);
    if (!listeners.size) threadStartListeners.delete(key);
  };
}

/**
 * A fork's composer starts on its source thread's models, on the agent of the
 * answer it was forked from, in Build like any new thread.
 */
export function forkThreadSettings(
  from: string,
  to: string,
  provider: AgentProvider | undefined,
  /** The fork's copied history has new message ids of its own. */
  sent: SentComposerSettings | undefined,
) {
  const saved = loadComposerSettings(from);
  // A sidebar fork can come from a thread never opened in this window.
  const settings = read(from) ? saved : withSent(saved, sent);
  saveComposerSettings(to, {
    ...settings,
    ...(provider ? { provider } : {}),
    interactionMode: "default",
    sent: sent?.id,
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
  sent: SentSettings,
) {
  saveComposerSettings(key, {
    ...withSentModel(loadComposerSettings(key), sent),
    provider,
  });
}

type SentSettings = Pick<
  ProjectChatSend,
  "provider" | "choice" | "contextWindow" | "runtimeMode" | "interactionMode"
>;

const withSentModel = (
  settings: ComposerSettings,
  sent: SentSettings,
): ComposerSettings => ({
  ...settings,
  models: withNewThreadModels(settings.models, {
    [sent.provider]: {
      choice: sent.choice,
      ...(sent.contextWindow ? { contextWindow: sent.contextWindow } : {}),
    },
  }),
  runtimeMode: sent.runtimeMode,
  interactionMode: sent.interactionMode,
});

/**
 * `settings` on the thread's last message when they don't know of it: it went
 * from the phone, another computer or an agent, or before this window kept
 * any. Notes do not carry agent settings and are filtered by the caller.
 */
export function withSent(
  settings: ComposerSettings,
  sent: SentComposerSettings | undefined,
): ComposerSettings {
  if (!sent || sent.id === settings.sent) return settings;
  return {
    ...withSentModel(settings, sent),
    provider: sent.provider,
    sent: sent.id,
  };
}
