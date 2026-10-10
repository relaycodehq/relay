// What Relay's tools do: a thread's agent starts threads of its own and
// drives them, in its project or another the user has or lets it add. A
// started thread is an ordinary thread that remembers who started it. Any
// thread may read any other; a lead drives its own, and any other once the
// user lets it, and a started thread only reads, so nothing starts threads of
// threads.
import { inputBlocksThread } from "../../shared/thread-state";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import {
  agentName,
  usageProviders,
  type AgentProvider,
  type UsageProvider,
} from "../../shared/agents";
import { hasAccounts, pinnedAccount } from "../../shared/agent-accounts";
import { fitModel } from "../../shared/model-fit";
import { resetsIn, type ProviderUsage } from "../../shared/provider-usage";
import {
  projectChatSendSchema,
  type ChatSummary,
  type Project,
  type ProjectChat,
  type ProjectChatSend,
} from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import { noteForAgent } from "../../shared/thread-notes";
import type { ModelChoice } from "../../shared/settings";
import type { HtmlRender } from "../../shared/html-render";
import type { ToolHandler } from "../agent-host/client";
import { promptTitle } from "../agents/thread-titles";
import { readProviderUsage } from "../agents/provider-usage";
import type { ProjectChats } from "../project-chats";
import {
  answerPreviewTool,
  type PreviewToolName,
  type ThreadPreviews,
} from "../preview";
import {
  answerRenderTool,
  type RenderToolName,
  type RenderTools,
} from "../html-renders";
import {
  relayToolSchemas,
  toolText,
  STARTED_LIMIT,
  startedTools,
  type RelayToolArgs,
  type RelayToolName,
} from "../relay-mcp";
import { folderVerdict, realFolder, type FolderRules } from "./project-folder";

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
const DRIVE_ALWAYS =
  "Always lets this thread start, message, stop and settle any thread in any project without asking again. Reading needs no permission.";
const POLL_MS = 1000;

type Chats = Pick<
  ProjectChats,
  | "list"
  | "startedThreads"
  | "allowDriving"
  | "get"
  | "create"
  | "send"
  | "cancel"
  | "askInTurn"
  | "worktreeFrom"
  | "triage"
  | "showRender"
  | "askWithPage"
  | "enterWorktree"
  | "notes"
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
  if (inputBlocksThread(summary)) return "needs-input";
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

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The user's wall-clock time with its offset, like 2026-10-08T16:00:00+02:00.
 * Agents read a UTC `Z` stamp's hours out to the user as if they were local.
 */
