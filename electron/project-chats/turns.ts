import { randomUUID } from "node:crypto";
import type {
  AgentProvider,
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
  ResumeSettings,
} from "../../shared/projects";
import { replyRoot } from "../../shared/projects";
import type { LineQuestion } from "../../shared/questions";
import { agentAsked, sentAgent } from "../../shared/recipient";
import { agentName, agents, helperProviders } from "../../shared/agents";
import { agentRuntime, agentRuntimes } from "../agents";
import { streamingAnswer } from "./answer-recorder";
import type { ChatTurn } from "./chat-turn";
import { currentBranchOrNull } from "../git/git";
import { codexSkills, type CodexSkill } from "../agents/provider-commands";
import { promptTitle } from "../agents/thread-titles";
import { turnPrompt } from "./turn-prompt";
import type { ActiveChat } from "./active";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { assertHere } from "./handoff";
import type { ChatQueue } from "./queue";
import { interrupt } from "./revive";
import { agentSession, parseSessionKey, sessionInput } from "./sessions";
import type { ChatSharing } from "./sharing";
import type { ThreadTitles } from "./titles";
import { forkFor, type TurnRunner } from "./turn-run";
import type { ThreadWorktrees } from "./worktrees";

/** The outgoing agent gets this long to write its note before the switch goes ahead without one. */
const HANDOFF_TIMEOUT = 120000;
/** Asked of the agent whose session ends here, in that session, so it can draw on everything it did. */
const handoffPrompt = (to: AgentProvider, computer?: string) =>
  `${
    computer
      ? `This conversation moves to another computer, ${computer}, from here. ${agentName(to)} picks it up there in a fresh session that cannot see yours; everything in the working tree is committed and goes with it.`
      : `${agentName(to)} is taking over this conversation from here and cannot see your session.`
  } Write a handoff note for it: the user's goal, what you did (files read or changed, commands run), what you found, decisions and their reasons, and what remains or should be verified next. Use concrete file paths. Answer from what you already know without running tools or changing anything. Keep it under 500 words.`;

export interface TurnsHost {
  /** Pulls a shared thread's messages and reads it back. */
  sync(id: string): Promise<unknown>;
  /** A reply ended on `messageId`, perhaps stopped by a usage limit. */
  ended(id: string, messageId: string): Promise<void>;
}

/**
 * Starts and ends a thread's turns: a message going out, the agent that
 * answered last briefing the next, Claude's own turns, a council's lead,
 * compacting, carrying on after a stop or a restart.
 */
