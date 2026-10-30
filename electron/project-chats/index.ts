import { dirname, join } from "node:path";
import type { AccountProvider } from "../../shared/agent-accounts";
import type { AgentProvider } from "../../shared/agents";
import type { AgentRequest, AgentResponse } from "../../shared/agent-modes";
import type { DeepReviewStart, ResumeReview } from "../../shared/deep-review";
import type { FindingStatus } from "../../shared/findings";
import {
  mainConversation,
  replyRoots,
  threadOrder,
  type ChatMessage,
  type ChatScope,
  type ChatTriage,
  type ChatWorkspace,
  type KnownMessages,
  type LinkedFolder,
  type ProjectChat,
  type ProjectChatPatch,
  type ProjectChatSend,
  type ResumeSettings,
} from "../../shared/projects";
import { latestContext } from "../../shared/context-usage";
import type { HtmlRender } from "../../shared/html-render";
import type { TurnPreview } from "../../shared/preview";
import type { TerminalSessionPick } from "../../shared/terminal-sessions";
import type { LineQuestion } from "../../shared/questions";
import { everyAgentRuntime } from "../agents";
import { accountHomes } from "../agents/accounts";
import type { PullInfo } from "../deep-review";
import type { PullRef } from "../../shared/types";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import { TerminalSessions } from "../terminal-sessions";
import { openTurnLedger, TurnNews } from "../turns";
import type {
  NewsCursor,
  NewsItem,
  ThreadNews,
} from "../../shared/thread-news";
import { working, type Turn } from "../../shared/turns";
import { ActiveTurns } from "./active";
import { SideQuestions } from "./asides";
import { threadControl } from "./control";
import type { ChatCore } from "./core";
import { Councils } from "./councils";
import { ComputerHandoff } from "./handoff";
import { LiveHandoff } from "./handoff-live";
import { SetupMirror } from "./handoff-setup";
import { ChatQueue } from "./queue";
import { LimitResumes } from "./limit-resume";
import { IdleCompactions } from "./idle-compact";
import { ChatSchedule } from "./schedule";
import { reloadSessions } from "./session-reload";
import { ProviderSessions } from "./sessions";
import { ChatStorage } from "./storage";
import { asksYou, chatSummary } from "./chat-summaries";
import { ThreadTitles } from "./titles";
import { TurnFiles } from "./turn-files";
import { TerminalContinue } from "./terminal-continue";
import { ThreadCreate, type NewThread } from "./thread-create";
import { ThreadList } from "./thread-list";
import { ThreadNotes } from "./notes";
import { ThreadTriage } from "./thread-triage";
import { TurnRunner } from "./turn-run";
import { TurnSends } from "./turn-flows/send";
import { TurnCompactions } from "./turn-flows/compaction";
import { TurnEndings } from "./turn-flows/end";
import { TurnHandoffs } from "./turn-flows/handoff-notes";
import { TurnRecovery } from "./turn-flows/recovery";
import { ThreadWorktrees } from "./worktrees";
import { WorktreeCleanup } from "./worktree-cleanup";
import type { WatchClose } from "../../shared/watch";
import { WatchReviews } from "./watch-review";
import { WatchSpendLog } from "./watch-spend";
import { PredictionLog } from "./prediction-log";
import { AsyncQuestions } from "./async-questions";
import { ProjectImports } from "./project-import";
import { defaultPrefs, type AppPrefs } from "../settings";
import { ImportOffers } from "./import-offers";
import { ProjectMoves } from "./project-move";
import * as marks from "./answer-marks";
import { ChatReads } from "./chat-reads";
import * as running from "./running-answer";
import { SendRouting } from "./send-routing";
import * as spend from "./side-spend";

export { chatStatus, type ChatStatus } from "./status";

/** How often the ledger looks for turns that ended without saying. */
const LEAK_CHECK_MS = 30_000;

/**
 * A project's chat threads, as the rest of the app sees them. Each part
 * lives in `project-chats/`; this wires them together and keeps the one
 * place every caller goes through.
 */
