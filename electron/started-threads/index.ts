// What Relay's tools do: a thread's agent starts threads of its own and
// drives them, in its project or another the user has or lets it add. A
// started thread is an ordinary thread that remembers who started it. Any
// thread may read any other; a lead drives its own, and any other once the
// user lets it, and a started thread only reads, so nothing starts threads of
// threads.
import { sliceWhole } from "../../shared/truncate";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ThreadReads } from "./thread-reads";
import { ProjectAccess, type AgentProjects } from "./project-access";
import { ThreadPages } from "./thread-pages";
import { json, localTime } from "./tool-output";
import {
  listReviewSetups,
  reviewRound,
  type ThreadReviews,
} from "./thread-reviews";
import {
  agentName,
  usageProviders,
  type AgentProvider,
  type UsageProvider,
} from "../../shared/agents";
import { hasAccounts, pinnedAccount } from "../../shared/agent-accounts";
import { fitModel } from "../../shared/model-fit";
import { AgentChoices, type ThreadAgents } from "./thread-agents";
import { resetsIn, type ProviderUsage } from "../../shared/provider-usage";
import {
  projectChatSendSchema,
  type ChatMessage,
  type ChatSummary,
  type ProjectChat,
  type ProjectChatSend,
} from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import {
  handoffBlocked,
  inSetup,
  type HandoffChatMethod,
  type HandoffTarget,
} from "../../shared/handoff";
import { noteForAgent } from "../../shared/thread-notes";
import type { ModelChoice } from "../../shared/settings";
import type { ToolHandler } from "../agent-host/client";
import { promptTitle } from "../agents/thread-titles";
import { readProviderUsage } from "../agents/provider-usage";
import { chatStatus, type ProjectChats } from "../project-chats";
import type { ThreadPreviews } from "../preview";
import type { RenderTools } from "../html-renders";
import {
  relayToolSchemas,
  toolText,
  STARTED_LIMIT,
  startedTools,
  type RelayToolArgs,
  type RelayToolName,
} from "../relay-mcp";
import { errorMessage } from "../../shared/error-message";

export { localTime } from "./tool-output";
export type { AgentProjects } from "./project-access";
export type { ThreadReviews } from "./thread-reviews";

const DRIVE_ALWAYS =
  "Always lets this thread start, message, stop and settle any thread in any project without asking again. Reading needs no permission.";
/** How long start_threads watches new threads for one that fails as it starts, as Relay serves it. */
export const EARLY_FAILURE_MS = 10_000;
const EARLY_POLL_MS = 250;
const FAILED_AT_ONCE =
  "It failed as it started; nothing is working on it. Fix the cause, often the agent or model, and start it again, or tell the user.";
const FAILED_SETTLED =
  "It failed as it started, so Relay settled it: it's out of the user's Activity and they can bring it back. Fix the cause, often the agent or model, and start a new thread, or tell the user.";
const hasWork = (m: ChatMessage) =>
  !!m.body.trim() || !!m.trace?.length || !!m.activity?.length;

type Chats = Pick<
  ProjectChats,
  | "list"
  | "startedThreads"
  | "allowDriving"
  | "get"
  | "statuses"
  | "create"
  | "send"
  | "cancel"
  | "askInTurn"
  | "worktreeFrom"
  | "triage"
  | "settleItself"
  | "showRender"
  | "showPreview"
  | "askWithPage"
  | "notes"
> & {
  worktrees: Pick<ProjectChats["worktrees"], "enter">;
  liveHandoff: Pick<ProjectChats["liveHandoff"], "outbox">;
  importOffers?: Pick<ProjectChats["importOffers"], "sources" | "offer">;
};

/** Moving threads to the user's other computers, as the thread header does. */
export interface ThreadHandoffs {
  /** Whether the call is for a thread live on another computer, so runs there. */
  forwards(method: string, args: unknown[]): boolean;
  forward(method: HandoffChatMethod, args: unknown[]): Promise<unknown>;
  targets(chatId: string): Promise<HandoffTarget[]>;
  handOff(chatId: string, computerId: string): Promise<void>;
  bringBack(chatId: string): Promise<void>;
  /** Once the handoff or bringing back under way is over, however it went. */
  finished(chatId: string): Promise<void>;
}

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

