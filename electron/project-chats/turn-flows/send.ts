import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
  ResumeSettings,
} from "../../../shared/projects";
import {
  onComputerMessage,
  replyRoot,
  sentBy,
  sentSettingsOf,
  threadWorktree,
} from "../../../shared/projects";
import type { LineQuestion } from "../../../shared/questions";
import { agentAsked, sentAgent } from "../../../shared/recipient";
import { agentInfo } from "../../../shared/agents";
import { parseGoalCommand } from "../../../shared/goal";
import { streamingAnswer } from "../answer-recorder";
import type { ChatTurn } from "../chat-turn";
import { checkedOutOr } from "../../git/git";
import { promptTitle } from "../../agents/thread-titles";
import { turnPrompt } from "../turn-prompt";
import type { ActiveChat } from "../active";
import type { ChatCore } from "../core";
import type { Councils } from "../councils";
import { assertHere } from "../handoff";
import { supersedeQuestions } from "../async-questions";
import { startFixing } from "../../findings";
import { agentSession } from "../sessions";
import type { ThreadTitles } from "../titles";
import type { TurnEndings } from "./end";
import type { TurnHandoffs } from "./handoff-notes";
import { forkFor, type TurnRunner } from "../turn-run";
import type { ThreadWorktrees } from "../worktrees";
import { errorMessage } from "../../../shared/error-message";

/** How long a new worktree's first turn waits for the title it's named after. */
const TITLE_WAIT_MS = 8000;

/**
 * A message going out and the answer to it, a council's lead, and carrying
 * on after a stop. Handoff notes, recovery, compaction and how a run ends
 * live beside this in handoff-notes, recovery, compaction and end.
 */
