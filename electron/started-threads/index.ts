// What Relay's tools do: a thread's agent starts threads of its own and
// drives them, in its project or another the user has or lets it add. A
// started thread is an ordinary thread that remembers who started it. Any
// thread may read any other; a lead drives its own, and any other once the
// user lets it, and a started thread only reads, so nothing starts threads of
// threads.
import { ThreadReads } from "./thread-reads";
import { LeadMessages } from "./lead-messages";
import { ProjectAccess, type AgentProjects } from "./project-access";
import { ThreadPages } from "./thread-pages";
import { head, json, localTime } from "./tool-output";
import {
  listReviewSetups,
  reviewRound,
  type ThreadReviews,
} from "./thread-reviews";
import { Approvals } from "./approvals";
import { HandoffTool, type ThreadHandoffs } from "./handoff-tool";
import { leadSide } from "./lead-side";
import { NoteTools } from "./note-tools";
import { ThreadDriving } from "./thread-driving";
import { ThreadStarts } from "./thread-starts";
import {
  agentName,
  usageProviders,
  type UsageProvider,
} from "../../shared/agents";
import { pinnedAccount } from "../../shared/agent-accounts";
import { AgentChoices, type ThreadAgents } from "./thread-agents";
import { ThreadSchedules, type ScheduleTools } from "./thread-schedules";
import { resetsIn, type ProviderUsage } from "../../shared/provider-usage";
import type { ProjectChat } from "../../shared/projects";
import type { ToolHandler } from "../agent-host/client";
import { readProviderUsage } from "../agents/provider-usage";
import type { ProjectChats } from "../project-chats";
import type { ThreadPreviews } from "../preview";
import type { RenderTools } from "../html-renders";
import {
  relayToolSchemas,
  toolText,
  startedTools,
  type RelayToolArgs,
  type RelayToolName,
} from "../relay-mcp";
import { errorMessage } from "../../shared/error-message";

