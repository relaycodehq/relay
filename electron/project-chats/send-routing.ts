import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { onComputerMessage, replyRoot } from "../../shared/projects";
import { parseGoalCommand } from "../../shared/goal";
import { agentAsked } from "../../shared/recipient";
import type { SideQuestions } from "./asides";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { assertHere } from "./handoff";
import type { ChatQueue } from "./queue";
import type { ChatSchedule } from "./schedule";
import type { TurnCompactions } from "./turn-flows/compaction";
import type { TurnSends } from "./turn-flows/send";
import type { ThreadWorktrees } from "./worktrees";

/** What a first message needs to start its thread on another computer. */
function startableThere(input: ProjectChatSend) {
  if (input.images?.length)
    throw new Error(
      "Screenshots don't go along to another computer yet. Send it without them, or start it here.",
    );
  if (!agentAsked(input))
    throw new Error("Pick the agent that starts it there.");
}

/** The thread holds this message already: sent, queued or scheduled. */
const alreadyHolds = (chat: ProjectChat, inputId: string) =>
  chat.messages.some((m) => m.id === inputId) ||
  !!chat.queue?.some((q) => q.input.id === inputId) ||
  !!chat.scheduled?.some((s) => s.input.id === inputId);

/** Where messages go, and the parts of a turn that take them. */
interface SendFlows {
  turns: TurnSends;
  worktrees: ThreadWorktrees;
  schedule: ChatSchedule;
  asides: SideQuestions;
  queue: ChatQueue;
  compactions: TurnCompactions;
  councils: Councils;
}

/**
 * Where a message to a thread goes: a turn now, the queue, a schedule, a
 * /btw side answer, or another computer that starts the thread there.
 */
export class SendRouting {
  /**
   * Makes a new thread of a project on another computer there and sends it
   * its first message; Handoffs sets it, as it can't be made before this.
   */
  startsThere?: (id: string, first: ProjectChatSend) => Promise<void>;

  constructor(
    private core: ChatCore,
    private flows: SendFlows,
  ) {}

  /** `fromRelay` marks Relay's own messages, which leave a stopped queue stopped. */
  send(id: string, input: ProjectChatSend, fromRelay = false) {
    // A new thread of a project on another computer is made there, from
    // whichever caller sends it, and its first message goes after it as
    // every later one does.
    if (this.homeOf(id) && this.startsThere) return this.startsThere(id, input);
    return this.core.control(id, () => this.held(id, input, fromRelay));
  }

  /** A send whose caller already holds the thread's control. */
  async held(id: string, input: ProjectChatSend, fromRelay = false) {
    const { storage, active } = this.core;
    const { asides, councils, compactions, turns, queue } = this.flows;
    if (this.core.closing()) throw new Error("Relay is closing.");
    const chat = await storage.load(id);
    assertHere(chat);
    // Sent again after its answer got lost: don't send it or pick a stopped queue back up.
    if (alreadyHolds(chat, input.id)) return;
    if (input.sendAt) return this.flows.schedule.add(id, input);
    // A /btw question, or a reply under one, is answered beside the thread.
    const sideQuestion =
      input.side ||
      (!!input.parentId && !!replyRoot(chat.messages, input.parentId).side);
    if (sideQuestion) return asides.ask(chat, input);
    const goalTaken = this.pauseOrClearGoal(id, input);
    if (goalTaken) return goalTaken;
    // Sent right after a stop: it waits for the agent to let go, rather
    // than queueing behind the answer the stop paused the queue for.
    await active.finished(id);
    const threadFree =
      !active.has(id) && !councils.busy(await storage.load(id));
    if (!threadFree) return queue.add(id, input);
    const compactedFirst = await compactions.firstIfCold(id, input);
    if (!compactedFirst) await turns.sendNow(id, input);
    return queue.sentNow(id, input, fromRelay);
  }

  /**
   * A `/goal pause` or `/goal clear` goes straight to the running turn: queued,
   * it would wait for the very goal it pauses or clears. Undefined when this
   * isn't one, or nothing runs a goal now.
   */
  private pauseOrClearGoal(id: string, input: ProjectChatSend) {
    const asked = agentAsked(input);
    const goal = asked && parseGoalCommand(asked.question);
    if (goal?.type !== "pause" && goal?.type !== "clear") return undefined;
    const running = this.core.active.get(id);
    if (input.parentId || !running?.goal || this.core.active.stopping(running))
      return undefined;
    return running.goal(goal.type);
  }

  /**
   * A new thread's first message, kept with its worktree made but not
   * answered here: another computer starts the thread with it.
   */
  firstMessageOnly(id: string, input: ProjectChatSend) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      // Sent again after the reply got lost.
      if (chat.messages.some((m) => m.id === input.id)) return;
      const project = this.core.projects.get(chat.projectId);
      // Its threads are made there, by a plain send.
      if (project.computer) throw new Error(onComputerMessage(project));
      if (
        chat.messages.length ||
        !chat.worktree ||
        chat.scope.kind !== "project"
      )
        throw new Error(
          "Only a new thread in a worktree starts on another computer.",
        );
      if (input.sendAt)
        throw new Error(
          "Send later doesn't start a thread on another computer yet. Send it now, or start it here.",
        );
      startableThere(input);
      await this.flows.turns.sendNow(id, input, false, false);
      // Named after the message: the title's rename waits for a turn here.
      this.flows.worktrees.unnamed.delete(id);
    });
  }

  /** The first message a thread kept for another computer to answer (firstMessageOnly), answered here after all. */
  answerHere(id: string) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const input = chat.lastInput;
      const [first, ...rest] = chat.messages;
      if (!input || first?.id !== input.id || rest.length) return;
      chat.messages = [];
      await this.core.storage.save(chat);
      await this.held(id, input);
    });
  }

  /** The computer the thread's project lives on, while the thread isn't there yet. */
  private homeOf(id: string) {
    const chat = this.core.store.get().chats?.find((c) => c.id === id);
    if (!chat || chat.sentTo) return undefined;
    try {
      return this.core.projects.get(chat.projectId).computer?.id;
    } catch {
      return undefined;
    }
  }
}
