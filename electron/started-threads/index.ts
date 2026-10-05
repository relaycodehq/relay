// What Relay's tools do: a thread's agent starts threads of its own and
// drives them. A started thread is an ordinary thread that remembers who
// started it; its lead may only touch its own, and a started thread gets no
// tools, so nothing starts threads of threads.
import { randomUUID } from "node:crypto";
import { agentName, type AgentProvider } from "../../shared/agents";
import { hasAccounts } from "../../shared/agent-accounts";
import { fitModel } from "../../shared/model-fit";
import {
  projectChatSendSchema,
  type ChatSummary,
  type ProjectChat,
  type ProjectChatSend,
} from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import type { ModelChoice } from "../../shared/settings";
import type { ToolHandler } from "../agent-host/client";
import { promptTitle } from "../agents/thread-titles";
import type { ProjectChats } from "../project-chats";
import {
  relayToolSchemas,
  toolText,
  STARTED_LIMIT,
  type RelayToolArgs,
  type RelayToolName,
} from "../relay-mcp";

/** What a thread looks like to the agent that started it. */
export type StartedStatus =
  "working" | "needs-input" | "done" | "stopped" | "failed" | "idle";
const settled = new Set<StartedStatus>([
  "needs-input",
  "done",
  "stopped",
  "failed",
  "idle",
]);

const ANSWER_TAIL = 4000;
const POLL_MS = 1000;

type Chats = Pick<
  ProjectChats,
  | "list"
  | "get"
  | "create"
  | "send"
  | "cancel"
  | "askInTurn"
  | "worktreeFrom"
  | "triage"
>;

const defaultChoice: ModelChoice = {
  model: "",
  fast: false,
  reasoningEffort: "",
};
const fallbackInput = {
  provider: "claude",
  choice: defaultChoice,
  runtimeMode: "approval-required",
  interactionMode: "default",
} satisfies Partial<ProjectChatSend>;

/** The main conversation's answers, newest last. */
const answers = (chat: ProjectChat) =>
  chat.messages.filter((m) => m.role === "assistant" && !m.parentId);

export function startedStatus(
  summary: ChatSummary,
  chat: ProjectChat,
): StartedStatus {
  if (summary.waiting) return "needs-input";
  if (summary.running || summary.pending?.length) return "working";
  if (chat.queue?.length && !chat.queuePaused) return "working";
  const last = answers(chat).at(-1);
  if (!last) return chat.messages.length ? "working" : "idle";
  return {
    streaming: "working",
    complete: "done",
    cancelled: "stopped",
    failed: "failed",
  }[last.status] as StartedStatus;
}

/** The start of what the user is asked about. */
const head = (text: string, limit = 600) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

const tail = (text: string, limit = ANSWER_TAIL) =>
  text.length > limit ? `…${text.slice(-limit)}` : text;

const json = (value: unknown) => toolText(JSON.stringify(value, null, 1));

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });

export class StartedThreads {
  constructor(private chats: Chats) {}

  /** Answers one tool call made by the agent in `chatId`. */
  handle: ToolHandler = (chatId, name, args, signal) =>
    this.answer(chatId, name, args, signal).catch((error: unknown) =>
      toolText(error instanceof Error ? error.message : String(error), true),
    );

  private async answer(
    chatId: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) {
    const schema = relayToolSchemas[name as RelayToolName];
    if (!schema) return toolText(`There is no tool ${name}.`, true);
    const parsed = schema.safeParse(args);
    if (!parsed.success)
      return toolText(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("\n"),
        true,
      );
    const lead = await this.chats.get(chatId);
    if (lead.startedBy)
      return toolText(
        "A thread started by another thread can't start or drive threads of its own.",
        true,
      );
    const input = parsed.data as any;
    switch (name as RelayToolName) {
      case "start_threads":
        return this.start(lead, input, signal);
      case "list_threads":
        return json(await this.list(lead));
      case "read_thread":
        return this.read(lead, input);
      case "send_to_thread":
        return this.sendTo(lead, input, signal);
      case "wait_for_threads":
        return this.wait(lead, input, signal);
      case "stop_thread": {
        await this.own(lead, input.id);
        await this.chats.cancel(input.id);
        return toolText("Stopped.");
      }
      case "settle_thread":
        return this.settle(lead, input.id);
    }
  }