export class ProjectChats {
  private storage: ChatStorage;
  private sessions: ProviderSessions;
  private active: ActiveTurns;
  private schedule: ChatSchedule;
  private limits: LimitResumes;
  private idle: IdleCompactions;
  private titles: ThreadTitles;
  readonly worktrees: ThreadWorktrees;
  private cleanup: WorktreeCleanup;
  readonly files: TurnFiles;
  readonly handoffs: ComputerHandoff;
  readonly liveHandoff: LiveHandoff;
  readonly setupMirror: SetupMirror;
  private runner: TurnRunner;
  private asides: SideQuestions;
  private queue: ChatQueue;
  private turns: TurnSends;
  private recovery: TurnRecovery;
  private compactions: TurnCompactions;
  private control = threadControl();
  private questions: AsyncQuestions;
  private reads: ChatReads;
  private sending: SendRouting;
  private disposing = false;
  private leakCheck: ReturnType<typeof setInterval>;
  private news: TurnNews;
  private councils: Councils;
  private watchNotes: WatchReviews;
  private core: ChatCore;
  private threads: ThreadList;
  readonly triaging: ThreadTriage;
  /** What the user keeps at hand in each thread. */
  readonly notes: ThreadNotes;
  private creating: ThreadCreate;
  private terminal: TerminalContinue;
  readonly imports: ProjectImports;
  /** Importing another app's history with an agent. */
  readonly importOffers: ImportOffers;
  /** Threads moving to another project at their agent's asking. */
  readonly projectMoves: ProjectMoves;

