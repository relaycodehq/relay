import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { helperFallbacks, helperProviders } from "../../shared/agents";
import {
  cleanTitle,
  generateThreadTitle,
  namesItself,
  promptTitle,
  regenerateThreadTitle,
} from "../agents/thread-titles";
import type { ChatCore } from "./core";
import { sessionInput } from "./sessions";
import { chatSummary } from "./storage";

/** A thread's name: the prompt's excerpt, then one an agent writes, or yours. */
export class ThreadTitles {
  private jobs = new Map<
    string,
    { abort: AbortController; job: Promise<void> }
  >();
  private updates = new Set<Promise<void>>();
  /** Threads a title was asked for since Relay started; a failed one is asked again after a restart. */
  private asked = new Set<string>();
  constructor(private core: ChatCore) {}

  async rename(id: string, candidate: string) {
    const title = cleanTitle(candidate);
    if (!title) throw new Error("Enter a thread name up to 120 characters.");
    const chat = await this.core.storage.load(id);
    chat.title = title;
    chat.renamed = true;
    await this.core.storage.save(chat);
    return chatSummary(chat);
  }

  /** A title the agent named the thread with as it answered. */
  heard(chat: ProjectChat, message: ChatMessage, title: string) {
    const update = this.update(chat, message, title).catch(() => {});
    this.updates.add(update);
    void update.finally(() => this.updates.delete(update));
  }

  /**
   * Generated once per thread, from the first message as soon as it's sent;
   * a message of only screenshots waits for the first answer. The prompt
   * excerpt stays until a title lands.
   */
  generate(
    chat: ProjectChat,
    choice: ProjectChatSend["choice"],
    answer?: ChatMessage,
  ) {
    const firstUser = chat.messages.find((m) => m.role === "user");
    const provider = answer?.provider ?? firstUser?.provider;
    if (
      this.core.closing() ||
      !firstUser ||
      !provider ||
      (!answer && !namesItself(firstUser.body)) ||
      chat.renamed ||
      chat.title !== promptTitle(firstUser.body) ||
      this.asked.has(chat.id)
    )
      return;
    // A title can come back as the excerpt; asking again would never end.
    this.asked.add(chat.id);
    const titleAbort = new AbortController();
    const job = (async () => {
      // One exhausted or unavailable CLI must not leave every thread named
      // after its prompt, so try the helper agents next.
      for (const by of helperFallbacks(provider)) {
        try {
          const title = await generateThreadTitle({
            user: firstUser.body,
            answer: answer?.body,
            provider: by,
            // The other provider cannot use this provider's model id.
            choice: by === provider ? choice : { ...choice, model: "" },
            signal: titleAbort.signal,
          });
          if (titleAbort.signal.aborted) return;
          if (title) return await this.update(chat, answer ?? firstUser, title);
        } catch (error) {
          if (titleAbort.signal.aborted) return;
          console.warn(
            `Thread title via ${by} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    })().finally(() => this.jobs.delete(chat.id));
    this.jobs.set(chat.id, { abort: titleAbort, job });
  }

  /** Retries titles for threads whose first title run failed earlier. */
  ensure(id: string) {
    const chat = this.core.storage.cached(id);
    if (!chat || chat.shared) return;
    const firstUser = chat.messages.find((m) => m.role === "user");
    const answer = chat.messages.find(
      (m) => m.role === "assistant" && m.status === "complete" && !m.parentId,
    );
    const provider = answer?.provider ?? firstUser?.provider;
    if (!provider) return;
    this.generate(
      chat,
      sessionInput(chat, provider, this.core.store).choice,
      answer,
    );
  }

  private async update(
    chat: ProjectChat,
    message: ChatMessage,
    candidate: string,
  ) {
    const title = cleanTitle(candidate);
    const firstUser = chat.messages.find((m) => m.role === "user");
    if (
      !title ||
      !firstUser ||
      chat.renamed ||
      chat.title !== promptTitle(firstUser.body) ||
      title === chat.title
    )
      return;
    chat.title = title;
    await this.core.storage.save(chat);
    this.core.emit({
      chatId: chat.id,
      message: structuredClone(message),
      title,
    });
  }

  /**
   * Names the thread again from the whole conversation, on demand, even over
   * a name you typed. Tries the latest answer's agent, then the helper agents.
   */
  async regenerate(id: string) {
    const chat = await this.core.storage.load(id);
    if (this.jobs.has(id))
      throw new Error("This thread's title is already being generated.");
    const answer = [...chat.messages]
      .reverse()
      .find(
        (m) => m.role === "assistant" && m.status === "complete" && !m.parentId,
      );
    if (!answer)
      throw new Error("Wait for the first answer to name the thread.");
    const abort = new AbortController();
    const job = (async () => {
      const choice = sessionInput(
        chat,
        answer.provider,
        this.core.store,
      ).choice;
      for (const provider of [
        answer.provider,
        ...helperProviders.filter((p) => p !== answer.provider),
      ]) {
        try {
          const title = await regenerateThreadTitle({
            previous: chat.title,
            messages: chat.messages,
            provider,
            choice:
              provider === answer.provider ? choice : { ...choice, model: "" },
            signal: abort.signal,
          });
          if (title || abort.signal.aborted) return title;
        } catch (error) {
          if (abort.signal.aborted) return null;
          console.warn(
            `Regenerating a thread title via ${provider} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      return null;
    })();
    this.jobs.set(id, { abort, job: job.then(() => {}) });
    const title = await job.finally(() => this.jobs.delete(id));
    if (abort.signal.aborted) throw new Error("Relay is closing.");
    if (!title) throw new Error("No agent could name this thread.");
    const fresh = await this.core.storage.load(id);
    fresh.title = title;
    delete fresh.renamed;
    await this.core.storage.save(fresh);
    return chatSummary(fresh);
  }

  /** Relay is closing; titles still being asked for stop. */
  abort() {
    for (const a of this.jobs.values()) a.abort.abort();
  }
  running() {
    return [...this.jobs.values()].map((a) => a.job);
  }
  writing() {
    return [...this.updates];
  }
}
