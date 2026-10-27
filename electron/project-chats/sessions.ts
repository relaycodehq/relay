import { randomUUID } from "node:crypto";
import type {
  AgentProvider,
  AgentSession,
  ProjectChat,
  ProjectChatSend,
  SessionReload,
  ContextUsage,
} from "../../shared/projects";
import { defaultRuntimeMode } from "../../shared/agent-modes";
import { sentAgent } from "../../shared/recipient";
import { codexQuestionChoice } from "../../shared/settings";
import { agentRuntime, agentRuntimes, everyAgentRuntime } from "../agents";
import {
  claudeLive,
  claudePending,
  onClaudePending,
} from "../agents/claude/project";
import type { Store } from "../app/store";
import type { SubagentDetail } from "../../shared/subagents";
import { SubagentArchive } from "./subagent-archive";

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
    runtimeMode: previous?.runtimeMode ?? defaultRuntimeMode,
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
 * How long a session may sit unused before its agent process ends. The
 * thread resumes its conversation with the next message, which only costs
 * that message the agent's startup. Kept open, every thread ever touched
 * held a process (hundreds of MB for Claude), and the agent host that
 * ran it, until Relay quit.
 */
export const IDLE_CLOSE = 30 * 60_000;
/**
 * How many unused sessions may wait out `IDLE_CLOSE`; past them the oldest
 * end once unused for `IDLE_KEEP_MIN`. An idle Claude held 450–850 MB on a
 * Mac (2026-10), so every thread touched in half an hour kept warm could
 * hold several GB between them.
 */
export const IDLE_KEEP = 4;
/** Not even past the cap does a session end this soon: its reply may still be being read. */
export const IDLE_KEEP_MIN = 5 * 60_000;

/**
 * The agent sessions Relay's threads have open, by key, and what Claude's
 * hold: background work, wake-ups, subagents.
 */
export class ProviderSessions {
  private keys = new Set<string>();
  /** When each key was last seen at work. */
  private used = new Map<string, number>();
  /** Sessions still in the turn a restart cut off; their answers stay streaming. */
  private resuming = new Set<string>();
  /** What the threads' agents ran, kept past the sessions that followed them. */
  private archive: SubagentArchive;
  private pendingListeners = new Set<() => void>();

  /**
   * Claude's background work and wake-ups show in its threads' summaries;
   * its background agents start and end with them, between turns too.
   */
  private unhear = onClaudePending(() => {
    for (const chatId of this.chats()) {
      this.changed(chatId);
      void this.keepSubagents(chatId);
    }
    for (const listener of this.pendingListeners) listener();
  });

  private sweep = setInterval(() => this.closeIdle(), 60_000);