  constructor(
    private store: Store,
    projects: Projects,
    dir: string,
    private emit: (event: {
      chatId: string;
      message: ChatMessage;
      title?: string;
    }) => void,
    evidence?: (chat: ProjectChat, selection: LineQuestion) => Promise<unknown>,
    prefs: () => AppPrefs = () => defaultPrefs,
  ) {
    this.storage = new ChatStorage(store, dir, (chatId, branch) =>
      this.sessions.isResuming(chatId, branch),
    );
    this.sessions = new ProviderSessions(
      dir,
      (id) => this.storage.chatChanged(id),
      (id) => this.active.has(id) || this.active.hasSide(id),
    );
    this.active = new ActiveTurns(
      (id) => this.storage.chatChanged(id),
      // Beside the threads' folder, which holds nothing but threads.
      openTurnLedger(join(dirname(dir), "relay.db")),
    );
    this.leakCheck = setInterval(() => {
      for (const id of this.active.sweep()) this.storage.chatChanged(id);
    }, LEAK_CHECK_MS);
    this.leakCheck.unref();
    const core: ChatCore = {
      store,
      prefs,
      projects,
      storage: this.storage,
      sessions: this.sessions,
      active: this.active,
      control: this.control,
      emit: (event) => this.emit(event),
      closing: () => this.disposing,
      watchSpend: new WatchSpendLog(join(dirname(dir), "watch-spend.jsonl")),
      predictions: new PredictionLog(join(dirname(dir), "predictions.jsonl")),
      away: new Map(),
    };
    this.core = core;
    this.questions = new AsyncQuestions(core, (id, input) =>
      this.sending.held(id, input),
    );
    this.watchNotes = new WatchReviews(
      store,
      this.storage,
      join(dirname(dir), "watch-verdicts.jsonl"),
    );
    // Hosts look methods up at call time, not with .bind(this): tests
    // vi.spyOn(chats, "send"), and the turn flows are only built last.
    const worktrees = join(dirname(dir), "worktrees");
    this.councils = new Councils(
      core,
      {
        send: (id, input) => this.send(id, input),
        lead: (chat, input, prompt, answer) =>
          this.turns.lead(chat, input, prompt, answer),
      },
      worktrees,
    );
    this.schedule = new ChatSchedule(core, {
      send: (id, input, fromRelay) => this.send(id, input, fromRelay),
    });
    this.limits = new LimitResumes(core, {
      resume: (id) => this.turns.resumeHeld(id),
    });
    this.idle = new IdleCompactions(core, {
      summary: (chat) => {
        try {
          return this.threads
            .list(chat.projectId)
            .find((c) => c.id === chat.id);
        } catch {
          return undefined;
        }
      },
      busy: (chat) => this.councils.busy(chat),
      compact: (id) => this.compactions.now(id, undefined, undefined, "idle"),
    });
    this.titles = new ThreadTitles(core);
    this.worktrees = new ThreadWorktrees(core, worktrees, this.councils);
    this.cleanup = new WorktreeCleanup(
      core,
      this.worktrees,
      this.councils,
      () => this.threads.cleanupCandidates(),
    );
    this.files = new TurnFiles(core, this.worktrees);
    this.threads = new ThreadList(core);
    this.reads = new ChatReads(core, this.worktrees, this.threads);
    // As the thread's list entry reads it; one handed away waits there, which tells it.
    const waits = (id: string, chat: ProjectChat) =>
      this.active.ledger
        .inThread(id)
        .some((t) => t.blocked && working(t.phase)) ||
      (asksYou(chat.messages) && !chat.sentTo);
    this.news = new TurnNews(this.active.ledger, {
      summary: (id) => this.summaryOf(id),
      answer: (chatId, answerId) =>
        this.storage.cached(chatId)?.messages.find((m) => m.id === answerId),
      queued: (chatId) => {
        const chat = this.storage.cached(chatId);
        return !!chat?.queue?.length && !chat.queuePaused;
      },
      thread: (id, chat = this.storage.cached(id)) =>
        chat && { ...chatSummary(chat), waiting: waits(id, chat) },
      waiting: (id, chat = this.storage.cached(id)) => chat && waits(id, chat),
    });
    this.storage.onSaved((chat) => this.news.saved(chat));
    this.triaging = new ThreadTriage(core, this.worktrees, this.councils);
    this.creating = new ThreadCreate(core, this.worktrees);
    this.notes = new ThreadNotes(core);
    const terminalSessions = new TerminalSessions(async () => accountHomes());
    this.terminal = new TerminalContinue(
      core,
      this.worktrees,
      terminalSessions,
    );
    this.imports = new ProjectImports(core, terminalSessions, this.terminal);
    this.importOffers = new ImportOffers(core, this.imports);
    this.projectMoves = new ProjectMoves(core);
    this.handoffs = new ComputerHandoff(core, this.schedule, this.councils, {
      send: (id, input) => this.send(id, input),
      note: (chat, root, provider, active, computer) =>
        handoffs.note(
          chat,
          root,
          provider,
          provider,
          undefined,
          active,
          computer,
        ),
    });
    this.liveHandoff = new LiveHandoff(core, (projectId) =>
      this.threads.list(projectId),
    );
    this.setupMirror = new SetupMirror(core);
    this.runner = new TurnRunner(core, this.titles, {
      unprompted: (chat, root, provider, parentId) =>
        this.recovery.unprompted(chat, root, provider, parentId),
      limited: (id, messageId, limit) =>
        void this.limits
          .stopped(id, messageId, limit)
          .catch((e) => console.warn("Could not plan the resume:", e)),
      env: (chat) => this.worktrees.setup.env(chat),
      keepShown: (chat, message) => this.files.keepShown(chat, message),
    });
    const handoffs = new TurnHandoffs(core, this.runner);
    this.asides = new SideQuestions(core, this.worktrees, this.runner);
    this.queue = new ChatQueue(core, this.schedule, this.councils, {
      sendNow: (id, input) => this.turns.sendNow(id, input),
      compactNow: (id, parentId, instructions) =>
        this.compactions.now(id, parentId, instructions),
    });
    const ends = new TurnEndings(
      core,
      this.councils,
      this.queue,
      (id) => {
        void this.idle.arm(id);
        return this.triaging.ended(id);
      },
      (id) => this.turns.resumeMissedHeld(id),
    );
    this.turns = new TurnSends(
      core,
      this.worktrees,
      this.runner,
      this.titles,
      this.councils,
      handoffs,
      ends,
      evidence,
    );
    this.recovery = new TurnRecovery(
      core,
      this.worktrees,
      this.runner,
      this.councils,
      ends,
    );
    this.compactions = new TurnCompactions(
      core,
      this.worktrees,
      this.runner,
      this.councils,
      this.queue,
      ends,
    );
    this.sending = new SendRouting(core, {
      turns: this.turns,
      worktrees: this.worktrees,
      schedule: this.schedule,
      asides: this.asides,
      queue: this.queue,
      compactions: this.compactions,
      councils: this.councils,
    });
  }