  /**
   * Whether the user lets the lead start or message a thread: a new turn
   * spends usage and may edit the project. A lead with full access may.
   */
  private async approve(
    lead: ProjectChat,
    title: string,
    detail: string,
    signal: AbortSignal,
  ) {
    if (this.leadSide(lead).last.runtimeMode === "full-access") return true;
    const response = await this.chats.askInTurn(
      lead.id,
      {
        kind: "approval",
        title,
        detail,
        decisions: ["accept", "decline", "cancel"],
      },
      signal,
    );
    return response.kind === "approval" && response.decision === "accept";
  }

  private children(lead: ProjectChat) {
    return this.chats
      .list(lead.projectId)
      .filter((c) => c.startedBy?.chatId === lead.id && !c.archivedAt);
  }

  private async own(lead: ProjectChat, id: string) {
    const summary = this.children(lead).find((c) => c.id === id);
    if (!summary) throw new Error("That isn't a thread you started.");
    return { summary, chat: await this.chats.get(id) };
  }

  private async settle(lead: ProjectChat, id: string) {
    const { summary, chat } = await this.own(lead, id);
    const status = startedStatus(summary, chat);
    if (status === "working" || status === "needs-input")
      return toolText(
        status === "working"
          ? "It's still working: wait for it or stop it first."
          : "It's waiting on the user's input.",
        true,
      );
    if (summary.settledAt) return toolText("Already settled.");
    await this.chats.triage(id, { kind: "settle" });
    return toolText("Settled.");
  }

  /** Who the lead's messages say they're from, and on what it last ran. */
  private leadSide(lead: ProjectChat) {
    const last = lead.lastInput ?? { ...fallbackInput, body: "", id: lead.id };
    const agent = sentAgent(last);
    return {
      last,
      agent,
      from: {
        id: lead.id,
        name: `${agentName(agent)} in ${lead.title}`.slice(0, 300),
      },
    };
  }

