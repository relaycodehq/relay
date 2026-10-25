import { randomUUID } from "node:crypto";
import { agentName } from "../../shared/agents";
import { inSetup } from "../../shared/handoff";
import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import { chatStatus, type ProjectChats } from "../project-chats";
import { toolText, type RelayToolArgs } from "../relay-mcp";
import { refused, type Approvals } from "./approvals";
import { drivenThread } from "./driven-thread";
import type { ThreadHandoffs } from "./handoff-tool";
import type { Delivered, Sender } from "./lead-messages";
import { lastSend, leadSide } from "./lead-side";
import type { ProjectAccess } from "./project-access";
import type { ThreadReads } from "./thread-reads";
import { head, localTime } from "./tool-output";

/** Driving threads that already run: messaging, stopping and settling them. */
export class ThreadDriving {
  constructor(
    private chats: Pick<
      ProjectChats,
      "cancel" | "triage" | "settleItself" | "send"
    > & { liveHandoff: Pick<ProjectChats["liveHandoff"], "outbox"> },
    private reads: Pick<ThreadReads, "children" | "thread">,
    private projects: Pick<ProjectAccess, "real">,
    private approvals: Approvals,
    private handoffs: ThreadHandoffs | undefined,
  ) {}

  async stop(lead: ProjectChat, id: string, signal: AbortSignal) {
    const { chat, startedByLead, where } = await drivenThread(
      this.reads,
      this.projects,
      lead,
      id,
    );
    if (
      !startedByLead &&
      !(await this.approvals.askToDrive(
        lead,
        `Stop “${chat.title}”${where}?`,
        "",
        signal,
      ))
    )
      return refused("stop it");
    // One waiting on a setup there has its agent stopped already; the
    // setup's own agent is the user's to stop.
    if (!inSetup(chat) && this.handoffs?.forwards("cancelProjectChat", [id])) {
      await this.handoffs.forward("cancelProjectChat", [id]);
      return toolText(`Stopped on ${chat.sentTo!.computer}.`);
    }
    await this.chats.cancel(id);
    return toolText("Stopped.");
  }

  async settle(lead: ProjectChat, id: string, signal: AbortSignal) {
    const { summary, chat, startedByLead, where } = await drivenThread(
      this.reads,
      this.projects,
      lead,
      id,
    );
    const { status } = chatStatus(summary, chat);
    if (status === "working" || status === "needs-input")
      return toolText(
        status === "working"
          ? "It's still working: wait for it or stop it first."
          : "It's waiting on the user's input.",
        true,
      );
    if (summary.settledAt) return toolText("Already settled.");
    if (
      !startedByLead &&
      !(await this.approvals.askToDrive(
        lead,
        `Settle “${chat.title}”${where}?`,
        "",
        signal,
      ))
    )
      return refused("settle it");
    await this.chats.triage(id, { kind: "settle" });
    return toolText("Settled.");
  }

  /** The lead's own thread, once this answer ends; see ThreadTriage.settleItself. */
  async settleSelf(lead: ProjectChat) {
    if (!(await this.chats.settleItself(lead.id)))
      return toolText("Already settled.");
    return toolText(
      lead.startedBy
        ? "It settles once this answer ends cleanly."
        : "It settles once this answer ends cleanly and the user has read it.",
    );
  }

  /** The agent's message to itself, held like Send later until its time. */
  async wakeLater(
    lead: ProjectChat,
    { minutes, prompt }: RelayToolArgs<"wake_this_thread">,
  ) {
    const at = Date.now() + minutes * 60_000;
    const { last, agent } = leadSide(lead);
    await this.chats.send(lead.id, {
      id: randomUUID(),
      body: prompt,
      choice: last.choice,
      ...(last.contextWindow ? { contextWindow: last.contextWindow } : {}),
      provider: agent,
      to: agent,
      runtimeMode: last.runtimeMode,
      interactionMode: last.interactionMode,
      fromThread: { id: lead.id, name: `${agentName(agent)}'s wake-up` },
      sendAt: at,
    });
    return toolText(
      `It goes out at ${localTime(at)} as your next message here. The user sees it waiting and can send it early or cancel it.`,
    );
  }

  async sendTo(
    lead: ProjectChat,
    { id, message, steer }: RelayToolArgs<"send_to_thread">,
    signal: AbortSignal,
  ) {
    const { chat, sendsFreely, where } = await drivenThread(
      this.reads,
      this.projects,
      lead,
      id,
    );
    if (!chat.lastInput)
      return toolText("That thread hasn't started yet.", true);
    const title = `${steer ? "Steer" : "Send to"} “${chat.title}”${where}?`;
    const approved = sendsFreely
      ? await this.approvals.ask(lead, title, head(message), signal)
      : await this.approvals.askToDrive(lead, title, head(message), signal);
    if (!approved) return refused("send this");
    const sent = await this.deliver(
      chat,
      this.messageTo(chat, message, leadSide(lead).from, !!steer),
    );
    if (sent.away)
      return toolText(
        sent.held
          ? `${sent.away} is offline; it goes out once it's back.`
          : `Sent; it runs on ${sent.away}.`,
      );
    if (!sent.working) return toolText("Sent.");
    return toolText(
      steer
        ? "Steered; it reads it mid-answer."
        : "Queued; it goes out when its current answer ends. To reach it mid-answer, send with steer.",
    );
  }

  /** A started thread's message to its lead: a steer while it works, so it hears now. */
  async sendToLead(
    lead: ProjectChat,
    body: string,
    from: Sender,
  ): Promise<Delivered> {
    const { summary, chat } = await this.reads.thread(lead.id);
    const { status } = chatStatus(summary, chat);
    const sent = await this.deliver(
      chat,
      this.messageTo(chat, body, from, status === "working"),
    );
    return {
      steered: status === "working",
      queued: status === "needs-input",
      ...(sent.away ? { away: sent.away } : {}),
    };
  }

  /** A message to `chat` from another thread's agent, on what `chat` last ran. */
  private messageTo(
    chat: ProjectChat,
    body: string,
    from: Sender,
    steer: boolean,
  ): ProjectChatSend {
    const previous = lastSend(chat);
    const agent = sentAgent(previous);
    return {
      id: randomUUID(),
      body,
      choice: previous.choice,
      ...(previous.contextWindow
        ? { contextWindow: previous.contextWindow }
        : {}),
      provider: agent,
      to: agent,
      runtimeMode: previous.runtimeMode,
      interactionMode: previous.interactionMode,
      ...(steer ? { delivery: "steer" as const } : {}),
      fromThread: from,
    };
  }

  /** Sends to a thread here, or on the computer it was handed off to. */
  private async deliver(chat: ProjectChat, send: ProjectChatSend) {
    // A send to one waiting on a setup would reach the setup's agent instead.
    if (inSetup(chat))
      throw new Error(
        `“${chat.title}” is on its way to ${chat.sentTo!.computer}, which is still being set up for it. Try again once it's there.`,
      );
    if (this.handoffs?.forwards("sendProjectChat", [chat.id, send])) {
      await this.handoffs.forward("sendProjectChat", [chat.id, send]);
      const held = (await this.chats.liveHandoff.outbox(chat.id)).some(
        (h) => h.input.id === send.id,
      );
      return { away: chat.sentTo!.computer, held, working: false };
    }
    // Read now: approving may have taken long enough for the answer to end.
    const now = await this.reads.thread(chat.id);
    const working = chatStatus(now.summary, now.chat).status === "working";
    await this.chats.send(chat.id, send);
    return { working };
  }
}