  /**
   * Hears which project's thread list may read differently: a summary saved,
   * a turn claimed or released, a request asked or answered, or Claude's
   * background work moving. Returns the way to stop listening.
   */
  onSummaries(listener: (projectId: string) => void) {
    return this.storage.onSummaries(listener);
  }

  /**
   * Hears each thread written to disk, as a turn ends or its files are
   * rolled back. The thread is Relay's own copy: read it, never change it.
   */
  onSaved(listener: (chat: ProjectChat) => void) {
    return this.storage.onSaved(listener);
  }

  /** Says a project's list may read differently; every project's, given none. */
  summariesChanged(projectId?: string) {
    this.storage.summariesChanged(projectId);
  }

  autoSettleDays() {
    return this.threads.autoSettleDays();
  }

  worktreeCleanupDays() {
    return this.threads.worktreeCleanupDays();
  }

  list(projectId: string) {
    return this.threads.list(projectId);
  }

  private summaryOf(id: string) {
    return this.threads.byIds([id]).get(id);
  }

  /** What threads are news of, decided once for every window, menubar and phone. */
  onNews(listener: (item: NewsItem) => void) {
    return this.news.onNews(listener);
  }

  /** A thread's answers are over, nothing queued after the last; see TurnNews.onEnd. */
  onAnswersEnd(listener: (turn: Turn) => void) {
    return this.news.onEnd(listener);
  }

  /** The news after `cursor`, for a client that was away. */
  newsSince(cursor?: NewsCursor) {
    return this.news.since(cursor);
  }

  /**
   * Removes the worktrees of threads settled long enough, where nothing is
   * at work and nothing would be lost; their branches stay.
   */
  cleanUpWorktrees() {
    return Promise.all([
      this.cleanup.sweep(),
      this.councils.sweepCheckouts((id) => this.reviewDone(id)),
    ]).catch((e) => console.warn("Could not clean up worktrees:", e));
  }

  /** A review thread that no longer needs its worktree: deleted, archived or settled, with nothing at work. */
  private reviewDone(id: string) {
    const chats = this.store.get().chats ?? [];
    const chat = chats.find((c) => c.id === id);
    if (!chat) return true;
    if (
      [chat, ...chats.filter((c) => c.reviewer?.parent === id)].some(
        (c) => this.active.has(c.id) || this.active.hasSide(c.id),
      )
    )
      return false;
    if (chat.archivedAt) return true;
    try {
      return !!this.threads.list(chat.projectId).find((c) => c.id === id)
        ?.settledAt;
    } catch {
      return false;
    }
  }

  /** The subagents Claude started in a thread, its side conversations' too. */
  agents(id: string) {
    return this.sessions.subagents(id);
  }

  async contextReport(id: string, parentId?: string) {
    const { messages } = await this.storage.load(id);
    const roots = parentId ? replyRoots(messages) : undefined;
    const shown = parentId
      ? messages.filter(
          (m) => m.id === parentId || roots!.get(m.id) === parentId,
        )
      : mainConversation(messages);
    const context = latestContext([...shown].sort(threadOrder));
    return context?.provider
      ? this.sessions.contextReport(
          id,
          context.provider,
          context.usage,
          parentId,
        )
      : null;
  }

  agentRun(id: string, agentId: string) {
    return this.sessions.subagentRun(id, agentId);
  }

  stopAgent(id: string, agentId: string) {
    return this.sessions.stopSubagent(id, agentId);
  }

  /** Threads whose running answer comes from `provider`. */
  runningOn(provider: AgentProvider) {
    return this.active.ids().flatMap((id) => {
      const chat = this.storage.cached(id);
      return chat?.messages.some(
        (m) => m.status === "streaming" && m.provider === provider,
      )
        ? [{ id, title: chat.title }]
        : [];
    });
  }

  /**
   * Stops those threads as Stop would, and waits until their agents let go.
   * Returns their ids, for `resumeStopped` once the agent is back.
   */
  async stopRunningOn(provider: AgentProvider) {
    const ids = this.runningOn(provider).map((c) => c.id);
    await Promise.all(ids.map((id) => this.cancel(id)));
    await Promise.all(ids.map((id) => this.active.finished(id)));
    return ids;
  }

