import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { agentName, type AgentProvider } from "../../shared/agents";
import { hasAccounts } from "../../shared/agent-accounts";
import { errorMessage } from "../../shared/error-message";
import { fitModel } from "../../shared/model-fit";
import type { NewThreadModel } from "../../shared/new-thread-models";
import {
  projectChatSendSchema,
  type ChatMessage,
  type Project,
  type ProjectChat,
  type ProjectChatSend,
} from "../../shared/projects";
import { promptTitle } from "../agents/thread-titles";
import { chatStatus, type ProjectChats } from "../project-chats";
import { STARTED_LIMIT, toolText, type RelayToolArgs } from "../relay-mcp";
import { Approvals } from "./approvals";
import { defaultChoice, leadSide } from "./lead-side";
import type { ProjectAccess } from "./project-access";
import type { AgentChoices } from "./thread-agents";
import type { ThreadReads } from "./thread-reads";
import { head, json } from "./tool-output";

/** How long start_threads watches new threads for one that fails as it starts, as Relay serves it. */
export const EARLY_FAILURE_MS = 10_000;
const EARLY_POLL_MS = 250;
const FAILED_AT_ONCE =
  "It failed as it started; nothing is working on it. Fix the cause, often the agent or model, and start it again, or tell the user.";
const FAILED_SETTLED =
  "It failed as it started, so Relay settled it: it's out of the user's Activity and they can bring it back. Fix the cause, often the agent or model, and start a new thread, or tell the user.";
const hasWork = (m: ChatMessage) =>
  !!m.body.trim() || !!m.trace?.length || !!m.activity?.length;

/** The main conversation's answers, newest last. */
const answers = (chat: ProjectChat) =>
  chat.messages.filter((m) => m.role === "assistant" && !m.parentId);

type StartThreadsRequest = RelayToolArgs<"start_threads">;
/** One thread start_threads asks for: its task, agent, model and how it works. */
type ThreadSpec = StartThreadsRequest["threads"][number];
/** Where new threads go: the lead's own project, or another of the user's. */
type Destination =
  { own: true; projectId: string } | { own: false; project: Project };
/** What start_threads reports of one thread: its id and how it starts, or why it didn't. */
type StartedEntry = { id?: string; [key: string]: unknown };

/**
 * What a started thread runs on. The lead's own agent carries on with the
 * lead's model and settings, another agent starts on its defaults, and
 * whatever the call names wins over both.
 */
function modelFor(
  spec: ThreadSpec,
  leadAgent: AgentProvider,
  leadLast: ProjectChatSend,
): NewThreadModel {
  const sameAgent = (spec.agent ?? leadAgent) === leadAgent;
  const base = sameAgent ? leadLast.choice : defaultChoice;
  return {
    choice: {
      model: spec.model ?? base.model,
      fast: spec.fast ?? base.fast,
      reasoningEffort: spec.effort ?? base.reasoningEffort,
    },
    ...(sameAgent && leadLast.contextWindow
      ? { contextWindow: leadLast.contextWindow }
      : {}),
  };
}

/** How a thread will work, for the user's approval: "Codex (gpt-5), read only, plans first". */
function describeSpec(spec: ThreadSpec, leadAgent: AgentProvider) {
  const agent = agentName(spec.agent ?? leadAgent);
  const where = spec.readOnly
    ? "read only"
    : spec.worktree === false
      ? "in the checkout"
      : undefined;
  return [
    spec.model ? `${agent} (${spec.model})` : agent,
    where,
    spec.plan && "plans first",
  ]
    .filter(Boolean)
    .join(", ");
}

/** start_threads: new threads the lead hands tasks to, after the user says yes. */
export class ThreadStarts {
  constructor(
    private chats: Pick<
      ProjectChats,
      "create" | "send" | "worktreeFrom" | "triage"
    >,
    private reads: Pick<ThreadReads, "children" | "thread">,
    private projects: Pick<ProjectAccess, "real">,
    private agentChoices: Pick<AgentChoices, "refusal">,
    private approvals: Approvals,
    /** How long it watches new threads for one failing at once; 0, it doesn't. */
    private failureWatchMs: number,
  ) {}

  /** start_threads: the agent in `lead` asks to start new threads. */
  async startThreads(
    lead: ProjectChat,
    request: StartThreadsRequest,
    signal: AbortSignal,
  ) {
    const destination = await this.destinationFor(lead, request.project);
    if (!destination)
      return toolText("There's no such project; see list_projects.", true);
    const refusal = await this.refusalFor(lead, request, destination);
    if (refusal) return toolText(refusal, true);
    const approved = await this.askUserToStart(
      lead,
      request,
      destination,
      signal,
    );
    if (!approved)
      return toolText(
        "The user didn't start these threads. Ask them what they want instead.",
        true,
      );
    const started: StartedEntry[] = [];
    for (const spec of request.threads)
      started.push(
        await this.startThread(lead, spec, request.detached, destination),
      );
    return json(await this.withEarlyFailures(started, signal));
  }