export function localTime(at: number) {
  const d = new Date(at);
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

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

type ReadUsage = (
  provider: UsageProvider,
  force: boolean,
  account?: string,
) => Promise<ProviderUsage>;

/** The user's projects as the tools see and add them. */
export interface AgentProjects {
  list(): Promise<Project[]>;
  /** Adds the real folder the user approved, as the user's + does; refuses it once it resolves elsewhere. */
  add(folder: string): Promise<Project>;
  /** The root of the Git repository `dir` is in; null when it's in none. */
  repositoryRoot(dir: string): Promise<string | null>;
  /** Where home, Relay's data and the system's folders are, for the refusals. */
  rules(): Promise<Omit<FolderRules, "projects">>;
}

export class StartedThreads {
  private readUsage: ReadUsage;
  private projects: AgentProjects | undefined;
  private previews: ThreadPreviews | undefined;
  private look: RenderTools["look"];
  constructor(
    private chats: Chats,
    options: {
      readUsage?: ReadUsage;
      projects?: AgentProjects;
      previews?: ThreadPreviews;
      /** Loads pages unseen for show_html and preview_html; absent without windows. */
      look?: RenderTools["look"];
    } = {},
  ) {
    this.readUsage = options.readUsage ?? readProviderUsage;
    this.projects = options.projects;
    this.previews = options.previews;
    this.look = options.look;
  }

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
    if (lead.startedBy && !startedTools.has(name))
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
      case "find_threads":
        return this.find(lead, input);
      case "read_thread":
        return this.read(lead, input);
      case "send_to_thread":
        return this.sendTo(lead, input, signal);
      case "wait_for_threads":
        return this.wait(lead, input, signal);
      case "stop_thread":
        return this.stop(lead, input.id, signal);
      case "settle_thread":
        return this.settle(lead, input.id, signal);
      case "usage_limits":
        return json(await this.usage(lead));
      case "list_notes":
        return this.listNotes(lead, input);
      case "add_note":
        return this.addNote(lead, input, signal);
      case "tick_note":
        return this.tickNote(lead, input, signal);
      case "move_to_worktree":
        return json(await this.chats.enterWorktree(lead.id, input));
      case "list_projects":
        return json(await this.listProjects(lead));
      case "add_project":
        return this.addProject(lead, input, signal);
      case "open_preview":
      case "screenshot":
      case "console_errors":
        if (!this.previews)
          return toolText("Previews aren't available in this Relay.", true);
        return answerPreviewTool(
          this.previews,
          { projectId: lead.projectId, chatId: lead.id },
          name as PreviewToolName,
          input,
          signal,
        );
      case "ask_html":
        return this.askPage(lead, input, signal);
      case "show_html":
      case "preview_html":
        return answerRenderTool(
          {
            look: this.look,
            show: (id, render, pages) =>
              this.chats.showRender(id, render, pages),
          },
          lead.id,
          name as RenderToolName,
          input,
          signal,
        );
    }
  }

  /**
   * Leaves the agent's page in its answer for the user to answer whenever
   * they like; the answer comes as their next message, so nothing waits on a
   * tool call that a client would time out.
   */
  private async askPage(
    lead: ProjectChat,
    { title, html, detail }: RelayToolArgs<"ask_html">,
    signal: AbortSignal,
  ) {
    const look =
      this.look && (await this.look(html, {}, signal).catch(() => undefined));
    const page: HtmlRender = {
      id: randomUUID(),
      title,
      created: Date.now(),
      pages: [look ? { heights: look.heights } : {}],
    };
    await this.chats.askWithPage(lead.id, page, html, detail ?? title);
    return toolText(
      `Shown to the user as "${title}". Their answer comes as their next message, as the JSON the page handed back, or word that they skipped it. If you can't go on without it, end your turn now and wait.`,
    );
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

  /** The threads the lead started, in whichever project. */
  private children(lead: ProjectChat) {
    return this.chats.startedThreads(lead.id).filter((c) => !c.archivedAt);
  }

  private reachProjects() {
    if (!this.projects)
      throw new Error("Relay's projects can't be reached from here.");
    return this.projects;
  }

  /** The user's projects an agent may start threads in: all but Scratchpad's. */
  private async realProjects() {
    return (await this.reachProjects().list()).filter((p) => !p.scratch);
  }

  private async listProjects(lead: ProjectChat) {
    return (await this.realProjects()).map((p) => ({
      id: p.id,
      name: p.name,
      folder: p.path,
      git: !p.plain,
      ...(p.id === lead.projectId ? { current: true } : {}),
    }));
  }

  private async addProject(
    lead: ProjectChat,
    { folder }: RelayToolArgs<"add_project">,
    signal: AbortSignal,
  ) {
    const projects = this.reachProjects();
    const rules = await projects.rules();
    const found = await realFolder(folder, rules.platform);
    if ("refused" in found) return toolText(found.refused, true);
    const { real } = found;
    const listed = await projects.list();
    const verdict = folderVerdict(real, { ...rules, projects: listed });
    if (verdict.kind === "refused") return toolText(verdict.reason, true);
    if (verdict.kind === "existing") {
      const p = listed.find((p) => p.id === verdict.id)!;
      return json({
        id: p.id,
        name: p.name,
        folder: p.path,
        git: !p.plain,
        alreadyAdded: true,
      });
    }
    const repository = await projects.repositoryRoot(real);
    if (repository && repository !== real) {
      const outer = folderVerdict(repository, { ...rules, projects: listed });
      return toolText(
        outer.kind === "ok"
          ? `That's inside the Git repository at ${repository}; add that folder instead.`
          : `That's inside the Git repository at ${repository}, which can't be added: ${outer.kind === "refused" ? outer.reason : "it's a project already."}`,
        true,
      );
    }
    const linked = resolve(folder) !== real;
    const approved = await this.approve(
      lead,
      `Add “${basename(real)}” to Relay as a project?`,
      [
        real,
        `${repository ? "Git repository." : "Plain folder, no Git."} Agents in its threads can read and change everything in this folder.`,
        ...(linked
          ? [`(Asked for ${JSON.stringify(folder)}, a link to this folder.)`]
          : []),
      ].join("\n"),
      signal,
      true,
    );
    if (!approved)
      return toolText(
        "The user didn't add this folder. Ask them what they want instead.",
        true,
      );
    // The card can wait for minutes; meanwhile the agent may swap the folder
    // for a link to home, or the user may add it or a folder around it.
    const now = await realFolder(real, rules.platform);
    if (!("real" in now) || now.real !== real)
      return toolText(
        `${real} changed while the user was asked; nothing was added.`,
        true,
      );
    const recheck = folderVerdict(real, {
      ...rules,
      projects: await projects.list(),
    });
    if (recheck.kind === "refused") return toolText(recheck.reason, true);
    const project = await projects.add(real);
    return json({
      id: project.id,
      name: project.name,
      folder: project.path,
      git: !project.plain,
    });
  }

  /** Any listed thread, as list() shows it. */
  private async thread(id: string) {
    const chat = await this.chats.get(id).catch(() => {
      throw new Error("There's no such thread; see find_threads.");
    });
    const summary = this.chats
      .list(chat.projectId)
      .find((c) => c.id === id && !c.archivedAt);
    if (!summary) throw new Error("There's no such thread; see find_threads.");
    return { summary, chat };
  }

  /**
   * A thread the lead may drive. `mine`: it started it. `sends`: it may
   * message it as freely as one in its own project.
   */
  private async target(lead: ProjectChat, id: string) {
    if (id === lead.id)
      throw new Error("That's this thread; these tools drive other threads.");
    const mine = this.children(lead).some((c) => c.id === id);
    const found = await this.thread(id);
    const elsewhere =
      found.chat.projectId !== lead.projectId
        ? ((await this.realProjects()).find(
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
    await this.chats.cancel(id);
    return toolText("Stopped.");
  }

  private async settle(lead: ProjectChat, id: string, signal: AbortSignal) {
    const { summary, chat, mine, where } = await this.target(lead, id);
    const status = startedStatus(summary, chat);
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
        ? (await this.realProjects()).find((p) => p.id === project)
        : undefined;
    if (project && project !== lead.projectId && !elsewhere)
      return toolText("There's no such project; see list_projects.", true);
    // The lead's uncommitted work belongs to another repository.
    if (elsewhere && threads.some((t) => t.uncommitted === true))
      return toolText(
        "`uncommitted` only works in your own project; leave it out for another one.",
        true,
      );
    const working = this.children(lead).filter((c) => c.running).length;
    if (!detached && working + threads.length > STARTED_LIMIT)
      return toolText(
        `${working} of your threads are working; at most ${STARTED_LIMIT} may at once. Wait for some to finish first.`,
        true,
      );
    const { last, agent: caller, from } = this.leadSide(lead);
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
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return json(started);
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
              w.kind,
              {
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

  private async list(lead: ProjectChat, ids?: string[]) {
    const listed = ids
      ? await Promise.all(
          ids.map(async (id) => (await this.thread(id)).summary),
        )
      : this.children(lead);
    const names = listed.some((c) => c.projectId !== lead.projectId)
      ? new Map((await this.realProjects()).map((p) => [p.id, p.name]))
      : undefined;
    return Promise.all(
      listed.map(async (summary) => {
        const chat = await this.chats.get(summary.id);
        const last = answers(chat).at(-1);
        const asks = [
          ...(chat.requests?.map((r) => r.title) ?? []),
          ...chat.messages.flatMap((m) =>
            (m.questions ?? []).flatMap((group) =>
              !group.answers && !group.dismissed
                ? group.questions.map((q) => q.question)
                : [],
            ),
          ),
        ];
        return {
          id: summary.id,
          title: summary.title,
          status: startedStatus(summary, chat),
          ...(summary.projectId !== lead.projectId
            ? { project: names?.get(summary.projectId) ?? summary.projectId }
            : {}),
          ...(asks.length ? { asks } : {}),
          ...(summary.branch ? { branch: summary.branch } : {}),
          ...(chat.worktree?.path ? { folder: chat.worktree.path } : {}),
          ...(last?.body ? { latest: tail(last.body, 600) } : {}),
          ...(last?.error ? { error: last.error } : {}),
        };
      }),
    );
  }

  private async find(
    lead: ProjectChat,
    { project, query, limit = 20 }: RelayToolArgs<"find_threads">,
  ) {
    const projects = (await this.reachProjects().list()).filter(
      (p) => !project || p.id === project,
    );
    if (!projects.length)
      return toolText("There's no such project; see list_projects.", true);
    const words = query?.toLowerCase().split(/\s+/) ?? [];
    const found = projects
      .flatMap((p) => this.chats.list(p.id).map((summary) => ({ summary, p })))
      .filter(
        ({ summary: c }) =>
          !c.archivedAt &&
          !c.empty &&
          words.every((w) =>
            `${c.title} ${c.branch ?? ""}`.toLowerCase().includes(w),
          ),
      )
      .sort((a, b) => b.summary.updated - a.summary.updated)
      .slice(0, limit);
    return json(
      found.map(({ summary: c, p }) => ({
        id: c.id,
        title: c.title,
        project: p.scratch ? "Scratchpad" : p.name,
        ...(c.id === lead.id ? { you: true } : {}),
        status: inputBlocksThread(c)
          ? "needs-input"
          : c.running
            ? "working"
            : c.settledAt || c.autoSettled
              ? "settled"
              : "idle",
        updated: localTime(c.updated),
        ...(c.contextAgent || c.provider
          ? { agent: agentName(c.contextAgent ?? c.provider!) }
          : {}),
        ...(c.branch ? { branch: c.branch } : {}),
        ...(c.startedBy ? { startedBy: c.startedBy.chatId } : {}),
      })),
    );
  }

  private async read(
    _lead: ProjectChat,
    { id, after }: RelayToolArgs<"read_thread">,
  ) {
    const chat = await this.chats.get(id).catch(() => {
      throw new Error("There's no such thread; see find_threads.");
    });
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
    // The notes come first: what the user keeps at hand there.
    const notes = after ? [] : (chat.notes ?? []).map(noteForAgent);
    return json({
      ...(notes.length ? { notes } : {}),
      messages,
      next: main.at(-1)?.id ?? after ?? null,
    });
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