  /** Carries on answers Relay stopped itself, as Resume answer would, queue and all. */
  async resumeStopped(ids: string[]) {
    for (const id of ids) {
      const chat = this.storage.cached(id);
      if (chat?.queuePaused) {
        delete chat.queuePaused;
        await this.storage.save(chat);
      }
      await this.resume(id).catch((e) =>
        console.warn("Could not resume the thread after a restart:", e),
      );
    }
  }

  /** Background commands and agents still running, across every thread. */
  runningTasks() {
    return this.sessions
      .pending()
      .map((p) => p.item)
      .filter((item) => item.kind === "task");
  }

  /**
   * Stops a background task Claude left running, or cancels a wake-up it
   * scheduled.
   */
  stopPending(id: string, pendingId: string) {
    return this.schedule.stopPending(id, pendingId);
  }

  /**
   * Arms the wake-ups kept when Relay last closed, scheduled messages,
   * resumes after a limit and compactions of idle conversations.
   */
  armWakeups() {
    this.schedule.armAll();
    this.limits.armAll();
    this.idle.armAll();
  }

  /** Automatic idle compaction was turned on: plans it for threads idle since. */
  armIdleCompactions() {
    if (!this.disposing) this.idle.armAll();
  }

  /** Turns off carrying on the answer a usage limit stopped, or back on. */
  setLimitResume(id: string, on: boolean) {
    return this.limits.set(id, on);
  }

  resolveStoppedWork(id: string, action: "resume" | "dismiss") {
    return this.schedule.resolveStopped(id, action);
  }

  /** Settle/snooze/archive only change sidebar visibility, never the agent. */
  triage(id: string, triage: ChatTriage) {
    return this.triaging.triage(id, triage);
  }

  markSeen(id: string, seenAt: number) {
    return this.triaging.markSeen(id, seenAt);
  }

  settleItself(id: string) {
    return this.triaging.settleItself(id);
  }

  detach(id: string) {
    return this.triaging.detach(id);
  }

  startedThreads(leadId: string) {
    return this.threads.started(leadId);
  }

  allowDriving(id: string, on: boolean) {
    return this.triaging.allowDriving(id, on);
  }

  setAccount(id: string, provider: AccountProvider, account: string) {
    return this.triaging.setAccount(id, provider, account);
  }

  setLinks(id: string, links: LinkedFolder[]) {
    return this.core.control(id, () => this.triaging.setLinks(id, links));
  }

  promoteLink(id: string, path: string) {
    return this.core.control(id, () => this.triaging.promoteLink(id, path));
  }

  rename(id: string, candidate: string) {
    return this.titles.rename(id, candidate);
  }

  create(
    projectId: string,
    scope: ChatScope,
    workspace?: ChatWorkspace,
    made?: NewThread,
  ) {
    return this.creating.create(projectId, scope, workspace, made);
  }

  /**
   * A new thread holding the conversation up to an answer, side conversation
   * included when the answer is in one. The original keeps its turns' changes
   * to review and roll back; the fork starts without them.
   */
  fork(id: string, messageId?: string) {
    return this.creating.fork(id, messageId);
  }

  terminalSessions(projectId: string) {
    return this.terminal.list(projectId);
  }

  continueTerminalSession(
    projectId: string,
    pick: TerminalSessionPick,
    workspace?: ChatWorkspace,
    branch?: string,
    links?: LinkedFolder[],
  ) {
    return this.terminal.continue(projectId, pick, workspace, branch, links);
  }

  /** News of a thread live on another computer, as that computer told it. */
  handoffNews(
    id: string,
    projectId: string,
    news: Omit<ThreadNews, "chatId"> & Pick<NewsItem, "byAgent">,
  ) {
    this.news.retell({ ...news, chatId: id }, projectId);
  }

