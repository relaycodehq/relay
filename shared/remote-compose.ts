import { agentMentionPattern, type AgentProvider } from "./agents";
import { buildSend, planGoAhead } from "./compose-send";
import {
  modelEfforts,
  type ComposerChange,
  type ModelCatalogs,
} from "./composer-commands";
import type { ProjectChatSend } from "./projects";
import type { RemoteSettings } from "./remote";
import type { RemoteClient } from "./remote-client";
import { claudeContextWindow, type AISettings } from "./settings";
import type { NewThreadModels } from "./new-thread-models";

export const withoutMention = (body: string) =>
  body.replace(agentMentionPattern, "");

/**
 * A new thread's composer, as the desktop starts one: the default agent,
 * Full access and Build, on the agent's remembered model or its Default.
 * Codex's Default is the line-question model when Codex answers those
 * (shared/settings' codexQuestionChoice).
 */
export function newThreadSettings(
  settings: AISettings | undefined,
  provider: AgentProvider = settings?.threadProvider ?? "codex",
  models: NewThreadModels = {},
): RemoteSettings {
  const codex =
    provider === "codex" && settings?.questionsProvider === "codex"
      ? settings.questions
      : undefined;
  return withRememberedModel(
    {
      provider,
      choice: codex ?? { model: "", fast: false, reasoningEffort: "" },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    models,
  );
}

/** `settings` on the model its agent last ran with in a new thread or any send, when there is one. */
export function withRememberedModel(
  settings: RemoteSettings,
  models: NewThreadModels,
): RemoteSettings {
  const remembered = models[settings.provider];
  const { choice } = remembered ?? {};
  // A blank Codex pick is the desktop's Default, which `settings` already has.
  if (
    !remembered ||
    !(choice!.model || choice!.reasoningEffort || choice!.fast)
  )
    return settings;
  const { contextWindow: _, ...rest } = settings;
  return {
    ...rest,
    choice: remembered.choice,
    ...(remembered.contextWindow
      ? { contextWindow: remembered.contextWindow }
      : {}),
  };
}

/**
 * A new thread's composer on the agent last picked for one, on the phone or
 * the desktop, else the default agent, with each agent's remembered model.
 * Older desktops only know the default.
 */
export async function desktopNewThread(desktop: RemoteClient["desktop"]) {
  const [last, ai, models] = await Promise.all([
    desktop("newThreadAgent").catch(() => null),
    desktop("aiSettings").catch(() => undefined),
    desktop("newThreadModels").catch(() => ({}) as NewThreadModels),
  ]);
  return {
    settings: newThreadSettings(ai, last ?? ai?.threadProvider, models),
    models,
  };
}

export const desktopNewThreadSettings = async (
  desktop: RemoteClient["desktop"],
) => (await desktopNewThread(desktop)).settings;

/** The same composer on another agent: its model goes back to Default, as on the desktop. */
export function switchAgent(
  settings: RemoteSettings,
  provider: AgentProvider,
): RemoteSettings {
  if (provider === settings.provider) return settings;
  const { contextWindow: _, ...rest } = settings;
  return {
    ...rest,
    provider,
    choice: { model: "", fast: false, reasoningEffort: "" },
  };
}

/**
 * `settings` after a composer command (shared/composer-commands). `switchTo`
 * puts it on another agent, with whatever model the composer kept for it.
 */
export function withComposerChange(
  settings: RemoteSettings,
  change: ComposerChange<AgentProvider>,
  catalogs: ModelCatalogs,
  switchTo: typeof switchAgent = switchAgent,
): RemoteSettings {
  const { choice } = settings;
  switch (change.command) {
    case "provider":
      return switchTo(settings, change.provider);
    case "model": {
      const { provider, model } = change;
      const { contextWindow, ...on } = switchTo(settings, provider);
      // As on the desktop: an effort the model lacks goes back to Default,
      // and a model with 1M built in drops the 200k window.
      const effort = on.choice.reasoningEffort;
      return {
        ...on,
        choice: {
          ...on.choice,
          model,
          reasoningEffort: modelEfforts(provider, model, catalogs).includes(
            effort,
          )
            ? effort
            : "",
        },
        ...(contextWindow && claudeContextWindow(model) !== "1m"
          ? { contextWindow }
          : {}),
      };
    }
    case "effort":
      return {
        ...settings,
        choice: { ...choice, reasoningEffort: change.reasoningEffort },
      };
    case "permissions":
      return { ...settings, runtimeMode: change.runtimeMode };
    case "plan":
      return { ...settings, interactionMode: change.plan ? "plan" : "default" };
    case "fast":
      return { ...settings, choice: { ...choice, fast: change.fast } };
  }
}

/**
 * The go-ahead for the plan `planner` proposed, as the phone sends it, and the
 * settings its composer keeps afterwards: on that agent, in Build.
 */
export function remotePlanGoAhead(
  settings: RemoteSettings,
  planner: AgentProvider,
  id: string,
): { send: ProjectChatSend; nextSettings: RemoteSettings } {
  const { provider, ...rest } = settings;
  const { send, nextSettings } = planGoAhead(
    { to: provider, ...rest },
    planner,
  );
  const { to, ...next } = nextSettings;
  return { send: { id, ...send }, nextSettings: { provider: to, ...next } };
}

export interface SendExtras {
  id: string;
  /** A reply, or a message in a side conversation, by its root. */
  parentId?: string;
  /** `/btw`: a side question the main session never hears. */
  side?: true;
  /** While an answer runs: its own turn after it, or steered into it. */
  delivery?: "queue" | "steer";
  sendAt?: number;
  images?: NonNullable<ProjectChatSend["images"]>;
}

/** The message the desktop's composer would send for these settings. */
export function composeSend(
  settings: RemoteSettings,
  body: string,
  extras: SendExtras,
): ProjectChatSend {
  const { provider, ...rest } = settings;
  return {
    id: extras.id,
    ...buildSend({ to: provider, ...rest }, body, {
      parentId: extras.parentId,
      side: extras.side,
      sendAt: extras.sendAt,
      images: extras.images,
      ...(extras.delivery
        ? { running: { steer: extras.delivery === "steer" } }
        : {}),
    }),
  };
}