export { localTime } from "./tool-output";
export { EARLY_FAILURE_MS } from "./thread-starts";
export type { AgentProjects } from "./project-access";
export type { ThreadHandoffs } from "./handoff-tool";
export type { ThreadReviews } from "./thread-reviews";
export type { ScheduleTools } from "./thread-schedules";

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
  worktrees: Pick<ProjectChats["worktrees"], "entry">;
  liveHandoff: Pick<ProjectChats["liveHandoff"], "outbox">;
  importOffers?: Pick<ProjectChats["importOffers"], "sources" | "offer">;
  projectMoves?: Pick<ProjectChats["projectMoves"], "blocked" | "move">;
  onAnswersEnd?: ProjectChats["onAnswersEnd"];
};

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
  private approvals: Approvals;
  private starts: ThreadStarts;
  private driving: ThreadDriving;
  private handoffs: HandoffTool;
  private notes: NoteTools;
  private leads: LeadMessages;
  private pages: ThreadPages;
  private restart: (() => void) | undefined;
  private reportProblem: ReportProblem | undefined;
  private reviews: ThreadReviews | undefined;
  private schedules: ThreadSchedules | undefined;
  private agentChoices: AgentChoices;

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
      /** The prompts Relay sends on its own; absent where nothing runs them. */
      schedules?: ScheduleTools;
    } = {},
  ) {
    this.readUsage = options.readUsage ?? readProviderUsage;
    this.projects = new ProjectAccess(options.projects);
    this.reads = new ThreadReads(chats, this.projects);
    this.approvals = new Approvals(chats);
    this.agentChoices = new AgentChoices(options.agents);
    this.starts = new ThreadStarts(
      chats,
      this.reads,
      this.projects,
      this.agentChoices,
      this.approvals,
      options.failureWatchMs ?? 0,
    );
    this.driving = new ThreadDriving(
      chats,
      this.reads,
      this.projects,
      this.approvals,
      options.handoffs,
    );
    this.handoffs = new HandoffTool(
      this.reads,
      this.projects,
      this.approvals,
      options.handoffs,
    );
    this.notes = new NoteTools(
      chats,
      this.reads,
      this.projects,
      this.approvals,
    );
    this.leads = new LeadMessages(
      chats,
      this.reads,
      (lead, body, from) => this.driving.sendToLead(lead, body, from),
      (chat) => leadSide(chat).from,
    );
    chats.onAnswersEnd?.((turn) => {
      this.leads
        .ended(turn)
        .catch((e) =>
          console.warn("Could not tell the lead how its thread ended:", e),
        );
    });
    this.pages = new ThreadPages(chats, options);
    this.restart = options.restart;
    this.reportProblem = options.reportProblem;
    this.reviews = options.reviews;
    this.schedules = options.schedules
      ? new ThreadSchedules(options.schedules)
      : undefined;
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
        return this.starts.startThreads(lead, input, signal);
      case "list_threads":
        return json(await this.reads.list(lead));
      case "find_threads":
        return this.reads.find(lead, input);
      case "read_thread":
        return this.reads.read(input);
      case "send_to_thread":
        return this.driving.sendTo(lead, input, signal);
      case "wait_for_threads":
        return this.reads.wait(lead, input, signal);
      case "stop_thread":
        return this.driving.stop(lead, input.id, signal);
      case "message_lead":
        return this.leads.message(lead, input.message);
      case "hand_off_thread":
        return this.handoffs.handOff(lead, input, signal);
      case "settle_thread":
        if (input.id === lead.id) return this.driving.settleSelf(lead);
        return this.driving.settle(lead, input.id, signal);
      case "settle_this_thread":
        return this.driving.settleSelf(lead);
      case "wake_this_thread":
        return this.driving.wakeLater(lead, input);
      case "usage_limits":
        return json(await this.usage(lead));
      case "list_agents":
        return json(
          await this.agentChoices.list(leadSide(lead).agent, input.agent),
        );
      case "list_notes":
        return this.notes.listNotes(lead, input);
      case "add_note":
        return this.notes.addNote(lead, input, signal);
      case "tick_note":
        return this.notes.tickNote(lead, input, signal);
      case "move_to_worktree":
        return json(await this.chats.worktrees.entry.enter(lead.id, input));
      case "deep_review":
        return this.deepReview(lead, input, signal);
      case "list_review_setups":
        if (!this.reviews)
          return toolText("This Relay can't run deep reviews.", true);
        return listReviewSetups(this.reviews);
      case "list_schedules":
      case "add_schedule":
      case "update_schedule":
      case "pause_schedule":
      case "remove_schedule":
      case "run_schedule":
        return this.schedule(lead, { name: tool, input } as ToolCall, signal);
      case "list_projects":
        return json(await this.projects.list(lead.projectId));
      case "move_to_project":
        return this.moveToProject(lead, input.project, signal);
      case "add_project":
        return this.projects.add(input, (title, detail) =>
          this.approvals.ask(lead, title, detail, signal, true),
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

  /** Moves the lead's own thread to another project, once the user says so. */
  private async moveToProject(
    lead: ProjectChat,
    projectId: string,
    signal: AbortSignal,
  ) {
    const moves = this.chats.projectMoves;
    if (!moves) return toolText("Threads can't move from here.", true);
    const target = (await this.projects.real()).find((p) => p.id === projectId);
    if (!target)
      return toolText(
        "There's no such project; list_projects gives their ids.",
        true,
      );
    const problem = await moves.blocked(lead.id, target.id);
    if (problem) return toolText(problem, true);
    const approved = await this.approvals.ask(
      lead,
      `Move this thread to “${target.name}”?`,
      `${target.path}\nThe conversation carries on there with its agents. Nothing is copied: files stay where they are. Agents in this thread can read and change everything in this folder.`,
      signal,
      true,
    );
    if (!approved)
      return toolText(
        "The user didn't move this thread. Ask them what they want instead.",
        true,
      );
    return json(await moves.move(lead.id, target.id));
  }

  /**
   * The schedule tools. Saving or turning one on always asks, even with full
   * access: it spends usage while the user is away. A test run asks as
   * starting a thread does.
   */
  private schedule(lead: ProjectChat, call: ToolCall, signal: AbortSignal) {
    const schedules = this.schedules;
    if (!schedules) return toolText("This Relay can't run schedules.", true);
    const { last, agent } = leadSide(lead);
    const defaults = { agent, choice: last.choice, runtimeMode: last.runtimeMode };
    const always = (title: string, detail: string) =>
      this.approvals.ask(lead, title, detail, signal, true);
    switch (call.name) {
      case "list_schedules":
        return schedules.list();
      case "add_schedule":
        return schedules.add(lead, call.input, defaults, always);
      case "update_schedule":
        return schedules.update(call.input, defaults, always);
      case "pause_schedule":
        return schedules.pause(call.input, always);
      case "remove_schedule":
        return schedules.remove(call.input);
      case "run_schedule":
        return schedules.run(call.input, (title, detail) =>
          this.approvals.ask(lead, title, detail, signal),
        );
      default:
        throw new Error(`${call.name} isn't a schedule tool.`);
    }
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
    const approved = await this.approvals.ask(
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
    const approved = await this.approvals.ask(
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
}