/** The start of what the user is asked about. */
const head = (text: string, limit = 600) =>
  text.length > limit ? `${sliceWhole(text, 0, limit)}…` : text;

/** Keeps each validated tool name paired with its own schema output. */
type ToolCall = {
  [N in RelayToolName]: { name: N; input: RelayToolArgs<N> };
}[RelayToolName];

type ReadUsage = (
  provider: UsageProvider,
  force: boolean,
  account?: string,
) => Promise<ProviderUsage>;

export type ReportProblem = (
  fields: Required<RelayToolArgs<"report_relay_problem">>,
) => Promise<void>;

/** How long restart_relay waits for its answer to leave before Relay quits. */
const RESTART_DELAY_MS = 1000;

export class StartedThreads {
  private readUsage: ReadUsage;
  private projects: ProjectAccess;
  private reads: ThreadReads;
  private pages: ThreadPages;
  private handoffs: ThreadHandoffs | undefined;
  private restart: (() => void) | undefined;
  private reportProblem: ReportProblem | undefined;
  private reviews: ThreadReviews | undefined;
  private agentChoices: AgentChoices;
  private failureWatchMs: number;
  constructor(
    private chats: Chats,
    options: {
      readUsage?: ReadUsage;
      projects?: AgentProjects;
      previews?: ThreadPreviews;
      /** Loads pages unseen for show_html and preview_html; absent without windows. */
      look?: RenderTools["look"];
      handoffs?: ThreadHandoffs;
      /** Which agents can run here and their models; absent, every runnable one, models unchecked. */
      agents?: ThreadAgents;
      /** How long start_threads watches its threads for one failing at once; absent, it doesn't. */
      failureWatchMs?: number;
      /** Restarts Relay as its footer's Restart does; only under npm run dev. */
      restart?: () => void;
      /** Fills in and shows Relay's Report a problem page; absent without windows. */
      reportProblem?: ReportProblem;
      /** Deep reviews an agent starts in its thread; absent where nothing keeps review setups. */
      reviews?: ThreadReviews;
    } = {},
  ) {
    this.readUsage = options.readUsage ?? readProviderUsage;
    this.projects = new ProjectAccess(options.projects);
    this.reads = new ThreadReads(chats, this.projects);
    this.pages = new ThreadPages(chats, options);
    this.handoffs = options.handoffs;
    this.restart = options.restart;
    this.reportProblem = options.reportProblem;
    this.reviews = options.reviews;
    this.agentChoices = new AgentChoices(options.agents);
    this.failureWatchMs = options.failureWatchMs ?? 0;
  }

  /** Answers one tool call made by the agent in `chatId`. */
  handle: ToolHandler = (chatId, name, args, signal) =>
    this.answer(chatId, name, args, signal).catch((error: unknown) =>
      toolText(errorMessage(error), true),
    );