export class ChatTurns {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private sharing: ChatSharing,
    private runner: TurnRunner,
    private titles: ThreadTitles,
    private councils: Councils,
    private queue: ChatQueue,
    private evidence:
      | ((chat: ProjectChat, selection: LineQuestion) => Promise<unknown>)
      | undefined,
    private host: TurnsHost,
  ) {}

  /**
   * Ends a run. The finished answer moved `updated`, so the sidebar summary
   * catches up, but only once the thread no longer counts as active; then a
   * deep review or Ultraplan takes its next step and queued messages go out.
   */
  private endRun(
    chat: ProjectChat,
    active: ActiveChat,
    turn?: { request?: string; answer?: string },
  ) {
    this.core.active.release(chat.id, active);
    // A steer the agent never confirmed reading still went to it; stop waiting.
    const unread = chat.messages.filter((m) => m.unread);
    for (const m of unread) {
      delete m.unread;
      m.version++;
      this.core.emit({ chatId: chat.id, message: structuredClone(m) });
    }
    if (unread.length) void this.core.storage.save(chat).catch(() => {});
    if (turn) this.councils.step(chat.id, turn);
    if (turn?.answer)
      void this.host
        .ended(chat.id, turn.answer)
        .catch((e) => console.warn("Could not plan the resume:", e));
    void this.core.storage.updateSummary(chat).catch(() => {});
    void this.core
      .control(chat.id, () => this.queue.drain(chat.id))
      .catch(() => {});
  }
  resume(id: string, settings?: ResumeSettings) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      if (this.core.active.has(id))
        throw new Error("This thread is already running.");
      if (!chat.lastInput)
        throw new Error(
          "Send a follow-up message to continue this conversation.",
        );
      // Picking another agent before resuming hands the work to it.
      const provider = settings?.provider ?? sentAgent(chat.lastInput);
      await this.sendNow(id, {
        ...chat.lastInput,
        ...(settings && { contextWindow: undefined }),
        ...settings,
        id: randomUUID(),
        to: provider,
        body: `@${provider} Continue from where the previous response was stopped. Check what has already been done before repeating any actions.`,
        images: undefined,
        selection: undefined,
        delivery: undefined,
        // Carrying on doesn't call another council.
        ultraplan: undefined,
      });
    });
  }
  async sendNow(id: string, input: ProjectChatSend) {
    const active = this.core.active.claim(id, input);
    try {
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      if (!chat.worktree && !chat.thinker)
        this.core.projects.assertCheckoutAvailable(chat.projectId);
      const root = await this.worktrees.root(chat, input.body);
      if (chat.shared) await this.host.sync(id);
      if (chat.messages.some((m) => m.id === input.id)) {
        this.core.active.release(id, active);
        return;
      }
      const asked = agentAsked(input);
      const skillMatches = [
        ...(asked?.question ?? "").matchAll(
          /(?:^|\s)(\/skill:|\$)([A-Za-z_][A-Za-z0-9_.:-]*)/g,
        ),
      ];
      let skills: CodexSkill[] = [];
      if (skillMatches.length && asked && agents[asked.provider].skills) {
        const available = await codexSkills(root);
        for (const match of skillMatches) {
          const skill = available.find((s) => s.name === match[2]);
          if (!skill && match[1] === "/skill:")
            throw new Error(
              `This ${agentName(asked.provider)} skill is no longer available. Refresh the command menu.`,
            );
          if (skill && !skills.some((s) => s.name === skill.name))
            skills.push(skill);
        }
        if (skills.length > 10)
          throw new Error("Choose at most ten skills per message.");
      } else if (skillMatches.some((m) => m[1] === "/skill:"))
        throw new Error(
          `This skill belongs to ${helperProviders
            .filter((p) => agents[p].skills)
            .map(agentName)
            .join(" or ")}. Select it to run the skill.`,
        );
      if (chat.shared && asked && !agents[asked.provider].helper)
        throw new Error(
          `${agentName(asked.provider)} can't answer in shared conversations yet. Pick ${helperProviders.map(agentName).join(" or ")}, or start a private thread.`,
        );
      if (chat.shared && input.images?.length)
        throw new Error(
          "Screenshots cannot be sent to shared conversations yet. Start a private thread for image questions.",
        );
      const parent = input.parentId
        ? replyRoot(chat.messages, input.parentId)
        : undefined;
      input = { ...input, parentId: parent?.id };
      active.input = input;
      if (asked && !asked.question && !input.images?.length)
        throw new Error("Add a question after the agent mention.");
      if (input.ultraplan) {
        if (!asked) throw new Error("Ultraplan needs an agent to lead it.");
        if (parent || chat.shared || chat.scope.kind === "review")
          throw new Error(
            "Ultraplan runs in the main conversation of a private thread.",
          );
        if (/^\//.test(asked.question))
          throw new Error("Ultraplan can't run a command. Ask a question.");
        // The lead plans; nobody edits until you ask it to build.
        input = { ...input, interactionMode: "plan" };
        active.input = input;
      }
      let evidence: unknown;
      if (input.selection && asked) {
        if (!this.evidence || chat.scope.kind !== "pr")
          throw new Error(
            "Open a PR conversation before asking about selected review lines.",
          );
        evidence = await this.evidence(chat, input.selection);
      }
      const user: ChatMessage = {
        id: input.id,
        role: "user",
        body: input.body,
        status: "complete",
        created: Date.now(),
        provider: asked?.provider ?? input.provider,
        version: 1,
        ...(input.images?.length
          ? { images: await this.core.storage.saveImages(id, input.images) }
          : {}),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(chat.shared ? { pending: true } : {}),
      };
      chat.messages.push(user);
      // Anything said after a limit stopped the answer replaces carrying it on.
      delete chat.limitResume;
      this.councils.sent(chat, input);
      chat.updated = Date.now();
      chat.branch = (await currentBranchOrNull(root)) ?? chat.branch;
      if (chat.messages.length === 1 && !chat.renamed)
        chat.title = promptTitle(input.body);
      this.core.storage.keep(chat);
      await this.core.storage.persist(chat);
      this.core.emit({ chatId: id, message: user });
      if (chat.messages.length === 1) this.titles.generate(chat, input.choice);
      if (chat.shared) await this.sharing.deliver(chat).catch(() => {});
      if (!asked) {
        this.core.active.release(id, active);
        return;
      }
      // The message is in. A handoff note can take minutes; the answer
      // starts after it without holding up the send.
      void this.start(chat, active, input, {
        asked,
        parent,
        root,
        user,
        skills,
        evidence,
      });
    } catch (e) {
      this.core.active.release(id, active);
      throw e;
    }
  }
  /** Everything after the message is in: a handoff note if another agent takes over, then the answer. */
  private async start(
    chat: ProjectChat,
    active: ActiveChat,
    input: ProjectChatSend,
    {
      asked,
      parent,
      root,
      user,
      skills,
      evidence,
    }: {
      asked: NonNullable<ReturnType<typeof agentAsked>>;
      parent: ChatMessage | undefined;
      root: string;
      user: ChatMessage;
      skills: CodexSkill[];
      evidence: unknown;
    },
  ) {
    const id = chat.id;
    try {
      // A side conversation continues the main one as it stood at its message.
      const upToParent = new Set(
        parent
          ? chat.messages
              .slice(0, chat.messages.indexOf(parent) + 1)
              .filter((m) => !m.parentId)
              .map((m) => m.id)
          : [],
      );
      const onBranch = (m: ChatMessage) =>
        parent ? m.parentId === parent.id || upToParent.has(m.id) : !m.parentId;
      // Some agents only run a command or skill when the message starts with
      // it, so a command goes out alone.
      const command =
        agents[asked.provider].commandsAlone &&
        !chat.shared &&
        /^\/[a-zA-Z0-9_.:-]+(?:\s|$)/.test(asked.question);
      // Another agent answered last on this branch: let it brief the new one
      // first, unless a command leaves no room for the note.
      const outgoing = [...chat.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" &&
            !m.compaction &&
            !m.handoff &&
            onBranch(m),
        );
      const handoffFrom =
        !command &&
        outgoing &&
        outgoing.provider !== asked.provider &&
        outgoing.status !== "failed" &&
        agentSession(chat, outgoing.provider, parent?.id).thread
          ? outgoing.provider
          : undefined;
      const note = handoffFrom
        ? await this.handoff(
            chat,
            root,
            handoffFrom,
            asked.provider,
            parent?.id,
            active,
          )
        : undefined;
      const answer = streamingAnswer(asked.provider, {
        // With a council, the lead's first answer is its brief.
        ...(input.ultraplan ? { brief: true } : {}),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(chat.shared ? { pending: true } : {}),
      });
      chat.lastInput = { ...input, images: undefined };
      chat.messages.push(answer);
      if (input.ultraplan)
        this.councils.begin(chat, input, asked.provider, answer.id);
      await this.core.storage.save(chat);
      this.core.emit({ chatId: id, message: answer });
      const { prompt, caughtUp, briefed } = turnPrompt({
        chat,
        input,
        provider: asked.provider,
        question: asked.question,
        parent,
        previous: chat.messages.filter(
          (m) =>
            m.id !== user.id && m.id !== answer.id && onBranch(m) && !m.side,
        ),
        session: agentSession(chat, asked.provider, parent?.id),
        fork: forkFor(chat, asked.provider, parent?.id),
        command,
        note,
        evidence,
      });
      this.reply(chat, active, answer, root, prompt, input, {
        kind: "reply",
        skills,
        caughtUp,
        briefed,
      });
    } catch (e) {
      // The send already went through, so the thread shows the failure.
      this.core.active.release(id, active);
      const failed: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        body: "",
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        provider: asked.provider,
        created: Date.now(),
        version: 1,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      };
      chat.messages.push(failed);
      if (chat.queue?.length) chat.queuePaused = true;
      await this.core.storage.save(chat).catch(() => {});
      this.core.emit({ chatId: id, message: failed });
    }
  }
  /**
   * Runs `answer` as the thread's reply to `input`. When it ends the thread
   * goes idle, a deep review moves on, and queued messages go out.
   */
  private reply(
    chat: ProjectChat,
    active: ActiveChat,
    answer: ChatMessage,
    root: string,
    prompt: string,
    input: ProjectChatSend,
    turn: ChatTurn & { kind: "reply" } = { kind: "reply" },
  ) {
    active.job = this.runner
      .run(chat, answer, root, prompt, input, active.abort, turn)
      .then((last) => {
        answer = last;
      })
      .finally(() =>
        this.endRun(chat, active, { request: input.id, answer: answer.id }),
      );
    void active.job.catch(() => {});
  }
  /**
   * Asks the agent that answered last to brief the one taking over. Best effort:
   * a failed or slow note leaves a marker and the switch proceeds without it.
   */
  async handoff(
    chat: ProjectChat,
    root: string,
    from: AgentProvider,
    to: AgentProvider,
    parentId: string | undefined,
    active: ActiveChat,
    computer?: string,
  ): Promise<ChatMessage> {
    const input = sessionInput(chat, from, this.core.store, parentId);
    const message = streamingAnswer(from, {
      handoff: { from, to, ...(computer ? { computer } : {}) },
      ...(parentId ? { parentId } : {}),
    });
    chat.messages.push(message);
    await this.core.storage.save(chat);
    this.core.emit({ chatId: chat.id, message: structuredClone(message) });
    const abort = new AbortController();
    const stop = () => abort.abort();
    active.abort.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, HANDOFF_TIMEOUT);
    try {
      await this.runner.run(
        chat,
        message,
        root,
        handoffPrompt(to, computer),
        input,
        abort,
        { kind: "handoff" },
      );
    } finally {
      clearTimeout(timer);
      active.abort.signal.removeEventListener("abort", stop);
    }
    return message;
  }
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
    const idle = !this.core.active.has(chat.id);
    const active = idle
      ? this.core.active.claim(chat.id, input)
      : this.core.active.create(chat.id, input);
    const { abort } = active;
    const message: ChatMessage =
      resumed ??
      streamingAnswer(provider, {
        unprompted: true,
        ...(parentId ? { parentId } : {}),
        ...(chat.shared ? { pending: true } : {}),
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
      if (idle) this.endRun(chat, active);
    }
  }
  /**
   * Takes back the agent sessions that kept running while Relay restarted.
   * A turn one was in carries on in the answer it was writing.
   */
  reattach() {
    const back = Promise.all(
      Object.entries(agentRuntimes).map(async ([provider, runtime]) =>
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
      (sessions) =>
        void Promise.allSettled(
          sessions
            .filter((s) => s.open)
            .map(({ key, provider }) => this.resumeTurn(key, provider)),
        ),
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
    try {
      chat = await this.core.storage.load(chatId);
      this.core.sessions.resumed(key);
      const message = [...chat.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" &&
            m.status === "streaming" &&
            m.provider === provider &&
            (m.parentId ?? undefined) === branch,
        );
      // Reviewers and thinkers answer a step Relay drove; that step is gone.
      if (chat.reviewer || chat.thinker)
        throw new Error("This thread's turns can't be picked back up.");
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
        if (failed) await this.core.storage.save(chat).catch(() => {});
      }
      console.warn("Could not pick a turn back up:", e);
    }
  }
  /**
   * The lead's first turn in a deep review. It answers the review request,
   * so it has no user message of its own; later turns are ordinary ones.
   */
  async lead(chat: ProjectChat, input: ProjectChatSend, prompt: string) {
    if (this.core.closing()) throw new Error("Relay is closing.");
    const active = this.core.active.claim(chat.id, input);
    const message = streamingAnswer(input.provider);
    try {
      const root = await this.core.projects.root(chat.projectId);
      // Resume and later sends pick the lead's agent and settings up from here.
      chat.lastInput = input;
      chat.messages.push(message);
      await this.core.storage.persist(chat);
      this.core.emit({ chatId: chat.id, message: structuredClone(message) });
      this.reply(chat, active, message, root, prompt, input);
    } catch (e) {
      this.core.active.release(chat.id, active);
      throw e;
    }
  }
  /** Compacts the provider session behind the newest answer on this branch. */
  compact(id: string, parentId?: string, instructions?: string) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      if (this.core.active.has(id))
        throw new Error("Wait for the current answer before compacting.");
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      if (parentId && chat.messages.find((m) => m.id === parentId)?.side)
        throw new Error(
          "A side question has no session of its own to compact.",
        );
      const root = await this.worktrees.root(chat);
      const latest = [...chat.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" && (m.parentId ?? undefined) === parentId,
        );
      const provider = latest?.provider;
      if (!provider || !agentSession(chat, provider, parentId).thread)
        throw new Error("There is no agent session to compact yet.");
      if (instructions && !agents[provider].compactInstructions)
        throw new Error(
          `${agentName(provider)} compacts without custom instructions.`,
        );
      const input = sessionInput(chat, provider, this.core.store, parentId);
      const active = this.core.active.claim(id, input);
      const { abort } = active;
      const message = streamingAnswer(provider, {
        compaction: true,
        ...(parentId ? { parentId } : {}),
      });
      chat.messages.push(message);
      try {
        await this.core.storage.save(chat);
      } catch (e) {
        this.core.active.release(id, active);
        throw e;
      }
      this.core.emit({ chatId: id, message });
      active.job = this.runner
        .run(chat, message, root, instructions ?? "", input, abort, {
          kind: "compact",
        })
        .finally(() => this.endRun(chat, active));
      void active.job.catch(() => {});
    });
  }
}
