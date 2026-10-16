import type {
  AgentProvider,
  ChatMessage,
  ProjectChat,
} from "../../shared/projects";
import { agentRuntime, agentRuntimes } from "../agents";
import { streamingAnswer } from "./answer-recorder";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { interrupt } from "./revive";
import { parseSessionKey, sessionInput } from "./sessions";
import type { RunEnds } from "./turn-end";
import type { TurnRunner } from "./turn-run";
import type { ThreadWorktrees } from "./worktrees";

/**
 * Turns no message started: Claude's own, and the ones a restart cut off
 * that the agent host kept going.
 */
export class TurnRecovery {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private runner: TurnRunner,
    private councils: Councils,
    private ends: RunEnds,
  ) {}
  /**
   * Claude started a turn itself, e.g. when a background command it launched
   * finished. It gets its own answer; otherwise it would fill the next
   * question's slot and push every later answer one message down.
   */
  async unprompted(
    chat: ProjectChat,
    root: string,
    provider: AgentProvider,
    parentId?: string,
    /** The answer a restart cut off, carrying on where the session is. */
    resumed?: ChatMessage,
  ) {
    if (this.core.closing()) throw new Error("Relay is closing.");
    const input = sessionInput(chat, provider, this.core.store, parentId);
    // Usually the thread is idle and this becomes its running answer, so new
    // messages queue behind it. A prompt racing it waits in the session instead.
    // Otherwise it rides beside the running one: Stop reaches it too, and
    // the thread runs until both have ended.
    const idle = !this.core.active.has(chat.id);
    const active = idle
      ? this.core.active.claim(chat.id, input, "adopt")
      : this.core.active.create(chat.id, input, "adopt", { rides: true });
    const { abort } = active;
    const message: ChatMessage =
      resumed ??
      streamingAnswer(provider, {
        unprompted: true,
        ...(parentId ? { parentId } : {}),
      });
    try {
      if (!resumed) {
        chat.messages.push(message);
        await this.core.storage.save(chat);
      }
      this.core.emit({ chatId: chat.id, message: structuredClone(message) });
      await this.runner.run(chat, message, root, "", input, abort, {
        kind: "adopt",
        resumed,
      });
    } finally {
      // A resumed answer may be a review lead's, whose end settles the review.
      if (idle)
        this.ends.run(chat, active, resumed ? { answer: resumed.id } : undefined);
      else this.ends.rider(chat, active);
    }
  }
  /**
   * Takes back the agent sessions that kept running while Relay restarted.
   * A turn one was in carries on in the answer it was writing.
   */
  reattach() {
    const back = Promise.all(
      agentRuntimes().map(async ([provider, runtime]) =>
        (
          (await runtime.reattach?.(
            (key) =>
              this.core.sessions.owns(key, (chatId) =>
                this.core.storage.has(chatId),
              ),
            (key) => () => this.unpromptedFor(key),
          )) ?? []
        ).map((session) => ({
          ...session,
          provider: provider as AgentProvider,
        })),
      ),
    ).then((lists) => {
      const sessions = lists.flat();
      for (const { key, open } of sessions)
        this.core.sessions.reattached(key, open);
      return sessions;
    });
    this.core.storage.waitFor(
      back.then(
        () => {},
        (e) => console.warn("Could not take back the running agents:", e),
      ),
    );
    return back.then(
      async (sessions) => {
        const open = sessions.filter((s) => s.open);
        // Before any turn is picked up: a review reads whether its reviewers
        // carry on while their sessions still say so.
        await this.councils
          .reattached(open.map(({ key }) => parseSessionKey(key).chatId))
          .catch((e) => console.warn("Could not take the reviews back up:", e));
        void Promise.allSettled(
          open.map(({ key, provider }) => this.resumeTurn(key, provider)),
        );
      },
      () => {},
    );
  }
  private async unpromptedFor(key: string) {
    const { chatId, branch } = parseSessionKey(key);
    const chat = await this.core.storage.load(chatId);
    return this.unprompted(
      chat,
      await this.worktrees.root(chat),
      "claude",
      branch,
    );
  }
  /** Shows the rest of a turn a restart cut off, in the answer it was writing. */
  private async resumeTurn(key: string, provider: AgentProvider) {
    const { chatId, branch } = parseSessionKey(key);
    let chat: ProjectChat | undefined;
    let message: ChatMessage | undefined;
    try {
      chat = await this.core.storage.load(chatId);
      this.core.sessions.resumed(key);
      message = [...chat.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" &&
            m.status === "streaming" &&
            m.provider === provider &&
            (m.parentId ?? undefined) === branch,
        );
      await this.unprompted(
        chat,
        await this.worktrees.root(chat),
        provider,
        branch,
        message,
      );
    } catch (e) {
      this.core.sessions.lost(key);
      this.core.storage.chatChanged(chatId);
      await agentRuntime(provider)
        .closeSession(key)
        .catch(() => {});
      if (chat) {
        let failed = false;
        for (const m of chat.messages)
          if (
            m.status === "streaming" &&
            (m.parentId ?? undefined) === branch &&
            !this.core.active.has(chat.id)
          ) {
            interrupt(m);
            failed = true;
          }
        if (failed && chat.queue?.length) chat.queuePaused = true;
        if (failed)
          await this.core.storage
            .save(chat)
            .catch((e) => console.warn("Could not save the thread:", e));
        // A review lead's answer revive kept going ends here; the review fails with it.
        if (failed && !chat.reviewer && message?.status === "failed")
          await this.councils.step(chat.id, { answer: message.id });
        // A reviewer's: its review stops, and Resume runs it again.
        if (failed) await this.councils.reviewerLost(chat);
      }
      console.warn("Could not pick a turn back up:", e);
    }
  }
}
