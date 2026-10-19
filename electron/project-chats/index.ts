import { dirname, join } from "node:path";
import type { AccountProvider } from "../../shared/agent-accounts";
import type { AgentProvider } from "../../shared/agents";
import type { AgentRequest, AgentResponse } from "../../shared/agent-modes";
import type { DeepReviewStart, ResumeReview } from "../../shared/deep-review";
import type { FindingStatus } from "../../shared/findings";
import { setFindingStatus } from "../findings";
import type {
  ChatCameFrom,
  ChatSentTo,
  HandoffLive,
  HeldSend,
  ThreadSetup,
  HandoffThread,
} from "../../shared/handoff";
import type {
  ChatMessage,
  ChatScope,
  ChatTriage,
  ChatWorkspace,
  StartedBy,
  ChatWorktree,
  KnownMessages,
  LinkedFolder,
  ProjectChat,
  ProjectChatPatch,
  ProjectChatSend,
  ResumeSettings,
} from "../../shared/projects";
import { PAGE_QUESTION_ID, replyRoot } from "../../shared/projects";
import { parseGoalCommand } from "../../shared/goal";
import type { HtmlRender } from "../../shared/html-render";
import type { TurnPreview } from "../../shared/preview";
import type { TerminalSessionPick } from "../../shared/terminal-sessions";
import { agentAsked } from "../../shared/recipient";
import type { LineQuestion } from "../../shared/questions";
import { everyAgentRuntime } from "../agents";
import { accountHomes } from "../agents/accounts";
import type { PullInfo } from "../deep-review";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import { TerminalSessions } from "../terminal-sessions";
import { openTurnLedger, TurnNews } from "../turns";
import type {
  NewsCursor,
  NewsItem,
  ThreadNews,
} from "../../shared/thread-news";
import { working } from "../../shared/turns";
import { ActiveTurns } from "./active";
import { SideQuestions } from "./asides";
import { threadControl } from "./control";
import type { ChatCore } from "./core";
import { Councils } from "./councils";
import { assertHere, ComputerHandoff } from "./handoff";
import { LiveHandoff } from "./handoff-live";
import { SetupMirror } from "./handoff-setup";
import { ChatQueue } from "./queue";
import { LimitResumes } from "./limit-resume";
import { IdleCompactions } from "./idle-compact";
import { ChatSchedule } from "./schedule";
import { reloadSessions } from "./session-reload";
import { ProviderSessions } from "./sessions";
import { asksYou, ChatStorage, chatSummary } from "./storage";
import { ThreadTitles } from "./titles";
import { TurnFiles } from "./turn-files";
import { TerminalContinue } from "./terminal-continue";
import { ThreadCreate } from "./thread-create";
import { ThreadList } from "./thread-list";
import { ThreadNotes } from "./notes";
import { ThreadTriage } from "./thread-triage";
import { TurnRunner } from "./turn-run";
import { TurnSends } from "./turn-flows/send";
import { TurnCompactions } from "./turn-flows/compaction";
import { TurnEndings } from "./turn-flows/end";
import { TurnHandoffs } from "./turn-flows/handoff-notes";
import { TurnRecovery } from "./turn-flows/recovery";
import { ThreadWorktrees, type WorktreeRequest } from "./worktrees";
import { WorktreeCleanup } from "./worktree-cleanup";
import { WATCH_KNOWN_LIMIT, type WatchClose } from "../../shared/watch";
import { WatchReviews } from "./watch-review";
import { WatchSpendLog } from "./watch-spend";
import { AsyncQuestions } from "./async-questions";
import { threadCost } from "../../shared/thread-cost";

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
  private worktrees: ThreadWorktrees;
  private cleanup: WorktreeCleanup;
  private files: TurnFiles;
  private handoffs: ComputerHandoff;
  private liveHandoff: LiveHandoff;
  private setupMirror: SetupMirror;
  private runner: TurnRunner;
  private asides: SideQuestions;
  private queue: ChatQueue;
  private turns: TurnSends;
  private recovery: TurnRecovery;
  private compactions: TurnCompactions;
  private control = threadControl();
  private questions: AsyncQuestions;
  private disposing = false;
  private leakCheck: ReturnType<typeof setInterval>;
  private news: TurnNews;
  private councils: Councils;
  private watchNotes: WatchReviews;
  private core: ChatCore;
  private threads: ThreadList;
  private triaging: ThreadTriage;
  /** What the user keeps at hand in each thread. */
  readonly notes: ThreadNotes;
  private creating: ThreadCreate;
  private terminal: TerminalContinue;
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
      projects,
      storage: this.storage,
      sessions: this.sessions,
      active: this.active,
      control: this.control,
      emit: (event) => this.emit(event),
      closing: () => this.disposing,
      watchSpend: new WatchSpendLog(join(dirname(dir), "watch-spend.jsonl")),
      away: new Map(),
    };
    this.core = core;
    this.questions = new AsyncQuestions(core, (id, input) =>
      this.sendHeld(id, input),
    );
    this.watchNotes = new WatchReviews(
      store,
      this.storage,
      dir,
      join(dirname(dir), "watch-verdicts.jsonl"),
    );
    // Hosts look methods up at call time, not with .bind(this): tests
    // vi.spyOn(chats, "send"), and the turn flows are only built last.
    const worktrees = join(dirname(dir), "worktrees");
    this.councils = new Councils(
      core,
      {
        send: (id, input) => this.send(id, input),
        lead: (chat, input, prompt) => this.turns.lead(chat, input, prompt),
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
    this.creating = new ThreadCreate(core);
    this.notes = new ThreadNotes(core);
    this.terminal = new TerminalContinue(
      core,
      this.worktrees,
      new TerminalSessions(async () => accountHomes()),
    );
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
    const ends = new TurnEndings(core, this.councils, this.queue, (id) => {
      void this.idle.arm(id);
      return this.triaging.ended(id);
    });
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
    const projectId = this.store
      .get()
      .chats?.find((c) => c.id === id)?.projectId;
    return projectId
      ? this.threads.list(projectId).find((c) => c.id === id)
      : undefined;
  }
  /** What threads are news of, decided once for every window, menubar and phone. */
  onNews(listener: (item: NewsItem) => void) {
    return this.news.onNews(listener);
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
  contextReport(id: string, parentId?: string) {
    return this.sessions.contextReport(id, parentId);
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
    startedBy?: StartedBy,
    branch?: string,
    links?: LinkedFolder[],
  ) {
    return this.creating.create(
      projectId,
      scope,
      workspace,
      startedBy,
      branch,
      links,
    );
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
  markHandoff(id: string, sentTo: Omit<ChatSentTo, "state">) {
    return this.handoffs.mark(id, sentTo);
  }
  updateSentTo(
    id: string,
    handoffId: string,
    change: Partial<ChatSentTo> | null,
  ) {
    return this.handoffs.updateSentTo(id, handoffId, change);
  }
  abandonHandoff(id: string, handoffId: string) {
    return this.handoffs.abandon(id, handoffId);
  }
  runHandoffHere(id: string, handoffId: string) {
    return this.handoffs.takeBack(id, handoffId);
  }
  haltForHandoff(id: string) {
    return this.handoffs.halt(id);
  }
  leave(id: string, computer: string, since = 0) {
    return this.handoffs.leave(id, computer, since);
  }
  handedOver(handoffId: string) {
    return this.handoffs.handedOver(handoffId);
  }
  adopt(
    projectId: string,
    thread: HandoffThread,
    cameFrom: Omit<ChatCameFrom, "carried">,
    worktree: ChatWorktree,
    renamed?: string,
  ) {
    return this.handoffs.adopt(projectId, thread, cameFrom, worktree, renamed);
  }
  adoptSetup(
    projectId: string,
    title: string,
    cameFrom: Omit<ChatCameFrom, "carried" | "tip">,
    input: ProjectChatSend,
  ) {
    return this.handoffs.adoptSetup(projectId, title, cameFrom, input);
  }
  handBack(id: string, deviceId: string) {
    return this.handoffs.handBack(id, deviceId);
  }
  latestTurn(id: string) {
    return this.handoffs.latestTurn(id);
  }
  handedBack(id: string) {
    return this.handoffs.handedBack(id);
  }
  handoffAbandoned(id: string) {
    return this.handoffs.abandoned(id);
  }
  returned(id: string, handoffId: string, messages: ChatMessage[]) {
    return this.handoffs.returned(id, handoffId, messages);
  }
  /** On the computer a thread was handed to: see LiveHandoff. */
  handoffOutgoing(id: string, message: ChatMessage) {
    return this.liveHandoff.outgoing(id, message);
  }
  handoffWritten(id: string, known?: KnownMessages) {
    return this.liveHandoff.writtenHere(id, known);
  }
  handoffLive(id: string) {
    return this.liveHandoff.live(id);
  }
  handoffArgs(id: string, args: unknown[]) {
    return this.liveHandoff.inbound(id, args);
  }
  /** On the computer a thread came from: see LiveHandoff. */
  mirrorHandoff(id: string, handoffId: string, message: ChatMessage) {
    return this.liveHandoff.mirror(id, handoffId, message);
  }
  /** News of a thread live on another computer, as that computer told it. */
  handoffNews(
    id: string,
    projectId: string,
    news: Omit<ThreadNews, "chatId"> & Pick<NewsItem, "byAgent">,
  ) {
    this.news.retell({ ...news, chatId: id }, projectId);
  }
  handoffHeld(id: string) {
    return this.liveHandoff.held(id);
  }
  handoffSynced(
    id: string,
    handoffId: string,
    messages: (ChatMessage | string)[],
  ) {
    return this.liveHandoff.synced(id, handoffId, messages);
  }
  setHandoffLive(id: string, live: HandoffLive | undefined) {
    this.liveHandoff.setLive(id, live);
  }
  /** On the computer a thread is handed from, the computer it goes to readied for it: see SetupMirror. */
  beginSetup(id: string, computer: string, project: string) {
    return this.setupMirror.begin(id, computer, project);
  }
  updateSetup(id: string, change: Partial<Omit<ThreadSetup, "messages">>) {
    return this.setupMirror.update(id, change);
  }
  setupHeld(id: string) {
    return this.setupMirror.held(id);
  }
  mirrorSetup(id: string, message: ChatMessage) {
    return this.setupMirror.mirror(id, message);
  }
  setupSynced(id: string, messages: (ChatMessage | string)[]) {
    return this.setupMirror.synced(id, messages);
  }
  handoffOutbox(id: string) {
    return this.liveHandoff.outbox(id);
  }
  holdHandoffSend(id: string, handoffId: string, input: ProjectChatSend) {
    return this.liveHandoff.hold(id, handoffId, input);
  }
  takeHandoffSends(id: string) {
    return this.liveHandoff.takeOut(id);
  }
  putBackHandoffSends(id: string, held: HeldSend[], error: string) {
    return this.liveHandoff.putBack(id, held, error);
  }
  settleHandoffSend(id: string, sendId: string, error?: string) {
    return this.liveHandoff.settle(id, sendId, error);
  }
  /**
   * What waits in the thread now, which isn't saved with it; for a live
   * handoff, what its computer last said, over what's saved here.
   */
  private waitingIn(chat: ProjectChat) {
    if (!chat.sentTo?.live && !chat.sentTo?.setup)
      return { requests: this.active.requests(chat.id) };
    const {
      requests = [],
      queue,
      scheduled,
      queuePaused,
      stopped,
      limitResume,
      goal,
    } = this.core.away?.get(chat.id) ?? {};
    return {
      requests,
      queue,
      scheduled,
      queuePaused,
      stopped,
      limitResume,
      goal,
    };
  }
  startDeepReview(id: string, config: DeepReviewStart, pull?: PullInfo) {
    return this.councils.startReview(id, config, pull);
  }
  resumeDeepReview(id: string, only?: ResumeReview) {
    return this.councils.resumeReview(id, only);
  }
  setFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ) {
    return this.core.control(id, async () => {
      const chat = await this.storage.load(id);
      const report = setFindingStatus(chat.findings, findingId, status);
      // The report shows under its answer, which redraws it.
      const message = chat.messages.find((m) => m.id === report);
      if (message) message.version++;
      await this.storage.save(chat);
      if (message)
        this.core.emit({ chatId: id, message: structuredClone(message) });
    });
  }
  /** The same chat object a running turn writes into, so its next publish keeps the note closed. */
  closeWatchNote(
    id: string,
    messageId: string,
    noteId: string,
    how: WatchClose,
    read = false,
  ) {
    const known = how === "known";
    return this.core.control(id, async () => {
      const chat = await this.storage.load(id);
      const message = chat.messages.find((m) => m.id === messageId);
      const note = message?.notes?.find((n) => n.id === noteId);
      if (!message || !note || note.closed) return;
      note.closed = true;
      note.how = how;
      if (read) note.read = true;
      if (known) note.known = true;
      message.version++;
      await this.storage.save(chat);
      this.core.emit({ chatId: id, message: structuredClone(message) });
      if (known)
        await this.core.store.update((s) => {
          // The headline alone doesn't say what topic they closed.
          s.watchKnown = [
            ...(s.watchKnown ?? []).filter(
              (t) => t !== note.title && !t.startsWith(`${note.title}: `),
            ),
            `${note.title}: ${note.line}`,
          ].slice(-WATCH_KNOWN_LIMIT);
        });
    });
  }
  /** What side checks spent in the last `days`, by thread. */
  watchSpend(days: number) {
    const titles = new Map(
      (this.store.get().chats ?? []).map((c) => [c.id, c.title]),
    );
    return (
      this.core.watchSpend?.summary(days, (id) => titles.get(id)) ??
      Promise.resolve(undefined)
    );
  }
  /** The notes of the last `days` with what was done with each. */
  watchReview(days: number) {
    return this.watchNotes.review(days);
  }
  judgeWatchNotes(days: number) {
    return this.watchNotes.judge(days);
  }
  async get(id: string): Promise<ProjectChat> {
    const chat = await this.storage.load(id);
    await this.worktrees.refreshAgentWorktrees(chat);
    return {
      ...structuredClone(chat),
      ...structuredClone(this.waitingIn(chat)),
    };
  }
  /** Like get, but messages the caller already holds at the same version come back as their ids. */
  async changes(id: string, known: KnownMessages): Promise<ProjectChatPatch> {
    const saved = await this.storage.load(id);
    await this.worktrees.refreshAgentWorktrees(saved);
    const { messages, ...chat } = saved;
    return {
      ...structuredClone(chat),
      messages: messages.map((m) =>
        known[m.id] === m.version ? m.id : structuredClone(m),
      ),
      ...structuredClone(this.waitingIn(saved)),
    };
  }
  async cost(id: string) {
    return threadCost((await this.storage.load(id)).messages);
  }
  image(chatId: string, imageId: string) {
    return this.files.image(chatId, imageId);
  }
  /** The screenshots of a queued or scheduled message; it is gone once it has been sent. */
  async queuedImages(chatId: string, messageId: string) {
    const chat = await this.storage.load(chatId);
    const waiting = [...(chat.queue ?? []), ...(chat.scheduled ?? [])].find(
      (q) => q.input.id === messageId,
    );
    if (!waiting) throw new Error("That message is no longer waiting.");
    return structuredClone(waiting.input.images ?? []);
  }
  readImage(chatId: string, messageId: string, path: string) {
    return this.files.readImage(chatId, messageId, path);
  }
  videoPath(chatId: string, messageId: string, path: string) {
    return this.files.turnVideoPath(chatId, messageId, path);
  }
  revealImagePath(chatId: string, messageId: string, path: string) {
    return this.files.revealImagePath(chatId, messageId, path);
  }
  worktreeFolders(projectId: string) {
    return this.worktrees.folders(projectId);
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
    return this.control(id, () => this.sendHeld(id, input, fromRelay));
  }
  /**
   * A new thread's first message, kept with its worktree made but not
   * answered here: another computer starts the thread with it.
   */
  firstMessageOnly(id: string, input: ProjectChatSend) {
    return this.control(id, async () => {
      const chat = await this.storage.load(id);
      if (
        chat.messages.length ||
        !chat.worktree ||
        chat.scope.kind !== "project"
      )
        throw new Error(
          "Only a new thread in a worktree starts on another computer.",
        );
      if (!agentAsked(input))
        throw new Error("Pick the agent that starts it there.");
      await this.turns.sendNow(id, input, false, false);
      // Named after the message: the title's rename waits for a turn here.
      this.worktrees.unnamed.delete(id);
    });
  }
  /** The first message a thread kept for another computer to answer (firstMessageOnly), answered here after all. */
  answerHere(id: string) {
    return this.control(id, async () => {
      const chat = await this.storage.load(id);
      const input = chat.lastInput;
      const [first, ...rest] = chat.messages;
      if (!input || first?.id !== input.id || rest.length) return;
      chat.messages = [];
      await this.storage.save(chat);
      await this.sendHeld(id, input);
    });
  }
  /** Your own message, from the composer or a phone: it unsettles a thread settled while it ran. */
  async sendYours(id: string, input: ProjectChatSend) {
    await this.triaging.sent(id);
    return this.send(id, input);
  }
  /** A send whose caller already holds the thread's control. */
  private async sendHeld(
    id: string,
    input: ProjectChatSend,
    fromRelay = false,
  ) {
    if (this.disposing) throw new Error("Relay is closing.");
    const held = await this.storage.load(id);
    assertHere(held);
    // Sent again after its answer got lost: don't send it or pick a stopped queue back up.
    if (
      held.messages.some((m) => m.id === input.id) ||
      held.queue?.some((q) => q.input.id === input.id) ||
      held.scheduled?.some((s) => s.input.id === input.id)
    )
      return;
    if (input.sendAt) return this.schedule.add(id, input);
    if (input.side || input.parentId) {
      const chat = await this.storage.load(id);
      if (input.side || replyRoot(chat.messages, input.parentId!).side)
        return this.asides.ask(chat, input);
    }
    // Queued, it would wait for the very goal it pauses or clears.
    const asked = agentAsked(input);
    const goal = asked && parseGoalCommand(asked.question);
    const running = this.active.get(id);
    if (
      (goal?.type === "pause" || goal?.type === "clear") &&
      !input.parentId &&
      running?.goal &&
      !this.active.stopping(running)
    )
      return running.goal(goal.type);
    // Sent right after a stop: it waits for the agent to let go, rather
    // than queueing behind the answer the stop paused the queue for.
    await this.active.finished(id);
    if (
      !this.active.has(id) &&
      !this.councils.busy(await this.storage.load(id))
    ) {
      if (await this.compactions.firstIfCold(id, input))
        return this.queue.sentNow(id, input, fromRelay);
      await this.turns.sendNow(id, input);
      return this.queue.sentNow(id, input, fromRelay);
    }
    return this.queue.add(id, input);
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
  worktreeDiff(id: string, path: string) {
    return this.worktrees.diff(id, path);
  }
  removeWorktree(id: string) {
    return this.worktrees.remove(id);
  }
  returnedCopy(projectId: string, branch: string, tip: string) {
    return this.worktrees.returnedCopy(projectId, branch, tip);
  }
  passedOn(id: string) {
    return this.worktrees.passedOn(id);
  }
  worktreeBranch(projectId: string, branch: string) {
    return this.worktrees.branch(projectId, branch);
  }
  rerunWorktreeSetup(id: string, messageId: string) {
    return this.worktrees.setup.rerun(id, messageId);
  }
  /** What a terminal in the thread's worktree is told, like its agent; nothing in the checkout. */
  async worktreeEnv(id: string) {
    return this.worktrees.setup.env(await this.storage.load(id));
  }
  worktreeMovePreview(id: string) {
    return this.worktrees.movePreview(id);
  }
  moveToWorktree(id: string) {
    return this.worktrees.move(id);
  }
  /** Moves the thread into a worktree its agent asked for in the middle of its answer. */
  enterWorktree(id: string, request: WorktreeRequest) {
    return this.worktrees.enter(id, request);
  }
  terminalFolder(projectId: string, id: string) {
    return this.worktrees.terminalFolder(projectId, id);
  }
  worksInCheckout(projectId: string, id: string) {
    return this.worktrees.worksInCheckout(projectId, id);
  }
  agentWorktreePath(id: string, path: string) {
    return this.worktrees.agentWorktreePath(id, path);
  }
  selectAgentWorktree(id: string, path: string | null) {
    return this.worktrees.selectAgentWorktree(id, path);
  }
  agentWorktreeRecreatable(id: string) {
    return this.worktrees.agentWorktreeRecreatable(id);
  }
  recreateAgentWorktree(id: string) {
    return this.worktrees.recreateAgentWorktree(id);
  }
  worktreeRoot(projectId: string, id: string, expectedWorktree?: string) {
    return this.worktrees.rootFor(projectId, id, expectedWorktree);
  }
  worktreePath(id: string) {
    return this.worktrees.path(id);
  }
  recordPull(id: string, pr: { number: number; url: string }) {
    return this.worktrees.recordPull(id, pr);
  }
  pullMerged(id: string) {
    return this.worktrees.pullMerged(id);
  }
  branchMerged(id: string, branch: string) {
    return this.worktrees.branchMerged(id, branch);
  }
  turnDiff(chatId: string, messageId: string, path: string) {
    return this.files.diff(chatId, messageId, path);
  }
  turnFilePath(chatId: string, messageId: string | null, path: string) {
    return this.files.path(chatId, messageId, path);
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
    const active = this.active.get(id);
    if (!active)
      return Promise.reject(
        new Error("This thread has no running turn to ask in."),
      );
    return active.requests.ask(request, signal);
  }
  /** Adds a page the thread's agent showed to the answer it is writing; see electron/html-renders. */
  async showRender(id: string, render: HtmlRender, pages: string[]) {
    const active = this.active.get(id);
    if (!active?.render || this.active.windingDown(active))
      throw new Error("This thread has no running answer to show it in.");
    await this.storage.renders.save(id, render.id, pages);
    active.render(render);
  }
  /**
   * Leaves the thread's preview under the answer its agent is writing, with
   * the page's last frame when one could be drawn. A later open replaces it.
   */
  async showPreview(
    id: string,
    preview: Omit<TurnPreview, "shot">,
    jpeg: Buffer | null,
  ) {
    const active = this.active.get(id);
    if (!active?.preview || !active.answerId || this.active.windingDown(active))
      return;
    const shot =
      !!jpeg &&
      (await this.storage.shown
        .keepPreviewShot(id, active.answerId(), jpeg)
        .then(
          () => true,
          (e) => {
            console.warn("Could not keep the preview's frame:", e);
            return false;
          },
        ));
    active.preview({ ...preview, ...(shot ? { shot } : {}) });
  }
  /** The preview's last frame a turn kept, as a data URL. */
  previewShot(chatId: string, messageId: string) {
    return this.files.previewShot(chatId, messageId);
  }
  /**
   * Leaves a page the thread's agent asks with (ask_html) in the answer it is
   * writing, as an open question: kept like a shown page, answered later
   * through answerQuestion. `ask` is the plain question for phones too old to
   * show the page.
   */
  async askWithPage(id: string, page: HtmlRender, html: string, ask: string) {
    const active = this.active.get(id);
    if (!active?.askPage || this.active.windingDown(active))
      throw new Error("This thread has no running answer to ask in.");
    await this.storage.renders.save(id, page.id, [html]);
    active.askPage({
      id: page.id,
      page,
      questions: [{ id: PAGE_QUESTION_ID, header: "Page", question: ask }],
    });
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