  constructor(
    private dir: string,
    private changed: (chatId: string) => void,
    /** A turn or side question is running in the thread. */
    private busy: (chatId: string) => boolean = () => false,
  ) {
    this.archive = new SubagentArchive(dir);
    this.sweep.unref?.();
  }

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
    this.used.set(key, Date.now());
  }

  /** A session the agent host kept through a restart; `open` if a turn was running in it. */
  reattached(key: string, open: boolean) {
    this.keys.add(key);
    this.used.set(key, Date.now());
    if (open) this.resuming.add(key);
  }

  isResuming(chatId: string, branch?: string) {
    return this.resuming.has(this.key(chatId, branch));
  }

  /** A turn a restart cut off in the thread, on any branch, is yet to be picked up. */
  resumingIn(chatId: string) {
    return [...this.resuming].some(
      (key) => parseSessionKey(key).chatId === chatId,
    );
  }

  resumed(key: string) {
    this.resuming.delete(key);
  }

  /** A session whose cut-off turn couldn't be picked back up. */
  lost(key: string) {
    this.resuming.delete(key);
    this.keys.delete(key);
    this.used.delete(key);
  }

  of(chatId: string) {
    return [...this.keys].filter(
      (key) => parseSessionKey(key).chatId === chatId,
    );
  }

  private chats() {
    return new Set([...this.keys].map((key) => parseSessionKey(key).chatId));
  }

  /** Ends a thread's agent processes; they resume their sessions if it runs again. */
  close(chatId: string) {
    for (const key of this.keys)
      if (parseSessionKey(key).chatId === chatId) this.end(key);
  }

  /**
   * Ends the sessions nothing has used for `IDLE_CLOSE`. Running turns, side
   * questions, Claude's background work and wake-ups, and turns a restart
   * cut off count as use.
   */
  closeIdle(now = Date.now()) {
    const idle: string[] = [];
    for (const key of this.keys) {
      const { chatId } = parseSessionKey(key);
      if (
        this.busy(chatId) ||
        this.resuming.has(key) ||
        claudePending(key).length ||
        !this.used.has(key)
      )
        this.used.set(key, now);
      else if (now - this.used.get(key)! >= IDLE_CLOSE) this.end(key);
      else idle.push(key);
    }
    idle.sort((a, b) => this.used.get(b)! - this.used.get(a)!);
    for (const key of idle.slice(IDLE_KEEP))
      if (now - this.used.get(key)! >= IDLE_KEEP_MIN) this.end(key);
  }

  private end(key: string) {
    void this.keepSubagents(parseSessionKey(key).chatId);
    this.keys.delete(key);
    this.used.delete(key);
    for (const runtime of everyAgentRuntime())
      void runtime.closeSession(key).catch(() => {});
    this.changed(parseSessionKey(key).chatId);
  }

  /**
   * Restarts a thread's agent processes on their sessions, so they load
   * skills, plugins and instructions changed since they started. The main
   * conversation's comes back at once where its agent can say what changed;
   * the rest resume with their next message.
   */
  async reload(
    chatId: string,
    provider: AgentProvider,
  ): Promise<SessionReload | undefined> {
    const main = this.key(chatId);
    const keys = this.of(chatId);
    const runtimes = everyAgentRuntime();
    void this.keepSubagents(chatId);
    let changes: SessionReload | undefined;
    // Only the selected provider may reload shared services. Other adapters just close.
    const selected = agentRuntimes().find(([p]) => p === provider)?.[1];
    if (selected?.reloadSession) changes = await selected.reloadSession(main);
    for (const key of keys)
      for (const runtime of runtimes)
        if (key !== main || runtime !== selected || !runtime.reloadSession)
          await runtime.closeSession(key).catch(() => {});
    this.changed(chatId);
    return changes;
  }

  /** Relay is closing: every session ends and stops being heard. */
  async closeAll() {
    await this.keepAllSubagents();
    await Promise.all(
      [...this.keys].flatMap((key) =>
        everyAgentRuntime().map((runtime) =>
          runtime.closeSession(key).catch(() => {}),
        ),
      ),
    );
    this.keys.clear();
    this.used.clear();
  }

  /** Hears when Claude's background work may have changed, or a session ended with it. */
  onPending(listener: () => void) {
    this.pendingListeners.add(listener);
    return () => void this.pendingListeners.delete(listener);
  }

  /** A Claude session of the thread still runs. */
  live(chatId: string) {
    return this.of(chatId).some(claudeLive);
  }

  stopListening() {
    this.unhear();
    clearInterval(this.sweep);
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

  /** Each live session of the thread whose agent started subagents, with that agent. */
  private subagentSources(chatId: string) {
    const keys = this.of(chatId);
    return agentRuntimes().flatMap(([provider, runtime]) =>
      keys.flatMap((key) => {
        const source = runtime.subagents?.(key);
        return source ? [{ provider, source }] : [];
      }),
    );
  }

  /** Every run the thread's live sessions know, whole. */
  private liveRuns(chatId: string): SubagentDetail[] {
    return this.subagentSources(chatId).flatMap(({ provider, source }) =>
      source.list().flatMap((run) => {
        const detail = source.detail(run.id);
        return detail ? [{ ...detail, provider }] : [];
      }),
    );
  }

  /** Keeps what the thread's live sessions know of their subagents on disk. */
  async keepSubagents(chatId: string) {
    try {
      // Read now: a closing session's runs are gone once it has closed.
      const runs = this.liveRuns(chatId);
      await this.archive.keep(chatId, runs);
    } catch (error) {
      console.warn("Could not keep a thread's subagents:", error);
    }
  }

  /** Drops what was kept of a deleted thread's subagents, after any keep still under way. */
  forgetSubagents(chatId: string) {
    return this.archive.forget(chatId);
  }

  /** Before Relay quits or restarts, which ends what follows them. */
  async keepAllSubagents() {
    await Promise.all([...this.chats()].map((id) => this.keepSubagents(id)));
    await Promise.allSettled(this.archive.pending());
  }

  /** The subagents started in a thread, its side conversations' too, live or kept. */
  async subagents(chatId: string) {
    const live = this.subagentSources(chatId).flatMap(({ provider, source }) =>
      source.list().map((run) => ({ ...run, provider })),
    );
    const ids = new Set(live.map((run) => run.id));
    const kept = (await this.archive.read(chatId))
      .filter((run) => !ids.has(run.id))
      .map(({ trace: _, report: __, ...run }) => run);
    return [...kept, ...live];
  }

  async subagentRun(chatId: string, agentId: string) {
    for (const { provider, source } of this.subagentSources(chatId)) {
      const run = source.detail(agentId);
      if (run) return { ...run, provider };
    }
    const kept = await this.archive.read(chatId);
    return kept.find((run) => run.id === agentId) ?? null;
  }

  /** What fills the live provider session on this conversation. */
  contextReport(
    chatId: string,
    provider: AgentProvider,
    usage: ContextUsage,
    parentId?: string,
  ) {
    const key = this.key(chatId, parentId);
    return this.keys.has(key)
      ? (agentRuntime(provider).contextReport?.(key, usage) ??
          Promise.resolve(null))
      : Promise.resolve(null);
  }

  async stopSubagent(chatId: string, agentId: string) {
    const found = this.subagentSources(chatId).find(({ source }) =>
      source.detail(agentId),
    );
    if (!found) throw new Error("That agent has already finished.");
    await found.source.stop(agentId);
  }
}
