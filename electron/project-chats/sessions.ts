import { randomUUID } from "node:crypto";
import type {
  AgentProvider,
  AgentSession,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import { codexQuestionChoice } from "../../shared/settings";
import { agentRuntimes } from "../agents";
import {
  claudeAgentRun,
  claudeAgents,
  claudePending,
  onClaudePending,
  stopClaudeAgent,
} from "../rooms/claude-project";
import type { Store } from "../app/store";

/** An agent's session and the last message it heard, on the main conversation or a side one. */
export function agentSession(
  chat: ProjectChat,
  provider: AgentProvider,
  parentId?: string | null,
): AgentSession {
  const sessions = parentId ? chat.replySessions?.[parentId] : chat.sessions;
  return sessions?.[provider] ?? {};
}
/** The same, to write to. */
export function sessionFor(
  chat: ProjectChat,
  provider: AgentProvider,
  parentId?: string | null,
): AgentSession {
  const sessions = parentId
    ? ((chat.replySessions ??= {})[parentId] ??= {})
    : (chat.sessions ??= {});
  return (sessions[provider] ??= {});
}
/** Forgets an agent's session, e.g. a fork that broke. */
export function dropSession(
  chat: ProjectChat,
  provider: AgentProvider,
  parentId?: string | null,
) {
  const sessions = parentId ? chat.replySessions?.[parentId] : chat.sessions;
  if (sessions) delete sessions[provider];
}

/**
 * The model a hidden turn runs on when the session's last turn was another
 * agent's: Codex's saved question model, the others' defaults.
 */
function defaultChoice(
  provider: AgentProvider,
  store: Pick<Store, "aiSettings">,
) {
  return provider === "codex"
    ? codexQuestionChoice(store.aiSettings())
    : { model: "", reasoningEffort: "" as const, fast: false };
}
/** A hidden turn on an existing session, with the settings that session last ran under. */
export function sessionInput(
  chat: ProjectChat,
  provider: AgentProvider,
  store: Pick<Store, "aiSettings">,
  parentId?: string,
): ProjectChatSend {
  const previous = chat.lastInput;
  const same = previous && sentAgent(previous) === provider;
  return {
    id: randomUUID(),
    body: `@${provider}`,
    to: provider,
    provider,
    // Matching the last turn's settings keeps the live session instead of reopening it.
    // Another provider's model id would not resolve here.
    choice: same ? previous.choice : defaultChoice(provider, store),
    ...(same && previous.contextWindow
      ? { contextWindow: previous.contextWindow }
      : {}),
    runtimeMode: previous?.runtimeMode ?? "full-access",
    interactionMode: previous?.interactionMode ?? "default",
    ...(parentId ? { parentId } : {}),
  };
}

/** A key from `ProviderSessions.key`; `branch` is undefined on the main thread. */
export function parseSessionKey(key: string) {
  const [, chatId, branch] = JSON.parse(key) as string[];
  return { chatId, branch: branch === "main" ? undefined : branch };
}

/**
 * The agent sessions Relay's threads have open, by key, and what Claude's
 * hold: background work, wake-ups, subagents.
 */
export class ProviderSessions {
  private keys = new Set<string>();
  /** Sessions still in the turn a restart cut off; their answers stay streaming. */
  private resuming = new Set<string>();
  /** Claude's background work and wake-ups show in its threads' summaries. */
  private unhear = onClaudePending(() => {
    for (const key of this.keys) this.changed(parseSessionKey(key).chatId);
  });
  constructor(
    private dir: string,
    private changed: (chatId: string) => void,
  ) {}

  /**
   * A provider session's key: Relay's data folder, the chat, and its branch
   * ("main", or the root message of a side thread). Runtimes key live
   * sessions by it, so the format stays.
   */
  key(chatId: string, branch?: string) {
    return JSON.stringify([this.dir, chatId, branch ?? "main"]);
  }

  /** A key of this data folder's, for a thread `exists` knows. */
  owns(key: string, exists: (chatId: string) => boolean) {
    try {
      const [dir, chatId] = JSON.parse(key) as string[];
      return dir === this.dir && exists(chatId);
    } catch {
      return false;
    }
  }

  add(key: string) {
    this.keys.add(key);
  }
  /** A session the agent host kept through a restart; `open` if a turn was running in it. */
  reattached(key: string, open: boolean) {
    this.keys.add(key);
    if (open) this.resuming.add(key);
  }
  isResuming(chatId: string, branch?: string) {
    return this.resuming.has(this.key(chatId, branch));
  }
  resumed(key: string) {
    this.resuming.delete(key);
  }
  /** A session whose cut-off turn couldn't be picked back up. */
  lost(key: string) {
    this.resuming.delete(key);
    this.keys.delete(key);
  }

  of(chatId: string) {
    return [...this.keys].filter(
      (key) => parseSessionKey(key).chatId === chatId,
    );
  }

  /** Ends a hidden thread's agent processes; they resume their sessions if it runs again. */
  close(chatId: string) {
    for (const key of this.keys)
      if (parseSessionKey(key).chatId === chatId) {
        this.keys.delete(key);
        for (const runtime of Object.values(agentRuntimes))
          void runtime.closeSession(key).catch(() => {});
        this.changed(chatId);
      }
  }

  /** Relay is closing: every session ends and stops being heard. */
  async closeAll() {
    await Promise.all(
      [...this.keys].flatMap((key) =>
        Object.values(agentRuntimes).map((runtime) =>
          runtime.closeSession(key).catch(() => {}),
        ),
      ),
    );
    this.keys.clear();
  }

  stopListening() {
    this.unhear();
  }

  /**
   * Background work and wake-ups in the live Claude sessions of a thread, or
   * of every thread, with the side conversation each session belongs to.
   */
  pending(chatId?: string) {
    return [...this.keys].flatMap((key) => {
      const { chatId: id, branch: parentId } = parseSessionKey(key);
      if (chatId && id !== chatId) return [];
      return claudePending(key).map((item) => ({
        key,
        chatId: id,
        parentId,
        item,
      }));
    });
  }

  /** The subagents Claude started in a thread, its side conversations' too. */
  subagents(chatId: string) {
    return this.of(chatId).flatMap((key) => claudeAgents(key));
  }
  subagentRun(chatId: string, agentId: string) {
    for (const key of this.of(chatId)) {
      const run = claudeAgentRun(key, agentId);
      if (run) return run;
    }
    return null;
  }
  async stopSubagent(chatId: string, agentId: string) {
    const key = this.of(chatId).find((k) => claudeAgentRun(k, agentId));
    if (!key) throw new Error("That agent has already finished.");
    await stopClaudeAgent(key, agentId);
  }
}
