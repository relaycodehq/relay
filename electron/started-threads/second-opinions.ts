// Second opinions: the user asks another agent to check one of a thread's
// answers. It works read-only in a thread of its own, listed under the
// thread whose answer it checks, and that thread's agent hears what it said
// only when the user sends it.
import { randomUUID } from "node:crypto";
import { agentMentionPattern, type AgentProvider } from "../../shared/agents";
import { hasAccounts } from "../../shared/agent-accounts";
import { fitModel } from "../../shared/model-fit";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import {
  ANSWER_CHARS,
  secondOpinionAsked,
  secondOpinionPrompt,
  type SecondOpinionAgent,
} from "../../shared/second-opinion";
import { truncated } from "../../shared/truncate";
import type { ProjectChats } from "../project-chats";
import { defaultChoice, lastSend, leadSide } from "./lead-side";

/** Rows the thread shows between turns, which nobody said: dividers, handoffs, setup runs. */
const isRow = (m: ChatMessage) =>
  !!(
    m.resumed ||
    m.handedOver ||
    m.handoff ||
    m.compaction ||
    m.reload ||
    m.worktreeCommand
  );

/**
 * Answer `answerId` and the message it answered. The reply is every part of
 * the agent's answer up to that one; undefined when it isn't a finished
 * answer of the main conversation. A turn the agent started on its own
 * answered nothing.
 */
export function answerAndQuestion(chat: ProjectChat, answerId: string) {
  // A side question's thread is apart from the main session; so is `/btw`.
  const main = chat.messages.filter((m) => !m.parentId && !m.side && !isRow(m));
  const at = main.findIndex((m) => m.id === answerId);
  const answer = main[at];
  const finished =
    answer?.role === "assistant" &&
    answer.status === "complete" &&
    !!answer.body.trim();
  if (!finished) return undefined;
  let first = at;
  while (main[first - 1]?.role === "assistant") first--;
  const question = main[first - 1];
  const reply = main
    .slice(first, at + 1)
    .map((m) => m.body.trim())
    .filter(Boolean)
    .join("\n\n");
  return { question, reply };
}

export class SecondOpinions {
  constructor(
    private chats: Pick<ProjectChats, "get" | "create" | "rename" | "send"> & {
      files: Pick<ProjectChats["files"], "image">;
    },
  ) {}

  /** Starts a thread where `agent` checks answer `answerId` of thread `leadId`. */
  async ask(leadId: string, answerId: string, agent: SecondOpinionAgent) {
    const lead = await this.chats.get(leadId);
    const found = answerAndQuestion(lead, answerId);
    if (!found)
      throw new Error("Only a finished answer can get a second opinion.");
    const question =
      found.question?.body.replace(agentMentionPattern, "").trim() ?? "";
    const asked = secondOpinionAsked(question, found.reply);
    const { choice } = fitModel(agent.provider, {
      choice: { ...defaultChoice, model: agent.model },
    });
    const account = hasAccounts(agent.provider)
      ? lead.accounts?.[agent.provider]
      : undefined;
    const images = await this.imagesOf(lead, found.question);
    const thread = await this.create(lead, answerId, agent.provider);
    await this.chats.rename(thread.id, `Second opinion: ${lead.title}`);
    await this.chats.send(thread.id, {
      id: randomUUID(),
      body: secondOpinionPrompt(asked),
      choice,
      provider: agent.provider,
      to: agent.provider,
      runtimeMode: "read-only",
      interactionMode: "default",
      ...(account ? { account } : {}),
      ...(images.length ? { images } : {}),
      secondOpinion: asked,
    });
  }

  /**
   * Sends what second opinion `threadId` said to the agent whose answer it
   * checked: as a turn of its own, or queued behind the one it's working on.
   */
  async sendBack(threadId: string) {
    const thread = await this.chats.get(threadId);
    const leadId = thread.startedBy?.secondOpinionOn
      ? thread.startedBy.chatId
      : undefined;
    if (!leadId) throw new Error("That thread isn't a second opinion.");
    const lead = await this.chats.get(leadId);
    if (lead.sentTo)
      throw new Error(
        `“${lead.title}” is on ${lead.sentTo.computer} now; send it once it's back.`,
      );
    const opinion = thread.messages
      .filter((m) => m.role === "assistant" && !m.parentId)
      .at(-1);
    if (opinion?.status !== "complete" || !opinion.body.trim())
      throw new Error("The second opinion hasn't finished yet.");
    const last = lastSend(lead);
    const { agent } = leadSide(lead);
    await this.chats.send(lead.id, {
      id: randomUUID(),
      body: [
        "Here's a second opinion on your answer. Weigh it on its merits: say where it's right, where it's wrong, and what you'd change.",
        truncated(opinion.body.trim(), ANSWER_CHARS),
      ].join("\n\n"),
      choice: last.choice,
      ...(last.contextWindow ? { contextWindow: last.contextWindow } : {}),
      provider: agent,
      to: agent,
      runtimeMode: last.runtimeMode,
      interactionMode: last.interactionMode,
      fromThread: { id: thread.id, name: thread.title, child: "finished" },
    } satisfies ProjectChatSend);
  }

  /**
   * The thread, under the lead. It works in the lead's worktree when it has
   * one, so it reads the same files; read-only, it changes none of them.
   */
  private async create(
    lead: ProjectChat,
    answerId: string,
    startingAgent: AgentProvider,
  ) {
    const startedBy = {
      chatId: lead.id,
      agent: leadSide(lead).agent,
      secondOpinionOn: answerId,
    };
    const made = { startedBy, startingAgent };
    const scope = { kind: "project" } as const;
    const branch = lead.worktree?.path && lead.worktree.branch;
    if (!branch)
      return this.chats.create(lead.projectId, scope, "checkout", made);
    return this.chats.create(lead.projectId, scope, "worktree", {
      ...made,
      start: { on: branch },
    });
  }

  /** The screenshots sent with the question, to send along with it. */
  private async imagesOf(lead: ProjectChat, question?: ChatMessage) {
    const images = question?.images ?? [];
    return Promise.all(
      images.map(async (image) => ({
        name: image.name,
        mimeType: image.mimeType,
        dataUrl: await this.chats.files.image(lead.id, image.id),
        ...(image.browser ? { browser: image.browser } : {}),
      })),
    );
  }
}
