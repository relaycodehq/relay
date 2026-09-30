import type { AgentProvider } from "../../../shared/agents";
import type { ProjectChatSend } from "../../../shared/projects";
import type { RemoteSettings } from "../../../shared/remote";
import type { RemoteClient } from "../../../shared/remote-client";
import type { AISettings } from "../../../shared/settings";

/** Only a leading mention makes an agent answer (shared/agents' agentMentionPattern). */
const mention = /^@(codex|claude|opencode|cursor)(?=\s|$)/i;

export const withoutMention = (body: string) =>
  body.replace(/^@(codex|claude|opencode|cursor)(?=\s|$)\s*/i, "");

/**
 * A new thread's composer, as the desktop starts one: the default agent,
 * Full access and Build, with models on Default. Codex's Default is the
 * line-question model when Codex answers those (shared/settings' codexQuestionChoice).
 */
export function newThreadSettings(
  settings: AISettings | undefined,
  provider: AgentProvider = settings?.threadProvider ?? "codex",
): RemoteSettings {
  const codex =
    provider === "codex" && settings?.questionsProvider === "codex"
      ? settings.questions
      : undefined;
  return {
    provider,
    choice: codex ?? { model: "", fast: false, reasoningEffort: "" },
    runtimeMode: "full-access",
    interactionMode: "default",
  };
}

/**
 * A new thread's composer on the agent last picked for one, on the phone or
 * the desktop, else the default agent. Older desktops only know the default.
 */
export async function desktopNewThreadSettings(
  desktop: RemoteClient["desktop"],
): Promise<RemoteSettings> {
  const [last, ai] = await Promise.all([
    desktop("newThreadAgent").catch(() => null),
    desktop("aiSettings").catch(() => undefined),
  ]);
  return newThreadSettings(ai, last ?? ai?.threadProvider);
}

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
  const text = body.trim();
  return {
    id: extras.id,
    body: mention.test(text) ? text : `@${settings.provider} ${text}`.trim(),
    provider: settings.provider,
    choice: {
      ...settings.choice,
      // Fast is Codex's service tier; the others have none.
      fast: settings.provider === "codex" && settings.choice.fast,
    },
    runtimeMode: settings.runtimeMode,
    interactionMode: settings.interactionMode,
    ...(settings.provider === "claude" && settings.contextWindow
      ? { contextWindow: settings.contextWindow }
      : {}),
    ...(extras.parentId ? { parentId: extras.parentId } : {}),
    ...(extras.side ? { side: true } : {}),
    ...(extras.delivery ? { delivery: extras.delivery } : {}),
    ...(extras.sendAt ? { sendAt: extras.sendAt } : {}),
    ...(extras.images?.length ? { images: extras.images } : {}),
  };
}

/** What the desktop sends to carry out a proposed plan (ProjectComposer's Implement plan). */
export const implementPlan = (provider: AgentProvider) =>
  `@${provider} Implement the plan from your previous response.`;