  private async start(
    lead: ProjectChat,
    { threads }: RelayToolArgs<"start_threads">,
    signal: AbortSignal,
  ) {
    const working = this.children(lead).filter((c) => c.running).length;
    if (working + threads.length > STARTED_LIMIT)
      return toolText(
        `${working} of your threads are working; at most ${STARTED_LIMIT} may at once. Wait for some to finish first.`,
        true,
      );
    const { last, agent: caller, from } = this.leadSide(lead);
    const approved = await this.approve(
      lead,
      `Start ${threads.length} thread${threads.length === 1 ? "" : "s"}?`,
      threads
        .map(
          (t, i) =>
            `${i + 1}. ${agentName(t.agent ?? caller)}${t.model ? ` (${t.model})` : ""}${t.worktree === false ? ", in the checkout" : ""}${t.plan ? ", plans first" : ""}\n${head(t.prompt)}`,
        )
        .join("\n\n"),
      signal,
    );
    if (!approved)
      return toolText(
        "The user didn't start these threads. Ask them what they want instead.",
        true,
      );
    const started: unknown[] = [];
    for (const spec of threads) {
      const agent: AgentProvider = spec.agent ?? caller;
      const same = agent === caller;
      const model =
        spec.model !== undefined || spec.effort !== undefined
          ? {
              choice: {
                model: spec.model ?? (same ? last.choice.model : ""),
                fast: same && last.choice.fast,
                reasoningEffort:
                  spec.effort ?? (same ? last.choice.reasoningEffort : ""),
              },
              ...(same && last.contextWindow
                ? { contextWindow: last.contextWindow }
                : {}),
            }
          : same
            ? {
                choice: last.choice,
                ...(last.contextWindow
                  ? { contextWindow: last.contextWindow }
                  : {}),
              }
            : { choice: defaultChoice };
      const fitted = fitModel(agent, model);
      const account = hasAccounts(agent) ? lead.accounts?.[agent] : undefined;
      const send = projectChatSendSchema.safeParse({
        id: randomUUID(),
        body: spec.prompt,
        choice: fitted.choice,
        ...(fitted.contextWindow
          ? { contextWindow: fitted.contextWindow }
          : {}),
        provider: agent,
        to: agent,
        runtimeMode: last.runtimeMode,
        interactionMode: spec.plan ? "plan" : "default",
        ...(account ? { account } : {}),
        fromThread: from,
      } satisfies ProjectChatSend);
      if (!send.success) {
        started.push({
          error: send.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        continue;
      }
      try {
        const chat = await this.create(lead, spec.worktree, caller);
        // A worktree made from the commit alone would miss the work in progress it's about.
        const copied =
          chat.worktree && spec.uncommitted !== false
            ? await this.chats.worktreeFrom(chat.id, lead.id, spec.prompt)
            : undefined;
        await this.chats.send(chat.id, send.data);
        started.push({
          id: chat.id,
          title: promptTitle(spec.prompt),
          agent,
          ...(spec.plan ? { plan: true } : {}),
          worktree: !!chat.worktree,
          ...(copied ? { uncommittedFilesCopied: copied } : {}),
        });
      } catch (error) {
        started.push({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return json(started);
  }

  /** A worktree unless asked otherwise or the project isn't a repository. */
  private async create(
    lead: ProjectChat,
    worktree: boolean | undefined,
    agent: AgentProvider,
  ) {
    const startedBy = { chatId: lead.id, agent };
    const scope = { kind: "project" } as const;
    if (worktree === false)
      return this.chats.create(lead.projectId, scope, "checkout", startedBy);
    try {
      return await this.chats.create(
        lead.projectId,
        scope,
        "worktree",
        startedBy,
      );
    } catch (error) {
      if (worktree === true) throw error;
      return this.chats.create(lead.projectId, scope, "checkout", startedBy);
    }
  }

  private async list(lead: ProjectChat, ids?: string[]) {
    const listed = this.children(lead).filter(
      (c) => !ids || ids.includes(c.id),
    );
    return Promise.all(
      listed.map(async (summary) => {
        const chat = await this.chats.get(summary.id);
        const last = answers(chat).at(-1);
        const asks = chat.requests?.map((r) => r.title) ?? [];
        return {
          id: summary.id,
          title: summary.title,
          status: startedStatus(summary, chat),
          ...(asks.length ? { asks } : {}),
          ...(summary.branch ? { branch: summary.branch } : {}),
          ...(chat.worktree?.path ? { folder: chat.worktree.path } : {}),
          ...(last?.body ? { latest: tail(last.body, 600) } : {}),
          ...(last?.error ? { error: last.error } : {}),
        };
      }),
    );
  }

  private async read(
    lead: ProjectChat,
    { id, after }: RelayToolArgs<"read_thread">,
  ) {
    const { chat } = await this.own(lead, id);
    const main = chat.messages.filter((m) => !m.parentId);
    const from = after ? main.findIndex((m) => m.id === after) + 1 : 0;
    const messages = main.slice(from).map((m) => ({
      id: m.id,
      from: m.role === "user" ? (m.author ?? "user") : agentName(m.provider),
      ...(m.status === "complete" ? {} : { status: m.status }),
      body: tail(m.body),
      ...(m.error ? { error: m.error } : {}),
      ...(m.changes?.length ? { changed: m.changes.map((c) => c.path) } : {}),
    }));
    return json({ messages, next: main.at(-1)?.id ?? after ?? null });
  }

  private async sendTo(
    lead: ProjectChat,
    { id, message, steer }: RelayToolArgs<"send_to_thread">,
    signal: AbortSignal,
  ) {
    const { chat } = await this.own(lead, id);
    const previous = chat.lastInput;
    if (!previous) return toolText("That thread hasn't started yet.", true);
    const approved = await this.approve(
      lead,
      `${steer ? "Steer" : "Send to"} “${chat.title}”?`,
      head(message),
      signal,
    );
    if (!approved)
      return toolText(
        "The user didn't send this. Ask them what they want instead.",
        true,
      );
    const { from } = this.leadSide(lead);
    const agent = sentAgent(previous);
    await this.chats.send(id, {
      id: randomUUID(),
      body: message,
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
    });
    return toolText(
      steer ? "Sent; it reads it mid-answer if it's working." : "Sent.",
    );
  }

  private async wait(
    lead: ProjectChat,
    { ids, timeoutSeconds = 300 }: RelayToolArgs<"wait_for_threads">,
    signal: AbortSignal,
  ) {
    if (ids) for (const id of ids) await this.own(lead, id);
    const until = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const threads = await this.list(lead, ids);
      const done = threads.every((t) => settled.has(t.status));
      if (done || signal.aborted || Date.now() >= until)
        return json({
          ...(done
            ? {}
            : {
                timedOut: !signal.aborted,
                note: "Still working; wait again or read them.",
              }),
          threads,
        });
      await sleep(Math.min(POLL_MS, until - Date.now()), signal);
    }
  }
}