  private async answer(
    chatId: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) {
    if (!Object.hasOwn(relayToolSchemas, name))
      return toolText(`There is no tool ${name}.`, true);
    const schema = relayToolSchemas[name as RelayToolName];
    const parsed = schema.safeParse(args);
    if (!parsed.success)
      return toolText(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("\n"),
        true,
      );
    const lead = await this.chats.get(chatId);
    if (lead.startedBy && !startedTools.has(name))
      return toolText(
        "A thread started by another thread can't start or drive threads of its own.",
        true,
      );
    // The lookup and parse above establish this pairing; keep it together so
    // narrowing the tool name also narrows its arguments in every branch.
    const { name: tool, input } = { name, input: parsed.data } as ToolCall;
    switch (tool) {
      case "start_threads":
        return this.start(lead, input, signal);
      case "list_threads":
        return json(await this.reads.list(lead));
      case "find_threads":
        return this.reads.find(lead, input);
      case "read_thread":
        return this.reads.read(input);
      case "send_to_thread":
        return this.sendTo(lead, input, signal);
      case "wait_for_threads":
        return this.reads.wait(lead, input, signal);
      case "stop_thread":
        return this.stop(lead, input.id, signal);
      case "hand_off_thread":
        return this.handOff(lead, input, signal);
      case "settle_thread":
        if (input.id === lead.id) return this.settleSelf(lead);
        return this.settle(lead, input.id, signal);
      case "settle_this_thread":
        return this.settleSelf(lead);
      case "usage_limits":
        return json(await this.usage(lead));
      case "list_agents":
        return json(
          await this.agentChoices.list(this.leadSide(lead).agent, input.agent),
        );
      case "list_notes":
        return this.listNotes(lead, input);
      case "add_note":
        return this.addNote(lead, input, signal);
      case "tick_note":
        return this.tickNote(lead, input, signal);
      case "move_to_worktree":
        return json(await this.chats.worktrees.enter(lead.id, input));
      case "deep_review":
        return this.deepReview(lead, input, signal);
      case "list_review_setups":
        if (!this.reviews)
          return toolText("This Relay can't run deep reviews.", true);
        return listReviewSetups(this.reviews);
      case "list_projects":
        return json(await this.projects.list(lead.projectId));
      case "add_project":
        return this.projects.add(input, (title, detail) =>
          this.approve(lead, title, detail, signal, true),
        );
      case "restart_relay":
        return this.restartRelay(lead, input, signal);
      case "import_sources":
      case "offer_import": {
        const offers = this.chats.importOffers;
        if (!lead.importFrom || !offers)
          return toolText(
            "Only a thread opened to import another app's history can.",
            true,
          );
        return toolText(
          tool === "import_sources"
            ? await offers.sources(lead.importFrom, input.project)
            : await offers.offer(lead.id, lead.importFrom, input),
        );
      }
      case "report_relay_problem":
        if (!this.reportProblem)
          return toolText("This Relay has no window to report from.", true);
        await this.reportProblem({ kind: "bug", ...input });
        return toolText(
          "Relay's Report a problem page is open with your write-up, its version, system, agents and anonymized log. The user looks it over, can add screenshots, and sends it to GitHub themselves; tell them that. Nothing was sent.",
        );
      case "open_preview":
      case "screenshot":
      case "console_errors":
        return this.pages.preview(lead, tool, input, signal);
      case "ask_html":
        return this.pages.ask(lead.id, input, signal);
      case "show_html":
      case "preview_html":
        return this.pages.render(lead.id, tool, input, signal);
      default: {
        const unhandled: never = tool;
        throw new Error(`There is no handler for tool ${unhandled}.`);
      }
    }
  }