  /** Where new threads go: the project asked for, or the lead's own; undefined when there's no such project. */
  private async destinationFor(
    lead: ProjectChat,
    asked: string | undefined,
  ): Promise<Destination | undefined> {
    if (!asked || asked === lead.projectId)
      return { own: true, projectId: lead.projectId };
    const project = (await this.projects.real()).find((p) => p.id === asked);
    return project && { own: false, project };
  }

  /** Why these threads can't start, said to the agent; undefined when they can. */
  private async refusalFor(
    lead: ProjectChat,
    { detached, threads }: StartThreadsRequest,
    destination: Destination,
  ) {
    // The lead's uncommitted work is in its own repository, not that one.
    if (!destination.own && threads.some((t) => t.uncommitted === true))
      return "`uncommitted` only works in your own project; leave it out for another one.";
    const { last, agent: leadAgent } = leadSide(lead);
    const refused = await this.agentChoices.refusal(
      threads.map((spec) => {
        const { model, fast } = modelFor(spec, leadAgent, last).choice;
        return { ...spec, model, fast };
      }),
      leadAgent,
    );
    if (refused) return refused;
    const working = this.reads.children(lead).filter((c) => c.running).length;
    if (!detached && working + threads.length > STARTED_LIMIT)
      return `${working} of your threads are working; at most ${STARTED_LIMIT} may at once. Wait for some to finish first.`;
    return undefined;
  }

  /** Asks the user. Threads in another project, or of their own, need the leave to drive threads. */
  private askUserToStart(
    lead: ProjectChat,
    { detached, threads }: StartThreadsRequest,
    destination: Destination,
    signal: AbortSignal,
  ) {
    const { agent: leadAgent } = leadSide(lead);
    const count = `${threads.length} thread${threads.length === 1 ? "" : "s"}`;
    const title = `Start ${count}${detached ? " of their own" : ""}${destination.own ? "" : ` in “${destination.project.name}”`}?`;
    const listed = threads
      .map(
        (spec, i) =>
          `${i + 1}. ${describeSpec(spec, leadAgent)}\n${head(spec.prompt)}`,
      )
      .join("\n\n");
    if (destination.own && !detached)
      return this.approvals.ask(lead, title, listed, signal);
    const where =
      !destination.own &&
      `In ${destination.project.path}${this.approvals.fullAccess(lead) ? ", with full access: edits and commands run without asking" : ""}.`;
    return this.approvals.askToDrive(
      lead,
      title,
      [where, listed].filter(Boolean).join("\n\n"),
      signal,
    );
  }

  /** Creates one thread and sends it its task; what went wrong goes in its entry rather than thrown. */
  private async startThread(
    lead: ProjectChat,
    spec: ThreadSpec,
    detached: boolean | undefined,
    destination: Destination,
  ): Promise<StartedEntry> {
    const { last, agent: leadAgent, from } = leadSide(lead);
    const agent = spec.agent ?? leadAgent;
    const model = fitModel(agent, modelFor(spec, leadAgent, last));
    const account = hasAccounts(agent) ? lead.accounts?.[agent] : undefined;
    const send = projectChatSendSchema.safeParse({
      id: randomUUID(),
      body: spec.prompt,
      choice: model.choice,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      provider: agent,
      to: agent,
      runtimeMode: spec.readOnly ? "read-only" : last.runtimeMode,
      interactionMode: spec.plan ? "plan" : "default",
      ...(account ? { account } : {}),
      fromThread: from,
    } satisfies ProjectChatSend);
    if (!send.success)
      return {
        error: send.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      };
    // A read-only thread changes nothing, so it needn't have a worktree.
    const worktree = spec.worktree ?? (spec.readOnly ? false : undefined);
    try {
      const chat = await this.create(
        lead,
        destination.own ? destination.projectId : destination.project.id,
        worktree,
        // Without the lead's agent it's a thread of its own.
        detached ? undefined : leadAgent,
      );
      // A worktree made from the commit alone would miss the work in progress it's about.
      const copied =
        chat.worktree && destination.own && spec.uncommitted !== false
          ? await this.chats.worktreeFrom(chat.id, lead.id, spec.prompt)
          : undefined;
      await this.chats.send(chat.id, send.data);
      return {
        id: chat.id,
        title: promptTitle(spec.prompt),
        agent,
        ...(spec.plan ? { plan: true } : {}),
        ...(spec.readOnly ? { readOnly: true } : {}),
        ...(destination.own ? {} : { project: destination.project.name }),
        ...(detached ? { detached: true } : {}),
        worktree: !!chat.worktree,
        ...(copied ? { uncommittedFilesCopied: copied } : {}),
      };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  /** The entries again, with the threads that failed as they started marked so. */
  private async withEarlyFailures(
    started: StartedEntry[],
    signal: AbortSignal,
  ) {
    const failed = await this.failedAtOnce(
      started.flatMap((entry) => (entry.id ? [entry.id] : [])),
      signal,
    );
    return started.map((entry) => {
      const failure = entry.id ? failed.get(entry.id) : undefined;
      if (!failure) return entry;
      return {
        ...entry,
        failed: failure.error,
        ...(failure.settled ? { settled: true } : {}),
        note: failure.settled ? FAILED_SETTLED : FAILED_AT_ONCE,
      };
    });
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
}