  /**
   * What waits in the thread now, which isn't saved with it; for a live
   * handoff, what its computer last said, over what's saved here.
   */
  /**
   * A round in the folder the thread works in now. `pull` asks the forge
   * about a pull request; `duringTurn`: the thread's agent asked for it
   * mid-answer, through the deep_review tool.
   */
  startDeepReview(
    id: string,
    config: DeepReviewStart,
    options: {
      pull?: (ref: PullRef) => Promise<PullInfo>;
      duringTurn?: boolean;
    } = {},
  ) {
    return this.councils.startReview(id, config, {
      ...options,
      folder: (chat) => this.worktrees.root(chat),
    });
  }

  resumeDeepReview(id: string, only?: ResumeReview) {
    return this.councils.resumeReview(id, only);
  }

  setFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ) {
    return marks.setFinding(this.core, id, findingId, status);
  }

  /** The same chat object a running turn writes into, so its next publish keeps the note closed. */
  closeWatchNote(
    id: string,
    messageId: string,
    noteId: string,
    how: WatchClose,
    read = false,
  ) {
    return marks.closeWatchNote(this.core, id, messageId, noteId, how, read);
  }

  /** What side checks spent in the last `days`, by thread. */
  watchSpend(days: number) {
    return spend.watchSpend(this.core, days);
  }

  /** The composer's guesses of the last `days`: what they cost and how often they were sent. */
  predictionSpend(days: number) {
    return spend.predictionSpend(this.core, days);
  }

  /** The composer showed a guess, so what's sent next counts for or against it; Escape hides it for good. */
  seePrediction(id: string, messageId: string, how: "shown" | "dismissed") {
    return marks.seePrediction(this.core, id, messageId, how);
  }

  /** The notes of the last `days` with what was done with each. */
  watchReview(days: number) {
    return this.watchNotes.review(days);
  }

  judgeWatchNotes(days: number) {
    return this.watchNotes.judge(days);
  }

  get(id: string): Promise<ProjectChat> {
    return this.reads.get(id);
  }

  /** Progress reads use the cached thread, without cloning its history or refreshing Git. */
  status(id: string) {
    return this.reads.status(id);
  }

  /** One live summary list per project, even when a tool waits on many threads. */
  statuses(selection: { ids: readonly string[] } | { startedBy: string }) {
    return this.reads.statuses(selection);
  }

  /** Like get, but messages the caller already holds at the same version come back as their ids. */
  changes(id: string, known: KnownMessages): Promise<ProjectChatPatch> {
    return this.reads.changes(id, known);
  }

  cost(id: string) {
    return this.reads.cost(id);
  }

  /** The screenshots of a queued or scheduled message; it is gone once it has been sent. */
  queuedImages(chatId: string, messageId: string) {
    return this.reads.queuedImages(chatId, messageId);
  }

  /**
   * Gives worktree thread `id` its worktree now, holding a copy of the files
   * thread `from` works on, uncommitted edits included; see electron/started-threads.
   */
  async worktreeFrom(id: string, from: string, prompt: string) {
    const chat = await this.storage.load(id);
    if (!chat.worktree || chat.worktree.path)
      throw new Error("That thread has no worktree to make.");
    const source = await this.worktrees.root(await this.storage.load(from));
    return this.worktrees.copyFrom(chat, source, prompt);
  }

  hasActiveProject(projectId: string) {
    return this.worktrees.checkoutBusy(projectId);
  }

  /** `fromRelay` marks Relay's own messages, which leave a stopped queue stopped. */
  send(id: string, input: ProjectChatSend, fromRelay = false) {
    return this.sending.send(id, input, fromRelay);
  }

  /** Hands a thread to a paired computer; Handoffs sets it, as it can't be made before this. */
  startsThereWith(start: (id: string, computerId: string) => Promise<void>) {
    this.sending.starter = start;
  }

  /**
   * A new thread's first message, kept with its worktree made but not
   * answered here: another computer starts the thread with it.
   */
  firstMessageOnly(id: string, input: ProjectChatSend) {
    return this.sending.firstMessageOnly(id, input);
  }

  /** The first message a thread kept for another computer to answer (firstMessageOnly), answered here after all. */
  answerHere(id: string) {
    return this.sending.answerHere(id);
  }

  /** Your own message, from the composer or a phone: it unsettles a thread settled while it ran. */
  async sendYours(id: string, input: ProjectChatSend) {
    await this.triaging.sent(id);
    return this.send(id, input);
  }

  queueAction(
    id: string,
    action: "remove" | "steer" | "move",
    messageId: string,
    index = 0,
  ) {
    return this.queue.action(id, action, messageId, index);
  }

  resume(id: string, settings?: ResumeSettings) {
    return this.turns.resume(id, settings);
  }

  /** Compacts the provider session behind the newest answer on this branch. */
  compact(id: string, parentId?: string, instructions?: string) {
    return this.compactions.request(id, parentId, instructions);
  }

  /** Restarts the thread's agent on its conversation, to load what changed on disk since. */
  reloadSessions(id: string) {
    return reloadSessions(this.core, id);
  }

  /**
   * Takes back the agent sessions that kept running while Relay restarted.
   * A turn one was in carries on in the answer it was writing.
   */
  async reattach() {
    await this.recovery.reattach();
    // Whatever the agent host kept runs in a turn of its own by now.
    this.active.ledger.recover();
    await this.triaging.restarted();
  }

  /** Puts right any thread summary a crash left behind its thread. */
  async reconcileSummaries() {
    await this.storage.reconcile(this.store.savedAtLoad);
  }

  /** Threads with an answer running now; reviewers count under their parent. */
  working() {
    const chats = new Map((this.store.get().chats ?? []).map((c) => [c.id, c]));
    return new Set(
      this.active.working().map((id) => {
        const chat = chats.get(id);
        return chat?.reviewer?.parent ?? id;
      }),
    ).size;
  }

  /** Asked for by the window showing the thread, every few seconds while it does. */
  worktreeStatus(id: string) {
    this.cleanup.shown(id);
    return this.worktrees.status(id);
  }

  returnedCopy(projectId: string, branch: string, tip: string) {
    return this.worktrees.returnedCopy(projectId, branch, tip);
  }

  rerunWorktreeSetup(id: string, messageId: string) {
    return this.worktrees.setup.rerun(id, messageId);
  }

  /** What a terminal in the thread's worktree is told, like its agent; nothing in the checkout. */
  async worktreeEnv(id: string) {
    return this.worktrees.setup.env(await this.storage.load(id));
  }

  /** The worktrees agents made from project-folder threads. */
  get agentWorkspaces() {
    return this.worktrees.agents;
  }

  rewindTurn(
    chatId: string,
    messageId: string,
    paths: string[] | null,
    mode: "revert" | "redo",
    force: boolean,
  ) {
    return this.files.rewind(chatId, messageId, paths, mode, force);
  }

  /** Retries titles for threads whose first title run failed earlier. */
  ensureTitle(id: string) {
    this.titles.ensure(id);
  }

  /**
   * Names the thread again from the whole conversation, on demand, even over
   * a name you typed.
   */
  regenerateTitle(id: string) {
    return this.titles.regenerate(id);
  }

  /** Asks the user in the thread's running turn, as its agent would; see electron/started-threads. */
  askInTurn(
    id: string,
    request: Omit<AgentRequest, "id">,
    signal?: AbortSignal,
  ) {
    return running.askInTurn(this.core, id, request, signal);
  }

  /** Adds a page the thread's agent showed to the answer it is writing; see electron/html-renders. */
  showRender(id: string, render: HtmlRender, pages: string[]) {
    return running.showRender(this.core, id, render, pages);
  }

  /** Leaves the thread's preview under the answer its agent is writing; a later open replaces it. */
  showPreview(
    id: string,
    preview: Omit<TurnPreview, "shot">,
    jpeg: Buffer | null,
  ) {
    return running.showPreview(this.core, id, preview, jpeg);
  }

  /** Leaves a page the thread's agent asks with (ask_html) in the answer it is writing, as an open question. */
  askWithPage(id: string, page: HtmlRender, html: string, ask: string) {
    return running.askWithPage(this.core, id, page, html, ask);
  }

  /** A page an answer showed, as its agent wrote it. */
  renderPage(id: string, renderId: string, page: number) {
    return this.storage.renders.read(id, renderId, page);
  }

  respond(id: string, requestId: string, response: AgentResponse) {
    const active = this.active.get(id);
    if (!active) throw new Error("This turn is no longer running.");
    active.requests.respond(requestId, response);
    if (response.kind === "approval" && response.decision === "cancel")
      return this.cancel(id);
  }

  answerQuestion(
    id: string,
    messageId: string,
    itemId: string,
    response: AgentResponse,
  ) {
    return this.questions.answer(id, messageId, itemId, response);
  }

  setQuestionDismissed(
    id: string,
    messageId: string,
    itemId: string,
    dismissed: boolean,
  ) {
    return this.questions.setDismissed(id, messageId, itemId, dismissed);
  }

  /**
   * `steers`: stopped to get a waiting steer read now, so one the agent
   * hasn't picked up goes out as the next turn and the queue carries on
   * after it. With none waiting, it's a plain stop.
   */
  async cancel(id: string, { steers = false } = {}) {
    const chat = this.storage.cached(id);
    const running = this.active.has(id);
    const unread = steers && running && !!chat?.messages.some((m) => m.unread);
    // A steer the agent can't take waits at the front of the queue.
    const queued =
      steers && running && chat?.queue?.[0]?.input.delivery === "steer";
    // Only a stopped turn holds the queue back; nothing queues behind a side answer.
    if (chat && !unread && !queued && (running || this.councils.busy(chat)))
      chat.queuePaused = true;
    const active = this.active.get(id);
    if (active && (unread || queued)) active.keepsQueue = true;
    this.active.stop(id);
    if (unread)
      void this.turns
        .resumeMissed(id)
        .catch((e) => console.warn("Could not send the missed steer:", e));
    if (chat) await this.councils.stop(chat);
    return chat ? this.storage.save(chat) : undefined;
  }

  /**
   * Relay is closing. `detach`: it's restarting, and the agent host keeps
   * the agents' sessions going; running answers are saved as they stand and
   * picked back up by `reattach`.
   */
  async prepareToQuit({ detach = false, save = true } = {}) {
    this.disposing = true;
    this.schedule.stop();
    this.limits.stop();
    this.idle.stop();
    try {
      await this.worktrees.setup.stop();
      if (!detach) {
        if (save) await this.schedule.keepPending();
        for (const a of this.active.all()) a.abort.abort();
      }
      for (const a of this.active.allSides()) a.abort.abort();
      this.titles.abort();
      // What was stopped writes its last state before the store goes to disk.
      await Promise.allSettled([
        ...this.active.allSides().map((a) => a.job),
        ...this.titles.running(),
      ]);
      await Promise.allSettled(this.titles.writing());
      if (!detach) {
        await Promise.allSettled(this.active.all().map((a) => a.job));
        await Promise.allSettled(this.control.pending());
        // A send in validation can attach a job while shutdown waits.
        await Promise.allSettled(this.turns.starting());
        await Promise.allSettled(this.active.all().map((a) => a.job));
        await Promise.allSettled(this.councils.stepping());
      }
      if (save) {
        await this.storage.flush();
        await this.store.flush();
      }
    } catch (error) {
      await this.resumeAfterCancelledQuit();
      throw error;
    }
  }

  /** Nothing has detached yet: reopen sends and re-arm the paused timers. */
  async resumeAfterCancelledQuit() {
    if (!this.disposing) return;
    await this.schedule.rollbackPending();
    this.disposing = false;
    this.schedule.armAll();
    this.limits.armAll();
    this.idle.armAll();
  }

  /** Commit teardown only after preparation, or an explicit discard. */
  async dispose({ detach = false, save = true } = {}) {
    if (!this.disposing) await this.prepareToQuit({ detach, save });
    clearInterval(this.leakCheck);
    this.news.dispose();
    this.liveHandoff.dispose();
    this.setupMirror.dispose();
    this.sessions.stopListening();
    await this.sessions.keepAllSubagents();
    if (detach) {
      for (const runtime of everyAgentRuntime()) runtime.detach?.();
      this.active.ledger.dispose();
      return;
    }
    this.schedule.commitPending();
    await this.sessions.closeAll();
    await Promise.all(
      everyAgentRuntime().map((runtime) => runtime.dispose?.().catch(() => {})),
    );
    this.active.ledger.dispose();
  }
}
