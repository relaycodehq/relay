import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { replyRoot } from "../../shared/projects";
import { agentAsked } from "../../shared/recipient";
import { agentName, agentInfo } from "../../shared/agents";
import { compactsCold, latestContext } from "../../shared/context-usage";
import { streamingAnswer } from "./answer-recorder";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { assertHere } from "./handoff";
import type { ChatQueue } from "./queue";
import { agentSession, sessionInput } from "./sessions";
import type { RunEnds } from "./turn-end";
import type { TurnRunner } from "./turn-run";
import type { ThreadWorktrees } from "./worktrees";

/** Compacting an agent's session: asked for, before a cold cache, or while idle. */
export class Compactions {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private runner: TurnRunner,
    private councils: Councils,
    private queue: ChatQueue,
    private ends: RunEnds,
  ) {}
  /**
   * Compacts the provider session behind the newest answer on this branch,
   * or queues compacting it right after the running answer.
   */
  request(id: string, parentId?: string, instructions?: string) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      await this.core.active.finished(id);
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      if (parentId && chat.messages.find((m) => m.id === parentId)?.side)
        throw new Error(
          "A side question has no session of its own to compact.",
        );
      const running = this.core.active.get(id);
      if (!running && !this.councils.busy(chat)) {
        // Compacting now does what one queued for this conversation would.
        const queued = chat.queue?.find(
          (q) => q.compact && (q.input.parentId ?? undefined) === parentId,
        );
        if (queued) {
          chat.queue = chat.queue!.filter((q) => q !== queued);
          await this.core.storage.save(chat);
        }
        return this.now(id, parentId, instructions);
      }
      if (chat.messages.some((m) => m.compaction && m.status === "streaming"))
        throw new Error("The session is already compacting.");
      // The running answer's agent, when it answers on this branch, is the
      // one whose session will be newest by the time this goes.
      const provider =
        (running?.input && (running.input.parentId ?? undefined) === parentId
          ? agentAsked(running.input)?.provider
          : undefined) ?? latestAnswer(chat, parentId)?.provider;
      if (!provider)
        throw new Error("There is no agent session to compact yet.");
      if (instructions && !agentInfo(provider).compactInstructions)
        throw new Error(
          `${agentName(provider)} compacts without custom instructions.`,
        );
      await this.queue.addCompact(chat, {
        ...sessionInput(chat, provider, this.core.store, parentId),
        body: instructions ? `/compact ${instructions}` : "/compact",
      });
    });
  }
  /**
   * Compacts before a message that finds a big conversation's prompt cache
   * cold, for a caller holding the thread's control. The message waits in
   * the queue behind the compaction; false leaves sending it to the caller.
   */
  async firstIfCold(id: string, input: ProjectChatSend) {
    const chat = await this.core.storage.load(id);
    const asked = agentAsked(input);
    // Behind other queued messages it would jump their order; a command
    // like /compact or /goal means what it says.
    if (
      !asked ||
      chat.queue?.length ||
      chat.queuePaused ||
      /^\s*\//.test(asked.question)
    )
      return false;
    const parentId = input.parentId
      ? replyRoot(chat.messages, input.parentId).id
      : undefined;
    const held = latestContext(
      chat.messages.filter((m) => (m.parentId ?? undefined) === parentId),
    );
    if (
      !held ||
      held.provider !== asked.provider ||
      latestAnswer(chat, parentId)?.provider !== asked.provider ||
      !agentSession(chat, asked.provider, parentId).thread ||
      !compactsCold(held.usage, Date.now())
    )
      return false;
    await this.queue.add(id, { ...input, delivery: undefined });
    try {
      await this.now(id, parentId, undefined, "cold");
    } catch (e) {
      console.warn("Could not compact the cold conversation first:", e);
      await this.queue.drain(id);
    }
    return true;
  }
  /** Compacts now, for a caller already holding the thread's control. */
  async now(
    id: string,
    parentId?: string,
    instructions?: string,
    /** Relay compacted unasked: the cache went cold, or was about to while idle. */
    unasked?: "cold" | "idle",
  ) {
    if (this.core.active.has(id))
      throw new Error("Wait for the current answer before compacting.");
    const chat = await this.core.storage.load(id);
    assertHere(chat);
    const root = await this.worktrees.root(chat);
    const provider = latestAnswer(chat, parentId)?.provider;
    if (!provider || !agentSession(chat, provider, parentId).thread)
      throw new Error("There is no agent session to compact yet.");
    if (instructions && !agentInfo(provider).compactInstructions)
      throw new Error(
        `${agentName(provider)} compacts without custom instructions.`,
      );
    // Quitting began while this looked for the session: one Relay started
    // unasked waits for the next launch instead of holding up the quit.
    if (unasked && this.core.closing()) return;
    const input = sessionInput(chat, provider, this.core.store, parentId);
    const active = this.core.active.claim(id, input, "compaction");
    const { abort } = active;
    const before = latestContext(
      chat.messages.filter((m) => (m.parentId ?? undefined) === parentId),
    )?.usage.usedTokens;
    const message = streamingAnswer(provider, {
      compaction: true,
      ...(before ? { compactedFrom: before } : {}),
      ...(unasked === "cold" && { compactedCold: true as const }),
      ...(unasked === "idle" && { compactedIdle: true as const }),
      ...(parentId ? { parentId } : {}),
    });
    chat.messages.push(message);
    try {
      await this.core.storage.save(chat);
    } catch (e) {
      this.core.active.release(id, active);
      throw e;
    }
    this.core.emit({ chatId: id, message: structuredClone(message) });
    active.job = this.runner
      .run(chat, message, root, instructions ?? "", input, abort, {
        kind: "compact",
      })
      .finally(() => this.ends.run(chat, active));
    void active.job.catch((e) =>
      console.warn("Could not save the compaction:", e),
    );
  }
}


/** The newest answer in a conversation: the main one, or a side one by its root. */
const latestAnswer = (chat: ProjectChat, parentId?: string) =>
  [...chat.messages]
    .reverse()
    .find(
      (m) => m.role === "assistant" && (m.parentId ?? undefined) === parentId,
    );