  /**
   * Whether the user lets the lead start or message a thread of its own: a
   * new turn spends usage and may edit the project. A lead with full access
   * or leave to drive threads may, unless `always`.
   */
  private async approve(
    lead: ProjectChat,
    title: string,
    detail: string,
    signal: AbortSignal,
    always = false,
  ) {
    if (!always && (lead.drivesThreads || this.fullAccess(lead))) return true;
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

  /**
   * Whether the user lets the lead drive a thread beyond its own in its
   * project. Full access doesn't: it was given for the lead's own folder.
   * Always keeps the leave on the lead, so it asks only once.
   */
  private async drive(
    lead: ProjectChat,
    title: string,
    detail: string,
    signal: AbortSignal,
  ) {
    if (lead.drivesThreads) return true;
    const response = await this.chats.askInTurn(
      lead.id,
      {
        kind: "approval",
        title,
        detail: [detail, DRIVE_ALWAYS].filter(Boolean).join("\n\n"),
        decisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
      signal,
    );
    if (response.kind !== "approval") return false;
    if (response.decision === "acceptForSession")
      await this.chats.allowDriving(lead.id, true);
    return (
      response.decision === "accept" || response.decision === "acceptForSession"
    );
  }

  private fullAccess(lead: ProjectChat) {
    return this.leadSide(lead).last.runtimeMode === "full-access";
  }

  /** A deep review round in the lead's own thread; its reviewers run on the user's accounts, so it asks as starting threads does. */
  private async deepReview(
    lead: ProjectChat,
    input: RelayToolArgs<"deep_review">,
    signal: AbortSignal,
  ) {
    if (!this.reviews)
      return toolText("This Relay can't run deep reviews.", true);
    const { name, config } = reviewRound(this.reviews, lead, input);
    const count = config.reviewers.length;
    const approved = await this.approve(
      lead,
      `Start a deep review with ${count === 1 ? "1 reviewer" : `${count} reviewers`}?`,
      [
        `"${name}", led by ${agentName(config.lead.provider)}.`,
        ...config.reviewers.map(
          (r, i) =>
            `${i + 1}. ${agentName(r.provider)}${r.choice.model ? ` (${r.choice.model})` : ""}`,
        ),
        ...(config.focus ? [`\nFocus: ${head(config.focus)}`] : []),
      ].join("\n"),
      signal,
    );
    if (!approved)
      return toolText(
        "The user didn't start the review. Ask them what they want instead.",
        true,
      );
    await this.reviews.start(lead.id, config);
    return toolText(
      `Started ${count === 1 ? "1 reviewer" : `${count} reviewers`} with "${name}". End your answer now: their reports come to you in this thread as your next turn.`,
    );
  }

  private async restartRelay(
    lead: ProjectChat,
    { reason }: RelayToolArgs<"restart_relay">,
    signal: AbortSignal,
  ) {
    const restart = this.restart;
    if (!restart)
      return toolText(
        "This Relay doesn't run under npm run dev, so it can't restart itself.",
        true,
      );
    const approved = await this.approve(
      lead,
      "Restart Relay?",
      // One line: the agent's text can't forge more of the card.
      `${reason.replace(/\s+/g, " ")}\n\nThreads keep working; their live view comes back with Relay in a few seconds.`,
      signal,
      true,
    );
    if (!approved)
      return toolText(
        "The user didn't restart Relay. Carry on without it, or ask them.",
        true,
      );
    // Lets this answer reach the agent before Relay goes.
    setTimeout(restart, RESTART_DELAY_MS);
    return toolText(
      "Relay is restarting. Its tools answer again in a few seconds; a call before then may fail.",
    );
  }

  /**
   * A thread the lead may drive. `mine`: it started it. `sends`: it may
   * message it as freely as one in its own project.
   */
  private async target(lead: ProjectChat, id: string) {
    if (id === lead.id)
      throw new Error("That's this thread; these tools drive other threads.");
    const mine = this.reads.children(lead).some((c) => c.id === id);
    const found = await this.reads.thread(id);
    const elsewhere =
      found.chat.projectId !== lead.projectId
        ? ((await this.projects.real()).find(
            (p) => p.id === found.chat.projectId,
          )?.name ?? "another project")
        : undefined;
    return {
      ...found,
      mine,
      sends: mine && (!elsewhere || !!found.chat.startedBy?.sendsApproved),
      where: elsewhere ? ` in “${elsewhere}”` : "",
    };
  }

  private refused(what: string) {
    return toolText(
      `The user didn't let you ${what}. Ask them what they want instead.`,
      true,
    );
  }

  private async stop(lead: ProjectChat, id: string, signal: AbortSignal) {
    const { chat, mine, where } = await this.target(lead, id);
    if (
      !mine &&
      !(await this.drive(lead, `Stop “${chat.title}”${where}?`, "", signal))
    )
      return this.refused("stop it");
    // One waiting on a setup there has its agent stopped already; the
    // setup's own agent is the user's to stop.
    if (!inSetup(chat) && this.handoffs?.forwards("cancelProjectChat", [id])) {
      await this.handoffs.forward("cancelProjectChat", [id]);
      return toolText(`Stopped on ${chat.sentTo!.computer}.`);
    }
    await this.chats.cancel(id);
    return toolText("Stopped.");
  }

  /**
   * Hands a thread to another computer, or brings it back with `to` "here",
   * as the thread header does. The user always confirms: the agent there
   * runs on what's there, and the thread's agent here stops for its note.
   */
  private async handOff(
    lead: ProjectChat,
    { id, to }: RelayToolArgs<"hand_off_thread">,
    signal: AbortSignal,
  ) {
    const handoffs = this.handoffs;
    if (!handoffs)
      return toolText(
        "This Relay can't hand threads to other computers.",
        true,
      );
    const { summary, chat, where } = await this.target(lead, id);
    if (to?.toLowerCase() === "here")
      return this.bringBack(lead, handoffs, summary, chat, where, signal);
    if (summary.sentTo)
      return toolText(`It's on ${summary.sentTo.computer} already.`, true);
    const blocked = handoffBlocked(summary);
    if (blocked) return toolText(blocked, true);
    const targets = await handoffs.targets(id);
    if (!targets.length)
      return toolText(
        "No other computer is paired with this Relay. The user pairs one in Settings → Computers.",
        true,
      );
    const picked = to
      ? targets.filter((t) => t.name.toLowerCase() === to.toLowerCase())
      : targets.filter((t) => t.project);
    const target = picked.length === 1 ? picked[0]! : undefined;
    if (!target?.project) {
      const listed = targets
        .map(
          (t) =>
            `- ${t.name}: ${t.project ? `can take it, into ${t.project.name}` : t.problem}`,
        )
        .join("\n");
      return toolText(
        `${
          target
            ? `${target.name} can't take it.`
            : to
              ? `No paired computer is named "${to}".`
              : picked.length
                ? "Several computers can take it; name one in `to`."
                : "No paired computer can take it now."
        }\n${listed}`,
        true,
      );
    }
    const approved = await this.approve(
      lead,
      `Hand “${chat.title}”${where} off to ${target.name}?`,
      `Its agent stops and writes a handoff note, everything in its worktree is committed, and it carries on in ${target.project.name} on ${target.name}. Ignored files such as .env stay here.`,
      signal,
      true,
    );
    if (!approved) return this.refused("hand it off");
    await handoffs.handOff(id, target.id);
    await handoffs.finished(id);
    const sentTo = (await this.reads.thread(id)).summary.sentTo;
    if (!sentTo || sentTo.error)
      return toolText(
        `It didn't go to ${target.name}${sentTo?.error ? `: ${sentTo.error}` : "."}`,
        true,
      );
    return toolText(
      sentTo.live
        ? `It runs on ${target.name} now. send_to_thread, stop_thread, read_thread and wait_for_threads reach it there.`
        : `It's on ${target.name} now. That Relay is too old to follow from here, so it can't be messaged until it's brought back.`,
    );
  }

  private async bringBack(
    lead: ProjectChat,
    handoffs: ThreadHandoffs,
    summary: ChatSummary,
    chat: ProjectChat,
    where: string,
    signal: AbortSignal,
  ) {
    const { sentTo } = summary;
    if (!sentTo) return toolText("It's here already.", true);
    const approved = await this.approve(
      lead,
      `Bring “${chat.title}”${where} back from ${sentTo.computer}?`,
      `Its work on ${sentTo.computer} stops, the agent there writes a handoff note and commits, and the thread carries on here.`,
      signal,
      true,
    );
    if (!approved) return this.refused("bring it back");
    await handoffs.bringBack(chat.id);
    await handoffs.finished(chat.id);
    const after = (await this.reads.thread(chat.id)).summary.sentTo;
    if (after)
      return toolText(
        `It didn't come back from ${sentTo.computer}${after.error ? `: ${after.error}` : "."}`,
        true,
      );
    return toolText("It's back here.");
  }

  private async settle(lead: ProjectChat, id: string, signal: AbortSignal) {
    const { summary, chat, mine, where } = await this.target(lead, id);
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
      !mine &&
      !(await this.drive(lead, `Settle “${chat.title}”${where}?`, "", signal))
    )
      return this.refused("settle it");
    await this.chats.triage(id, { kind: "settle" });
    return toolText("Settled.");
  }

  /** The lead's own thread, once this answer ends; see ThreadTriage.settleItself. */
  private async settleSelf(lead: ProjectChat) {
    if (!(await this.chats.settleItself(lead.id)))
      return toolText("Already settled.");
    return toolText(
      lead.startedBy
        ? "It settles once this answer ends cleanly."
        : "It settles once this answer ends cleanly and the user has read it.",
    );
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
    { project, detached, threads }: RelayToolArgs<"start_threads">,
    signal: AbortSignal,
  ) {
    const elsewhere =
      project && project !== lead.projectId
        ? (await this.projects.real()).find((p) => p.id === project)
        : undefined;
    if (project && project !== lead.projectId && !elsewhere)
      return toolText("There's no such project; see list_projects.", true);
    // The lead's uncommitted work belongs to another repository.
    if (elsewhere && threads.some((t) => t.uncommitted === true))
      return toolText(
        "`uncommitted` only works in your own project; leave it out for another one.",
        true,
      );
    const { last, agent: caller, from } = this.leadSide(lead);
    const refused = await this.agentChoices.refusal(
      threads.map((t) => ({
        ...t,
        model:
          t.model ?? ((t.agent ?? caller) === caller ? last.choice.model : ""),
        fast: t.fast ?? ((t.agent ?? caller) === caller && last.choice.fast),
      })),
      caller,
    );
    if (refused) return toolText(refused, true);
    const working = this.reads.children(lead).filter((c) => c.running).length;
    if (!detached && working + threads.length > STARTED_LIMIT)
      return toolText(
        `${working} of your threads are working; at most ${STARTED_LIMIT} may at once. Wait for some to finish first.`,
        true,
      );
    const count = `${threads.length} thread${threads.length === 1 ? "" : "s"}`;
    const listed = threads
      .map(
        (t, i) =>
          `${i + 1}. ${agentName(t.agent ?? caller)}${t.model ? ` (${t.model})` : ""}${t.worktree === false ? ", in the checkout" : ""}${t.plan ? ", plans first" : ""}\n${head(t.prompt)}`,
      )
      .join("\n\n");
    const title = `Start ${count}${detached ? " of their own" : ""}${elsewhere ? ` in “${elsewhere.name}”` : ""}?`;
    const approved =
      elsewhere || detached
        ? await this.drive(
            lead,
            title,
            elsewhere
              ? `In ${elsewhere.path}${this.fullAccess(lead) ? ", with full access: edits and commands run without asking" : ""}.\n\n${listed}`
              : listed,
            signal,
          )
        : await this.approve(lead, title, listed, signal);
    if (!approved)
      return toolText(
        "The user didn't start these threads. Ask them what they want instead.",
        true,
      );
    const started: { id?: string; [key: string]: unknown }[] = [];
    for (const spec of threads) {
      const agent: AgentProvider = spec.agent ?? caller;
      const same = agent === caller;
      const model =
        spec.model !== undefined ||
        spec.effort !== undefined ||
        spec.fast !== undefined
          ? {
              choice: {
                model: spec.model ?? (same ? last.choice.model : ""),
                fast: spec.fast ?? (same && last.choice.fast),
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
        const chat = await this.create(
          lead,
          elsewhere?.id ?? lead.projectId,
          spec.worktree,
          detached ? undefined : caller,
        );
        // A worktree made from the commit alone would miss the work in progress it's about.
        const copied =
          chat.worktree && !elsewhere && spec.uncommitted !== false
            ? await this.chats.worktreeFrom(chat.id, lead.id, spec.prompt)
            : undefined;
        await this.chats.send(chat.id, send.data);
        started.push({
          id: chat.id,
          title: promptTitle(spec.prompt),
          agent,
          ...(spec.plan ? { plan: true } : {}),
          ...(elsewhere ? { project: elsewhere.name } : {}),
          ...(detached ? { detached: true } : {}),
          worktree: !!chat.worktree,
          ...(copied ? { uncommittedFilesCopied: copied } : {}),
        });
      } catch (error) {
        started.push({
          error: errorMessage(error),
        });
      }
    }
    const failed = await this.failedAtOnce(
      started.flatMap((t) => (t.id ? [t.id] : [])),
      signal,
    );
    return json(
      started.map((t) => {
        const dead = t.id ? failed.get(t.id) : undefined;
        if (!dead) return t;
        return {
          ...t,
          failed: dead.error,
          ...(dead.settled ? { settled: true } : {}),
          note: dead.settled ? FAILED_SETTLED : FAILED_AT_ONCE,
        };
      }),
    );
  }

  /**
   * Watches new threads until each shows work or fails, so one that fails
   * as it starts, like on a model its account lacks, is reported failed and
   * settled once its run lets go, rather than left dead in Activity.
   */
  private async failedAtOnce(ids: string[], signal: AbortSignal) {
    const failed = new Map<string, { error: string; settled: boolean }>();
    const until = Date.now() + this.failureWatchMs;
    let open = ids;
    while (open.length && !signal.aborted && Date.now() < until) {
      await delay(Math.min(EARLY_POLL_MS, until - Date.now()), undefined, {
        signal,
      }).catch(() => {});
      const still: string[] = [];
      for (const id of open) {
        // Gone already, as the user may delete it: nothing to report.
        const found = await this.reads.thread(id).catch(() => undefined);
        if (!found) continue;
        const { summary, chat } = found;
        const last = answers(chat).at(-1);
        if (last?.status === "failed") {
          // Settling waits for its run to let go of it.
          const settled =
            chatStatus(summary, chat).status === "failed" &&
            (await this.chats.triage(id, { kind: "settle" }).then(
              () => true,
              () => false,
            ));
          failed.set(id, { error: last.error ?? "It failed.", settled });
          if (!settled) still.push(id);
        } else if (!last || (last.status === "streaming" && !hasWork(last)))
          still.push(id);
      }
      open = still;
    }
    return failed;
  }

  /** Each agent's limits on the accounts the calling thread uses. */
  private usage(caller: ProjectChat) {
    const now = Date.now();
    return Promise.all(
      usageProviders.map(async (agent) => {
        const account = pinnedAccount(caller.accounts, agent);
        const usage = await this.readUsage(agent, false, account);
        return {
          agent,
          ...(account ? { account } : {}),
          ...Object.fromEntries(
            usage.windows.map((w) => [
              w.id ?? w.kind,
              {
                ...(w.label ? { label: w.label } : {}),
                usedPercent: Math.round(w.usedPercent),
                ...(w.resetsAt
                  ? {
                      resetsAt: localTime(w.resetsAt),
                      resetsIn: resetsIn(w.resetsAt, now),
                    }
                  : {}),
              },
            ]),
          ),
          ...(usage.message ? { note: usage.message } : {}),
        };
      }),
    );
  }

  /**
   * A worktree unless asked otherwise or the project isn't a repository.
   * Without the starting agent it's a thread of its own, not under the lead.
   */
  private async create(
    lead: ProjectChat,
    projectId: string,
    worktree: boolean | undefined,
    agent: AgentProvider | undefined,
  ) {
    const startedBy = agent ? { chatId: lead.id, agent } : undefined;
    const scope = { kind: "project" } as const;
    if (worktree === false)
      return this.chats.create(projectId, scope, "checkout", startedBy);
    try {
      return await this.chats.create(projectId, scope, "worktree", startedBy);
    } catch (error) {
      if (worktree === true) throw error;
      return this.chats.create(projectId, scope, "checkout", startedBy);
    }
  }

  /** The thread whose notes a call means: the one named, or the caller's own. */
  private async notesOf(lead: ProjectChat, thread?: string) {
    if (!thread || thread === lead.id) return lead;
    return this.chats.get(thread).catch(() => {
      throw new Error("There's no such thread; see find_threads.");
    });
  }

  private async listNotes(
    lead: ProjectChat,
    { thread }: RelayToolArgs<"list_notes">,
  ) {
    const chat = await this.notesOf(lead, thread);
    const notes = await this.chats.notes.list(chat.id);
    return json({
      ...(chat.id === lead.id ? {} : { thread: chat.title }),
      notes: notes.map(noteForAgent),
    });
  }

  /**
   * The thread whose notes a change goes into. Another thread's take the same
   * leave as driving it: what is kept there is the first thing read_thread
   * hands any agent reading it.
   */
  private async notesToChange(
    lead: ProjectChat,
    thread: string | undefined,
    what: string,
    detail: string,
    signal: AbortSignal,
  ) {
    if (!thread || thread === lead.id) return lead;
    if (lead.startedBy)
      throw new Error(
        "A thread started by another thread keeps notes only in its own.",
      );
    const { chat, mine, where } = await this.target(lead, thread);
    if (
      !mine &&
      !(await this.drive(
        lead,
        `${what} “${chat.title}”${where}?`,
        detail,
        signal,
      ))
    )
      return undefined;
    return chat;
  }

  private async addNote(
    lead: ProjectChat,
    { text, thread }: RelayToolArgs<"add_note">,
    signal: AbortSignal,
  ) {
    const chat = await this.notesToChange(
      lead,
      thread,
      "Keep a note in",
      head(text),
      signal,
    );
    if (!chat) return this.refused("keep this there");
    const note = await this.chats.notes.add(chat.id, {
      text,
      by: this.leadSide(lead).agent,
    });
    return toolText(
      `Kept as ${note.id}${chat.id === lead.id ? "" : ` in “${chat.title}”`}.`,
    );
  }

  private async tickNote(
    lead: ProjectChat,
    { note, item, done = true, thread }: RelayToolArgs<"tick_note">,
    signal: AbortSignal,
  ) {
    const chat = await this.notesToChange(
      lead,
      thread,
      `${done ? "Tick" : "Untick"} item ${item} of ${note} in`,
      "",
      signal,
    );
    if (!chat) return this.refused(`${done ? "tick" : "untick"} it`);
    await this.chats.notes.tick(chat.id, note, item, done);
    return toolText(`${done ? "Ticked" : "Unticked"} ${note} item ${item}.`);
  }

  private async sendTo(
    lead: ProjectChat,
    { id, message, steer }: RelayToolArgs<"send_to_thread">,
    signal: AbortSignal,
  ) {
    const { chat, sends, where } = await this.target(lead, id);
    const previous = chat.lastInput;
    if (!previous) return toolText("That thread hasn't started yet.", true);
    const title = `${steer ? "Steer" : "Send to"} “${chat.title}”${where}?`;
    const approved = sends
      ? await this.approve(lead, title, head(message), signal)
      : await this.drive(lead, title, head(message), signal);
    if (!approved) return this.refused("send this");
    const { from } = this.leadSide(lead);
    const agent = sentAgent(previous);
    const send: ProjectChatSend = {
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
    };
    // A send to one waiting on a setup would reach the setup's agent instead.
    if (inSetup(chat))
      return toolText(
        `“${chat.title}” is on its way to ${chat.sentTo!.computer}, which is still being set up for it. Try again once it's there.`,
        true,
      );
    if (this.handoffs?.forwards("sendProjectChat", [id, send])) {
      const computer = chat.sentTo!.computer;
      await this.handoffs.forward("sendProjectChat", [id, send]);
      const held = (await this.chats.liveHandoff.outbox(id)).some(
        (h) => h.input.id === send.id,
      );
      return toolText(
        held
          ? `${computer} is offline; it goes out once it's back.`
          : `Sent; it runs on ${computer}.`,
      );
    }
    // Read now: approving may have taken long enough for the answer to end.
    const now = await this.reads.thread(id);
    const working = chatStatus(now.summary, now.chat).status === "working";
    await this.chats.send(id, send);
    if (!working) return toolText("Sent.");
    return toolText(
      steer
        ? "Steered; it reads it mid-answer."
        : "Queued; it goes out when its current answer ends. To reach it mid-answer, send with steer.",
    );
  }
}
