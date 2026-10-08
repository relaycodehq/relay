import { dirname, join } from "node:path";
import type { AccountProvider } from "../../shared/agent-accounts";
import type { AgentRequest, AgentResponse } from "../../shared/agent-modes";
import type { DeepReviewStart, FindingStatus } from "../../shared/deep-review";
import type {
  ChatCameFrom,
  ChatSentTo,
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
import { replyRoot } from "../../shared/projects";
import { parseGoalCommand } from "../../shared/goal";
import type { TerminalSessionPick } from "../../shared/terminal-sessions";
import { agentAsked } from "../../shared/recipient";
import type { LineQuestion } from "../../shared/questions";
import { agentRuntimes } from "../agents";
import { accountHomes } from "../agents/accounts";
import type { PullInfo } from "../deep-review";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import { TerminalSessions } from "../terminal-sessions";
import { ActiveTurns } from "./active";
import { SideQuestions } from "./asides";
import { threadControl } from "./control";
import type { ChatCore } from "./core";
import { Councils } from "./councils";
import { assertHere, ComputerHandoff } from "./handoff";
import { ChatQueue } from "./queue";
import { LimitResumes } from "./limit-resume";
import { ChatSchedule } from "./schedule";
import { reloadSessions } from "./session-reload";
import { ProviderSessions } from "./sessions";
import { ChatStorage } from "./storage";
import { ThreadTitles } from "./titles";
import { TurnFiles } from "./turn-files";
import { TerminalContinue } from "./terminal-continue";
import { ThreadCreate } from "./thread-create";
import { ThreadList } from "./thread-list";
import { ThreadTriage } from "./thread-triage";
import { TurnRunner } from "./turn-run";
import { ChatTurns } from "./turns";
import { ThreadWorktrees } from "./worktrees";
import { WorktreeCleanup } from "./worktree-cleanup";
import { WATCH_KNOWN_LIMIT, type WatchClose } from "../../shared/watch";
import { WatchReviews } from "./watch-review";
import { WatchSpendLog } from "./watch-spend";
import { AsyncQuestions } from "./async-questions";

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
  private titles: ThreadTitles;
  private worktrees: ThreadWorktrees;
  private cleanup: WorktreeCleanup;
  private files: TurnFiles;
  private handoffs: ComputerHandoff;
  private runner: TurnRunner;
  private asides: SideQuestions;
  private queue: ChatQueue;
  private turns: ChatTurns;
  private control = threadControl();
  private questions: AsyncQuestions;
  private disposing = false;
  private councils: Councils;
  private watchNotes: WatchReviews;
  private core: ChatCore;
  private threads: ThreadList;
  private triaging: ThreadTriage;
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
    this.active = new ActiveTurns((id) => this.storage.chatChanged(id));
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
    // vi.spyOn(chats, "send"), and this.turns is only built last.
    this.councils = new Councils(core, {
      send: (id, input) => this.send(id, input),
      lead: (chat, input, prompt) => this.turns.lead(chat, input, prompt),
    });
    this.schedule = new ChatSchedule(core, {
      send: (id, input, fromRelay) => this.send(id, input, fromRelay),
    });
    this.limits = new LimitResumes(core, {
      resume: (id) => this.turns.resumeHeld(id),
    });
    this.titles = new ThreadTitles(core);
    this.worktrees = new ThreadWorktrees(
      core,
      join(dirname(dir), "worktrees"),
      this.councils,
    );
    this.cleanup = new WorktreeCleanup(
      core,
      this.worktrees,
      this.councils,
      () => this.threads.cleanupCandidates(),
    );
    this.files = new TurnFiles(core, this.worktrees);
    this.threads = new ThreadList(core);
    this.triaging = new ThreadTriage(core, this.worktrees, this.councils);
    this.creating = new ThreadCreate(core);
    this.terminal = new TerminalContinue(
      core,
      this.worktrees,
      new TerminalSessions(async () => accountHomes()),
    );
    this.handoffs = new ComputerHandoff(core, this.schedule, this.councils, {
      send: (id, input) => this.send(id, input),
      note: (chat, root, provider, active, computer) =>
        this.turns.handoff(
          chat,
          root,
          provider,
          provider,
          undefined,
          active,
          computer,
        ),
    });
    this.runner = new TurnRunner(core, this.titles, this.worktrees.folder, {
      unprompted: (chat, root, provider, parentId) =>
        this.turns.unprompted(chat, root, provider, parentId),
      limited: (id, messageId, limit) =>
        void this.limits
          .stopped(id, messageId, limit)
          .catch((e) => console.warn("Could not plan the resume:", e)),
      env: (chat) => this.worktrees.setup.env(chat),
    });
    this.asides = new SideQuestions(core, this.worktrees, this.runner);
    this.queue = new ChatQueue(core, this.schedule, this.councils, {
      sendNow: (id, input) => this.turns.sendNow(id, input),
    });
    this.turns = new ChatTurns(
      core,
      this.worktrees,
      this.runner,
      this.titles,
      this.councils,
      this.queue,
      evidence,
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
  /**
   * Removes the worktrees of threads settled long enough, where nothing is
   * at work and nothing would be lost; their branches stay.
   */
  cleanUpWorktrees() {
    return this.cleanup
      .sweep()
      .catch((e) => console.warn("Could not clean up worktrees:", e));
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
  /** Arms the wake-ups kept when Relay last closed, scheduled messages and resumes after a limit. */
  armWakeups() {
    this.schedule.armAll();
    this.limits.armAll();
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
  detach(id: string) {
    return this.triaging.detach(id);
  }
  startedThreads(leadId: string) {
    return this.threads.started(leadId);
  }
  allowLeadSends(id: string) {
    return this.triaging.allowLeadSends(id);
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
  startDeepReview(id: string, config: DeepReviewStart, pull?: PullInfo) {
    return this.councils.startReview(id, config, pull);
  }
  resumeDeepReview(id: string) {
    return this.councils.resumeReview(id);
  }
  setDeepReviewFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ) {
    return this.councils.setFinding(id, findingId, status);
  }
  resumeUltraplan(id: string, request: string) {
    return this.councils.resumeUltraplan(id, request);
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
    return { ...structuredClone(chat), requests: this.active.requests(id) };
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
      requests: this.active.requests(id),
    };
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
  turnImagePath(chatId: string, messageId: string, path: string) {
    return this.files.turnImagePath(chatId, messageId, path);
  }
  readImage(chatId: string, messageId: string, path: string) {
    return this.files.readImage(chatId, messageId, path);
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
  /** A send whose caller already holds the thread's control. */
  private async sendHeld(
    id: string,
    input: ProjectChatSend,
    fromRelay = false,
  ) {
    if (this.disposing) throw new Error("Relay is closing.");
    assertHere(await this.storage.load(id));
    if (input.side || input.parentId) {
      const chat = await this.storage.load(id);
      if (input.side || replyRoot(chat.messages, input.parentId!).side)
        return this.asides.ask(chat, input);
    }
    if (input.sendAt) return this.schedule.add(id, input);
    // Queued, it would wait for the very goal it pauses or clears.
    const asked = agentAsked(input);
    const goal = asked && parseGoalCommand(asked.question);
    const running = this.active.get(id);
    if (
      (goal?.type === "pause" || goal?.type === "clear") &&
      !input.parentId &&
      running?.goal &&
      !running.stopping
    )
      return running.goal(goal.type);
    // Sent right after a stop: it waits for the agent to let go, rather
    // than queueing behind the answer the stop paused the queue for.
    await this.active.finished(id);
    if (
      !this.active.has(id) &&
      !this.councils.busy(await this.storage.load(id))
    ) {
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
    return this.turns.compact(id, parentId, instructions);
  }
  /** Restarts the thread's agent on its conversation, to load what changed on disk since. */
  reloadSessions(id: string) {
    return reloadSessions(this.core, id);
  }
  /**
   * Takes back the agent sessions that kept running while Relay restarted.
   * A turn one was in carries on in the answer it was writing.
   */
  reattach() {
    return this.turns.reattach();
  }
  /** Puts right any thread summary a crash left behind its thread. */
  async reconcileSummaries() {
    await this.storage.reconcile(this.store.savedAtLoad);
  }
  /** Threads with an answer running now. */
  working() {
    return this.active.size;
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
  worktreeBranch(projectId: string, prompt: string, branch?: string) {
    return this.worktrees.branch(projectId, prompt, branch);
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
  async cancel(id: string) {
    const chat = this.storage.cached(id);
    if (chat) chat.queuePaused = true;
    this.active.stop(id);
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
  }

  /** Commit teardown only after preparation, or an explicit discard. */
  async dispose({ detach = false, save = true } = {}) {
    if (!this.disposing) await this.prepareToQuit({ detach, save });
    this.sessions.stopListening();
    if (detach) {
      for (const runtime of Object.values(agentRuntimes)) runtime.detach?.();
      return;
    }
    this.schedule.commitPending();
    await this.sessions.closeAll();
    await Promise.all(
      Object.values(agentRuntimes).map((runtime) =>
        runtime.dispose?.().catch(() => {}),
      ),
    );
  }
}