export class TurnSends {
  /** Sends whose message is in and whose answer hasn't started its agent yet. */
  private starts = new Set<Promise<unknown>>();
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private runner: TurnRunner,
    private titles: ThreadTitles,
    private councils: Councils,
    private handoffs: TurnHandoffs,
    private ends: TurnEndings,
    private evidence:
      | ((chat: ProjectChat, selection: LineQuestion) => Promise<unknown>)
      | undefined,
  ) {}

  starting() {
    return [...this.starts];
  }
  resume(id: string, settings?: ResumeSettings) {
    return this.core.control(id, async () => {
      // The stop paused the queue behind the answer; carrying it on picks
      // the queue up after it, as asking again by hand does.
      const chat = await this.core.storage.load(id);
      const unpause = !!chat.queue?.length && !!chat.queuePaused;
      if (unpause) {
        delete chat.queuePaused;
        await this.core.storage.save(chat);
      }
      try {
        await this.resumeHeld(id, settings);
      } catch (e) {
        if (unpause) {
          chat.queuePaused = true;
          await this.core.storage.save(chat);
        }
        throw e;
      }
    });
  }
  /**
   * Resumes a turn stopped to get a waiting steer read, if the agent did
   * miss it. One it picked up just before the stop leaves the thread
   * stopped, as any stop does.
   */
  resumeMissed(id: string) {
    return this.core.control(id, async () => {
      await this.core.active.finished(id);
      const chat = await this.core.storage.load(id);
      const last = chat.lastInput;
      if (
        this.core.active.has(id) ||
        !last ||
        !chat.messages.some(
          (m) =>
            m.missed &&
            m.provider === sentAgent(last) &&
            (m.parentId ?? null) === (last.parentId ?? null),
        )
      )
        return;
      await this.resumeHeld(id);
    });
  }
  /** Resume for a job that already holds the thread's control. */
  async resumeHeld(id: string, settings?: ResumeSettings) {
    if (this.core.closing()) throw new Error("Relay is closing.");
    const chat = await this.core.storage.load(id);
    assertHere(chat);
    await this.core.active.finished(id);
    if (this.core.active.has(id))
      throw new Error("This thread is already running.");
    if (!chat.lastInput)
      throw new Error(
        "Send a follow-up message to continue this conversation.",
      );
    // Picking another agent before resuming hands the work to it.
    const provider = settings?.provider ?? sentAgent(chat.lastInput);
    // Steers the stopped turn never read lead the prompt; a plain "continue"
    // after them would carry on with what they meant to change.
    const missed = chat.messages.some(
      (m) =>
        m.missed &&
        m.provider === provider &&
        (m.parentId ?? null) === (chat.lastInput!.parentId ?? null),
    );
    await this.sendNow(
      id,
      {
        ...chat.lastInput,
        ...(settings && { contextWindow: undefined }),
        ...settings,
        id: randomUUID(),
        to: provider,
        body: missed
          ? `@${provider} Your previous response was stopped before you read what I wrote above. Check what has already been done before repeating any actions.`
          : `@${provider} Continue from where the previous response was stopped. Check what has already been done before repeating any actions.`,
        asyncQuestionAnswer: undefined,
        questionMessageId: undefined,
        pageAnswer: undefined,
        images: undefined,
        selection: undefined,
        delivery: undefined,
      },
      true,
    );
  }
  /** `answer` false keeps the message without a turn, for another computer to answer. */
  async sendNow(
    id: string,
    input: ProjectChatSend,
    resumed = false,
    answer = true,
  ) {
    const active = this.core.active.claim(id, input);
    try {
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      // A project on another computer only keeps the message here, for that
      // computer to answer; its folder isn't on this one.
      const project = this.core.projects.get(chat.projectId);
      if (project.computer && answer)
        throw new Error(onComputerMessage(project));
      await this.worktrees.agents.refresh(chat);
      if (!chat.worktree && !threadWorktree(chat) && !project.computer)
        this.core.projects.assertCheckoutAvailable(chat.projectId);
      // Sent again after it went in: nothing to check, move or start.
      if (chat.messages.some((m) => m.id === input.id)) {
        this.core.active.release(id, active);
        return;
      }
      const asked = agentAsked(input);
      const parent = input.parentId
        ? replyRoot(chat.messages, input.parentId)
        : undefined;
      input = { ...input, parentId: parent?.id };
      active.input = input;
      if (asked && !asked.question && !input.images?.length)
        throw new Error("Add a question after the agent mention.");
      const goal = asked && parseGoalCommand(asked.question);
      if (goal) {
        if (asked.provider !== "codex" && asked.provider !== "claude")
          throw new Error(
            "Only Codex and Claude Code keep working toward a goal.",
          );
        // Claude would take the word for a new objective.
        if (
          asked.provider === "claude" &&
          (goal.type === "pause" || goal.type === "resume")
        )
          throw new Error(
            "Claude Code can't pause or resume a goal. /goal clear ends it.",
          );
        if (parent)
          throw new Error("Set a goal in the thread's main conversation.");
      }
      let evidence: unknown;
      if (input.selection && asked) {
        if (!this.evidence || chat.scope.kind !== "pr")
          throw new Error(
            "Open a PR conversation before asking about selected review lines.",
          );
        evidence = await this.evidence(chat, input.selection);
      }
      // Once the message is sure to go in, a review follows its branch to
      // wherever it's checked out, so the turn runs there.
      if (!project.computer) await this.councils.fixing(chat, input);
      const root = project.computer
        ? ""
        : await this.worktrees.root(chat, input.body, active.abort.signal);
      const user: ChatMessage = {
        id: input.id,
        role: "user",
        body: input.body,
        status: "complete",
        created: Date.now(),
        provider: asked?.provider ?? input.provider,
        version: 1,
        ...(resumed && { resumed: true }),
        ...(chat.handover?.kickoff === input.id && {
          handedOver: true as const,
        }),
        ...(input.images?.length
          ? { images: await this.core.storage.saveImages(id, input.images) }
          : {}),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...sentBy(input),
        ...(asked ? { sentSettings: sentSettingsOf(input) } : {}),
      };
      chat.messages.push(user);
      const superseded =
        asked && !resumed && !input.fromThread
          ? supersedeQuestions(chat.messages, asked.provider, input.parentId)
          : [];
      // Anything said after a limit stopped the answer replaces carrying it on.
      delete chat.limitResume;
      // A goal that ended shows until the conversation moves on.
      if (
        asked &&
        !input.parentId &&
        (chat.goal?.status === "complete" || chat.goal?.status === "failed")
      )
        delete chat.goal;
      // A fix request marks its findings as being fixed.
      startFixing(chat.findings, input);
      chat.updated = Date.now();
      if (!project.computer)
        ({ branch: chat.branch, commit: chat.commit } = await checkedOutOr(
          root,
          chat,
        ));
      if (chat.messages.length === 1 && !chat.renamed)
        chat.title = promptTitle(input.body);
      if (!answer) chat.lastInput = { ...input, images: undefined };
      this.core.storage.keep(chat);
      await this.core.storage.save(chat);
      this.core.emit({ chatId: id, message: user });
      for (const message of superseded)
        this.core.emit({ chatId: id, message: structuredClone(message) });
      if (chat.messages.length === 1) this.titles.generate(chat, input.choice);
      if (!asked || !answer) {
        this.core.active.release(id, active);
        return;
      }
      // A reviewer's review that stopped before its lead waits for it again.
      if (chat.reviewer) await this.councils.memberStarting(chat);
      // The message is in. A handoff note can take minutes; the answer
      // starts after it without holding up the send.
      const starting = this.start(chat, active, input, {
        asked,
        parent,
        root,
        user,
        evidence,
      });
      this.starts.add(starting);
      void starting.finally(() => this.starts.delete(starting));
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
      evidence,
    }: {
      asked: NonNullable<ReturnType<typeof agentAsked>>;
      parent: ChatMessage | undefined;
      root: string;
      user: ChatMessage;
      evidence: unknown;
    },
  ) {
    const id = chat.id;
    let begun: ChatMessage | undefined;
    try {
      // A new worktree takes the thread's title as its name before anything
      // runs in it; a title slower than this keeps the message's.
      if (this.worktrees.unnamed.has(id)) {
        await this.titles.settled(id, TITLE_WAIT_MS, active.abort.signal);
        root = (await this.worktrees.named(chat)) ?? root;
      }
      // A new worktree is set up before anything runs in it.
      if (!active.abort.signal.aborted)
        await this.worktrees.setup.prepare(
          chat,
          asked.provider,
          active.abort.signal,
        );
      if (active.abort.signal.aborted) {
        this.core.active.release(id, active);
        this.ends.unstarted(chat, input);
        return;
      }
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
      // Codex runs `/goal` through its goal API; Claude reads it as its own command.
      const goal =
        asked.provider === "codex" ? parseGoalCommand(asked.question) : null;
      // Some agents only run a command or skill when the message starts with
      // it, so a command goes out alone.
      const command =
        (agentInfo(asked.provider).commandsAlone || !!goal) &&
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
            !m.reload &&
            !m.worktreeCommand &&
            onBranch(m),
        );
      const switchedFrom =
        !command && outgoing && outgoing.provider !== asked.provider
          ? outgoing.provider
          : undefined;
      // An agent whose last turn failed, usually on a usage limit, can't
      // write a note either; Relay writes one from what it left instead.
      const asksNote =
        switchedFrom &&
        outgoing!.status !== "failed" &&
        agentSession(chat, switchedFrom, parent?.id).thread;
      let note = asksNote
        ? await this.handoffs.note(
            chat,
            root,
            switchedFrom,
            asked.provider,
            parent?.id,
            active,
          )
        : undefined;
      // Stopped while the outgoing agent wrote its note: no note from Relay, no answer.
      if (active.abort.signal.aborted) {
        this.core.active.release(id, active);
        this.ends.unstarted(chat, input);
        return;
      }
      if (switchedFrom && !(note?.status === "complete" && note.body.trim()))
        note = await this.handoffs.byRelay(
          chat,
          note,
          switchedFrom,
          asked.provider,
          parent?.id,
          chat.messages.filter(
            (m) => m.id !== user.id && onBranch(m) && !m.side,
          ),
        );
      const answer = (begun = streamingAnswer(asked.provider, {
        ...(input.parentId ? { parentId: input.parentId } : {}),
      }));
      chat.lastInput = { ...input, images: undefined };
      chat.messages.push(answer);
      await this.core.storage.save(chat);
      this.core.emit({ chatId: id, message: structuredClone(answer) });
      const promptInput = {
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
        historyPath: this.core.storage.historyPath(chat.id),
      };
      const { prompt, request, caughtUp, briefed, carried } =
        turnPrompt(promptInput);
      const importedPrompt =
        chat.fromTerminal && !parent && !command
          ? turnPrompt({ ...promptInput, session: {}, fork: undefined }).prompt
          : undefined;
      this.reply(chat, active, answer, root, prompt, input, {
        kind: "reply",
        request,
        importedPrompt,
        caughtUp,
        briefed,
        carried,
        ...(goal ? { goal } : {}),
      });
    } catch (e) {
      // The send already went through, so the thread shows the failure, in
      // the answer it began if it got that far.
      const error = errorMessage(e);
      let failed: ChatMessage;
      if (begun?.status === "streaming") {
        failed = begun;
        failed.status = "failed";
        failed.error = error;
        failed.version++;
      } else {
        failed = {
          id: randomUUID(),
          role: "assistant",
          body: "",
          status: "failed",
          error,
          provider: asked.provider,
          created: Date.now(),
          version: 1,
          ...(input.parentId ? { parentId: input.parentId } : {}),
        };
        chat.messages.push(failed);
      }
      if (chat.queue?.length) chat.queuePaused = true;
      // Ends the turn as failed, news like an agent's failure; a stop is no news.
      if (!active.abort.signal.aborted) active.answer = () => failed;
      this.core.active.release(id, active);
      await this.core.storage
        .save(chat)
        .catch((e) => console.warn("Could not save the failed send:", e));
      this.core.emit({ chatId: id, message: structuredClone(failed) });
      this.ends.unstarted(chat, input, failed.id);
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
    const job = this.core.active.runs(
      active,
      this.runner
        .run(chat, answer, root, prompt, input, active.abort, turn)
        .then((last) => {
          answer = last;
        })
        .finally(() =>
          this.ends.run(chat, active, { request: input.id, answer: answer.id }),
        ),
    );
    // The runner turns agent errors into a failed answer; what's left is a failed save.
    void job.catch((e) => console.warn("Could not save the answer:", e));
  }
  /**
   * The lead's first turn in a deep review. It answers the review request,
   * so it has no user message of its own; later turns are ordinary ones.
   */
  async lead(chat: ProjectChat, input: ProjectChatSend, prompt: string) {
    if (this.core.closing()) throw new Error("Relay is closing.");
    const active = this.core.active.claim(chat.id, input, "lead");
    const message = streamingAnswer(input.provider);
    try {
      const root = await this.worktrees.root(chat);
      // Resume and later sends pick the lead's agent and settings up from here.
      chat.lastInput = input;
      chat.messages.push(message);
      await this.core.storage.save(chat);
      this.core.emit({ chatId: chat.id, message: structuredClone(message) });
      this.reply(chat, active, message, root, prompt, input);
    } catch (e) {
      // Pushed but never run: it mustn't read as streaming.
      if (chat.messages.includes(message)) {
        message.status = "failed";
        message.error = errorMessage(e);
        message.version++;
        this.core.emit({ chatId: chat.id, message: structuredClone(message) });
      }
      this.core.active.release(chat.id, active);
      throw e;
    }
  }
}
