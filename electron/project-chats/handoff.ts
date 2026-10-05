import { randomUUID } from "node:crypto";
import {
  remoteRecentCalls,
  type ChatCameFrom,
  type ChatSentTo,
  type HandoffRemoteStatus,
  type HandoffThread,
} from "../../shared/handoff";
import type {
  AgentProvider,
  ChatMessage,
  ChatSummary,
  ChatWorktree,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { readTurn } from "../../shared/agent-trace";
import { commitEverything, headOf } from "../git/bundles";
import { git } from "../git/git";
import { worktreeExists } from "../git/worktrees";
import type { ActiveChat } from "./active";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import type { ChatSchedule } from "./schedule";
import { agentSession, sessionInput } from "./sessions";
import { chatSummary } from "./storage";

/** Where a thread stands between computers, or nothing when it's simply here. */
function elsewhere(chat: ChatSummary) {
  if (chat.sentTo)
    return `This thread is on ${chat.sentTo.computer}. Bring it back to continue here.`;
  if (chat.cameFrom?.returnedAt)
    return `This thread went back to ${chat.cameFrom.computer}; it continues there.`;
}
/** Handed over from another computer and not yet handed back, so that computer is waiting for it. */
export const awaitsReturn = (chat: ChatSummary) =>
  !!chat.cameFrom && !chat.cameFrom.returnedAt && !chat.cameFrom.abandonedAt;
export function assertHere(chat: ChatSummary) {
  const away = elsewhere(chat);
  if (away) throw new Error(away);
}
/**
 * Messages crossing to another computer: new ids, and nothing that points
 * into this one's data (turn snapshots, screenshots, provider sessions).
 */
export function portableMessages(
  messages: ChatMessage[],
  newIds = false,
): ChatMessage[] {
  return relabeled(messages, newIds).messages;
}
function relabeled(messages: ChatMessage[], newIds: boolean) {
  const ids = new Map(
    messages.map((m) => [m.id, newIds ? randomUUID() : m.id]),
  );
  return {
    /** Each message's id before it was relabeled, by its id after. */
    was: Object.fromEntries([...ids].map(([old, id]) => [id, old])),
    messages: messages
      .filter((m) => m.status !== "streaming")
      .map(({ changes, pending, seq, forkPoint, images, unread, ...m }) => ({
        ...structuredClone(m),
        id: ids.get(m.id)!,
        ...(m.parentId ? { parentId: ids.get(m.parentId) ?? m.parentId } : {}),
        version: 1,
      })),
  };
}
/** Messages written here, pointing at the ids the carried ones had where they came from. */
function pointingBack(
  messages: ChatMessage[],
  carriedIds: Record<string, string>,
) {
  return messages.map((m) =>
    m.parentId && carriedIds[m.parentId]
      ? { ...m, parentId: carriedIds[m.parentId] }
      : m,
  );
}
/** What another computer hears of a handed-over thread's latest turn. */
type HandoffTurn = Pick<
  HandoffRemoteStatus,
  | "latest"
  | "failed"
  | "recent"
  | "calls"
  | "says"
  | "provider"
  | "model"
  | "question"
  | "runningFor"
>;
/** A turn's own last calls and latest commentary, trimmed to cross the bridge. */
function turnPeek(m: ChatMessage): HandoffTurn {
  const { activity } = readTurn(m);
  const said = [...(m.trace ?? [])]
    .reverse()
    .find((e) => e.kind === "commentary" && e.text.trim());
  const says = said?.kind === "commentary" && said.text.trim().slice(0, 300);
  return {
    provider: m.provider,
    calls: activity.length,
    recent: activity
      .slice(-remoteRecentCalls)
      .map(({ id, kind, label, status }) => ({
        id,
        kind,
        label: label.slice(0, 300),
        status,
      })),
    ...(says ? { says } : {}),
  };
}

export interface HandoffHost {
  send(id: string, input: ProjectChatSend): Promise<void>;
  /** The thread's agent writes its note for the computer the thread goes to. */
  note(
    chat: ProjectChat,
    root: string,
    provider: AgentProvider,
    active: ActiveChat,
    computer: string,
  ): Promise<unknown>;
}

/** A thread moving to another of your computers, and coming back. */
export class ComputerHandoff {
  constructor(
    private core: ChatCore,
    private schedule: ChatSchedule,
    private councils: Pick<Councils, "busy">,
    private host: HandoffHost,
  ) {}

  /**
   * Marks a thread as leaving for another computer, after checking it can:
   * from here on nothing new starts in it. `leave` then does the stopping.
   */
  mark(id: string, sentTo: Omit<ChatSentTo, "state">) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      if (chat.cameFrom?.abandonedAt)
        throw new Error(
          `${chat.cameFrom.computer} took this thread back, so it can't move on from here.`,
        );
      if (chat.cameFrom)
        throw new Error(
          `This thread came from ${chat.cameFrom.computer}. Bring it back there instead.`,
        );
      if (chat.shared)
        throw new Error("Shared conversations stay on this computer.");
      if (chat.scope.kind === "review" || chat.reviewer || chat.thinker)
        throw new Error("A deep review can't move to another computer.");
      if (!chat.messages.length)
        throw new Error("Send a first message before handing the thread off.");
      if (!chat.worktree || !(await worktreeExists(chat.worktree)))
        throw new Error(
          "Only a thread in its own worktree can move to another computer; the checkout's changes aren't this thread's alone.",
        );
      if (chat.queue?.length || chat.scheduled?.length)
        throw new Error(
          "Send or remove its queued and scheduled messages first.",
        );
      if (this.core.sessions.pending(id).length || chat.heldWakeups?.length)
        throw new Error(
          "Claude left background work or a wake-up in this thread. Stop it first.",
        );
      if (this.councils.busy(chat))
        throw new Error("Wait for the council or review to finish first.");
      chat.sentTo = { ...sentTo, state: "sending" };
      await this.core.storage.save(chat);
    });
  }
  /** Updates a thread's handoff while it's still `handoffId`; null ends it, keeping the thread here. */
  async updateSentTo(
    id: string,
    handoffId: string,
    change: Partial<ChatSentTo> | null,
  ) {
    const chat = await this.core.storage.load(id);
    if (chat.sentTo?.id !== handoffId) return;
    if (change) {
      chat.sentTo = { ...chat.sentTo, ...change };
      if ("error" in change && !change.error) delete chat.sentTo.error;
    } else delete chat.sentTo;
    await this.core.storage.save(chat);
  }
  /**
   * Unlocks a thread that's away, as it was when it left plus anything
   * already handed back, and notes which handoff that was so it can't come
   * back later. False when it wasn't away on that handoff.
   */
  abandon(id: string, handoffId: string) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const { sentTo } = chat;
      if (sentTo?.id !== handoffId) return false;
      chat.abandonedHandoffs = [
        ...(chat.abandonedHandoffs ?? []),
        { id: sentTo.id, computer: sentTo.computer, at: Date.now() },
      ];
      delete chat.sentTo;
      chat.updated = Date.now();
      await this.core.storage.save(chat);
      return true;
    });
  }
  /**
   * The thread leaves for `computer`: its agent stops and is waited for,
   * writes a handoff note in its own session, and everything in the worktree
   * is committed. `since` limits the note to turns from that message on,
   * which on a computer the thread came to are its own.
   */
  leave(id: string, computer: string, since = 0) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      if (!chat.worktree || !(await worktreeExists(chat.worktree)))
        throw new Error("The thread's worktree is gone.");
      await this.stop(id, chat);
      const root = chat.worktree.path!;
      const latest = chat.messages.at(-1);
      const outgoing = chat.messages
        .slice(since)
        .reverse()
        .find(
          (m) =>
            m.role === "assistant" &&
            !m.parentId &&
            !m.compaction &&
            !m.handoff &&
            !m.reload &&
            m.status !== "failed",
        );
      // A retry finds the note already written, with nothing after it.
      if (
        !latest?.handoff?.computer &&
        outgoing?.provider &&
        agentSession(chat, outgoing.provider).thread
      ) {
        const provider = outgoing.provider;
        const active = this.core.active.claim(
          id,
          sessionInput(chat, provider, this.core.store),
        );
        try {
          await this.host.note(chat, root, provider, active, computer);
        } finally {
          this.core.active.release(id, active);
        }
      }
      await commitEverything(root, `Hand off to ${computer}`);
      await this.core.storage.save(chat);
      return {
        chat: structuredClone(chat),
        root,
        tip: await headOf(root),
      };
    });
  }
  private async stop(id: string, chat: ProjectChat) {
    await this.core.active.halt(id);
    if (chat.queue?.length || chat.scheduled?.length) {
      delete chat.queue;
      delete chat.scheduled;
      this.schedule.armSend(id, undefined);
    }
  }
  /** The thread a handoff from another computer made here, if it came. */
  handedOver(handoffId: string) {
    return (this.core.store.get().chats ?? []).find(
      (c) => c.cameFrom?.id === handoffId,
    );
  }
  /**
   * A thread handed over from another computer, working in `worktree`. Its
   * agent carries on at once, briefed with the note and the user's messages.
   */
  async adopt(
    projectId: string,
    thread: HandoffThread,
    cameFrom: Omit<ChatCameFrom, "carried">,
    worktree: ChatWorktree,
    /** Why the branch couldn't keep its name here, when it couldn't. */
    renamed?: string,
  ) {
    const { messages, was } = relabeled(thread.messages, true);
    const note = [...messages]
      .reverse()
      .find(
        (m) => m.handoff?.computer && m.status === "complete" && m.body.trim(),
      );
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      scope: thread.scope,
      title: thread.title,
      renamed: true,
      created: Date.now(),
      updated: Date.now(),
      ...(worktree.branch ? { branch: worktree.branch } : {}),
      worktree,
      messages,
      cameFrom: { ...cameFrom, carried: messages.length },
      carriedIds: was,
      handover: {
        computer: thread.from,
        fresh: true,
        ...(note
          ? { note: { provider: note.handoff!.from, body: note.body } }
          : {}),
      },
    };
    await this.core.storage.add(chat);
    const { provider, ...settings } = thread.settings;
    void this.host
      .send(chat.id, {
        ...settings,
        id: randomUUID(),
        body: `@${provider} Carry on with this work, handed over from ${thread.from}.${
          worktree.branch === thread.git.branch
            ? ""
            : ` Its branch on this computer is ${worktree.branch}, not ${thread.git.branch}: ${renamed ?? `${thread.git.branch} couldn't be made here.`}`
        }`,
        to: provider,
        provider,
      })
      .catch((e) => console.warn("A handed-over thread couldn't start:", e));
    return chatSummary(chat);
  }
  /** What a thread that came here wrote since, for its trip back. */
  async handBack(id: string, deviceId: string) {
    const summary = (this.core.store.get().chats ?? []).find(
      (c) => c.id === id,
    );
    const came = summary?.cameFrom;
    if (!came || came.deviceId !== deviceId)
      throw new Error("This thread didn't come from that computer.");
    if (came.abandonedAt)
      throw new Error(
        `${came.computer} took this thread back without this computer, so it can't be handed back. Its work stays here.`,
      );
    const here = await this.core.storage.load(id);
    const { chat, root, tip } = !(
      here.worktree && (await worktreeExists(here.worktree))
    )
      ? await this.withoutWorktree(id, came)
      : came.returnedAt
        ? {
            chat: here,
            root: here.worktree.path!,
            tip: await headOf(here.worktree.path!),
          }
        : await this.leave(id, came.computer, came.carried);
    return {
      messages: pointingBack(
        portableMessages(chat.messages.slice(came.carried)),
        chat.carriedIds ?? {},
      ),
      root,
      tip,
      branch: chat.worktree!.branch!,
      since: came.tip,
    };
  }
  /**
   * A thread whose worktree is gone, deleted outside Relay, still has its
   * conversation to hand back, with the commits its branch kept; what was
   * never committed went with the folder. The branch gone too, there is
   * nothing to carry, and the commit it arrived at stands.
   */
  private withoutWorktree(id: string, came: ChatCameFrom) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      await this.stop(id, chat);
      const root = await this.core.projects.root(chat.projectId);
      const tip = await git(root, [
        "rev-parse",
        "-q",
        "--verify",
        `refs/heads/${chat.worktree!.branch}^{commit}`,
      ]).then(
        (out) => out.trim(),
        () => came.tip,
      );
      await this.core.storage.save(chat);
      return { chat: structuredClone(chat), root, tip };
    });
  }
  /**
   * How the main conversation's latest turn here goes: the start of the
   * latest answer or the error it ended in, and for the peek its last calls,
   * what its agent last said, and what it asks while it waits. Only what was
   * written since the thread arrived, so the computer it came from never
   * sees its own answer.
   */
  async latestTurn(id: string): Promise<HandoffTurn> {
    const chat = await this.core.storage.load(id);
    const answers = chat.messages
      .slice(chat.cameFrom?.carried ?? 0)
      .filter((m) => m.role === "assistant" && !m.parentId && !m.handoff);
    const last = answers.at(-1);
    const active = this.core.active.get(id);
    const model = (active?.input ?? chat.lastInput)?.choice.model;
    const request = active?.requests.list()[0];
    const peek: HandoffTurn = {
      ...(last ? turnPeek(last) : {}),
      ...(model ? { model } : {}),
      ...(request
        ? {
            question: (request.questions?.[0]?.question ?? request.title)
              .trim()
              .slice(0, 300),
          }
        : {}),
      ...(active ? { runningFor: Date.now() - active.started } : {}),
    };
    if (last?.status === "failed")
      return {
        failed: last.error?.trim() || "The agent stopped with an error.",
        ...peek,
      };
    const answer = answers.reverse().find((m) => m.body.trim());
    return answer
      ? { latest: answer.body.trim().slice(0, 300), ...peek }
      : peek;
  }
  /** The other computer has the thread back; this copy stays still. */
  async handedBack(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.cameFrom || chat.cameFrom.returnedAt || chat.cameFrom.abandonedAt)
      return;
    chat.cameFrom.returnedAt = Date.now();
    this.core.sessions.close(id);
    await this.core.storage.save(chat);
  }
  /**
   * The computer it came from took the thread back without this one. The
   * copy is no longer owed to it: it carries on here as a thread of its own.
   */
  async abandoned(id: string) {
    const chat = await this.core.storage.load(id);
    const came = chat.cameFrom;
    if (!came || came.returnedAt || came.abandonedAt) return;
    came.abandonedAt = Date.now();
    await this.core.storage.save(chat);
  }
  /**
   * A thread back from another computer: what was written there joins the
   * conversation, and the next turn hears the note written for the trip.
   */
  returned(id: string, handoffId: string, messages: ChatMessage[]) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const sentTo = chat.sentTo;
      if (sentTo?.id !== handoffId) throw new Error("This thread isn't away.");
      const known = new Set(chat.messages.map((m) => m.id));
      const renamed = new Map<string, string>();
      for (const m of messages)
        if (known.has(m.id)) renamed.set(m.id, randomUUID());
      const arrived = portableMessages(messages).map((m) => ({
        ...m,
        ...(renamed.has(m.id) ? { id: renamed.get(m.id)! } : {}),
        ...(m.parentId && renamed.has(m.parentId)
          ? { parentId: renamed.get(m.parentId)! }
          : {}),
      }));
      const note = [...arrived]
        .reverse()
        .find(
          (m) =>
            m.handoff?.computer && m.status === "complete" && m.body.trim(),
        );
      chat.messages.push(...arrived);
      chat.handover = {
        computer: sentTo.computer,
        fresh: false,
        ...(note
          ? { note: { provider: note.handoff!.from, body: note.body } }
          : {}),
      };
      delete chat.sentTo;
      chat.updated = Date.now();
      await this.core.storage.save(chat);
      for (const m of arrived)
        this.core.emit({ chatId: id, message: structuredClone(m) });
    });
  }
}
