import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentResponse } from "../../shared/agent-modes";
import {
  autoSettledAt,
  DEFAULT_AUTO_SETTLE_DAYS,
} from "../../shared/chat-activity";
import type { DeepReviewStart, FindingStatus } from "../../shared/deep-review";
import type {
  ChatCameFrom,
  ChatSentTo,
  HandoffThread,
} from "../../shared/handoff";
import type {
  ChatMessage,
  ChatPending,
  ChatScope,
  ChatSummary,
  ChatTriage,
  ChatWorkspace,
  ChatWorktree,
  KnownMessages,
  ProjectChat,
  ProjectChatPatch,
  ProjectChatSend,
  ResumeSettings,
} from "../../shared/projects";
import { replyRoot } from "../../shared/projects";
import type { LineQuestion } from "../../shared/questions";
import { sentAgent } from "../../shared/recipient";
import { agentRuntimes } from "../agents";
import type { PullInfo } from "../deep-review";
import type { Projects } from "../projects/projects";
import type { ProjectSharing } from "../projects/project-sharing";
import type { Store } from "../app/store";
import { ActiveTurns, type ActiveChat } from "./active";
import { SideQuestions } from "./asides";
import { threadControl } from "./control";
import type { ChatCore } from "./core";
import { Councils } from "./councils";
import { assertHere, ComputerHandoff } from "./handoff";
import { ChatQueue } from "./queue";
import { LimitResumes } from "./limit-resume";
import { ChatSchedule } from "./schedule";
import { ProviderSessions } from "./sessions";
import { ChatSharing } from "./sharing";
import { ChatStorage, chatSummary, nextSend } from "./storage";
import { ThreadTitles } from "./titles";
import { TurnFiles } from "./turn-files";
import { TurnRunner } from "./turn-run";
import { ChatTurns } from "./turns";
import { ThreadWorktrees } from "./worktrees";

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
  private sharing: ChatSharing;
  private worktrees: ThreadWorktrees;
  private files: TurnFiles;
  private handoffs: ComputerHandoff;
  private runner: TurnRunner;
  private asides: SideQuestions;
  private queue: ChatQueue;
  private turns: ChatTurns;
  private control = threadControl();
  private disposing = false;
  private councils: Councils;
  constructor(
    private store: Store,
    private projects: Projects,
    dir: string,
    private emit: (event: {
      chatId: string;
      message: ChatMessage;
      title?: string;
    }) => void,
    sharing?: ProjectSharing,
    evidence?: (chat: ProjectChat, selection: LineQuestion) => Promise<unknown>,
  ) {
    this.storage = new ChatStorage(store, dir, (chatId, branch) =>
      this.sessions.isResuming(chatId, branch),
    );
    this.sessions = new ProviderSessions(dir, (id) =>
      this.storage.chatChanged(id),
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
    };
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
    this.sharing = new ChatSharing(core, sharing, {
      sync: (id) => this.sync(id),
    });
    this.worktrees = new ThreadWorktrees(
      core,
      join(dirname(dir), "worktrees"),
      this.councils,
    );
    this.files = new TurnFiles(core, this.worktrees);
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
    this.runner = new TurnRunner(
      core,
      this.titles,
      this.sharing,
      this.worktrees.folder,
      (chat, root, provider, parentId) =>
        this.turns.unprompted(chat, root, provider, parentId),
      (id, messageId, limit) =>
        void this.limits
          .stopped(id, messageId, limit)
          .catch((e) => console.warn("Could not plan the resume:", e)),
    );
    this.asides = new SideQuestions(core, this.worktrees, this.runner);
    this.queue = new ChatQueue(
      core,
      this.schedule,
      this.sharing,
      this.councils,
      {
        sendNow: (id, input) => this.turns.sendNow(id, input),
      },
    );
    this.turns = new ChatTurns(
      core,
      this.worktrees,
      this.sharing,
      this.runner,
      this.titles,
      this.councils,
      this.queue,
      evidence,
      { sync: (id) => this.sync(id) },
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
  autoSettleDays(): number | null {
    const days = this.store.get().autoSettleDays;
    return days === undefined ? DEFAULT_AUTO_SETTLE_DAYS : days;
  }
  list(projectId: string): ChatSummary[] {
    const { settings } = this.projects.get(projectId);
    const chats = (this.store.get().chats ?? []).filter(
      (c) => c.projectId === projectId,
    );
    // A review runs while any of its reviewers does, a thread while its thinkers do.
    const helpers = new Map<string, ActiveChat[]>();
    for (const c of chats) {
      const parent = (c.reviewer ?? c.thinker)?.parent;
      const active = parent && this.active.get(c.id);
      if (active) helpers.set(parent, [...(helpers.get(parent) ?? []), active]);
    }
    // Once for the list: it is read on every change to any of its threads.
    const live = this.sessions.pending();
    const now = Date.now();
    const autoSettleDays =
      settings?.autoSettleDays !== undefined
        ? settings.autoSettleDays
        : this.autoSettleDays();
    return chats
      .filter((c) => !c.reviewer && !c.thinker)
      .sort((a, b) => b.updated - a.updated)
      .map((c) => {
        const crew = [
          this.active.get(c.id),
          ...(helpers.get(c.id) ?? []).sort((a, b) => a.started - b.started),
        ].filter((a): a is ActiveChat => !!a);
        const active = crew[0];
        const running = [
          ...new Set(
            crew.flatMap(({ input }) => (input ? [sentAgent(input)] : [])),
          ),
        ];
        const pending = [
          ...live.filter((p) => p.chatId === c.id).map((p) => p.item),
          ...(c.heldWakeups ?? []).map((w): ChatPending => ({
            kind: "wakeup",
            id: w.id,
            prompt: w.prompt,
            recurring: false,
            at: w.at,
          })),
        ];
        const listed: ChatSummary =
          active || pending.length
            ? {
                ...c,
                ...(active
                  ? {
                      running: true,
                      runningSince: active.started,
                      runningAgents: running,
                      waiting: active.requests.list().length > 0,
                    }
                  : {}),
                ...(pending.length ? { pending } : {}),
              }
            : c;
        const settledAt = autoSettledAt(
          listed,
          now,
          autoSettleDays,
          settings?.settleOnCommit,
        );
        return settledAt
          ? { ...listed, settledAt, autoSettled: true as const }
          : listed;
      });
  }
  /** The subagents Claude started in a thread, its side conversations' too. */
  agents(id: string) {
    return this.sessions.subagents(id);
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
  async triage(id: string, triage: ChatTriage) {
    const chat = await this.storage.load(id);
    const now = Date.now();
    if (triage.kind === "unread" || triage.kind === "auto-settle") {
      if (triage.kind === "unread") chat.markedUnread = true;
      else if (triage.enabled) delete chat.autoSettleOff;
      else chat.autoSettleOff = true;
      await this.storage.persist(chat);
      return chatSummary(chat);
    }
    if (triage.kind === "archive") {
      if (this.active.has(id) || this.councils.busy(chat))
        throw new Error("Stop the running answer before archiving.");
      // Nothing reopens an archived thread to cancel what would still run in it.
      if (
        nextSend(chat.scheduled) ||
        chat.heldWakeups?.length ||
        this.sessions.pending(id).length
      )
        throw new Error(
          "Cancel the scheduled messages and Claude's background work before archiving.",
        );
      chat.archivedAt = now;
      await this.worktrees.dropLanded(chat, now);
      await this.storage.persist(chat);
      return chatSummary(chat);
    }
    delete chat.snoozedAt;
    delete chat.snoozedUntil;
    if (triage.kind === "settle") chat.settledAt = now;
    else if (triage.kind === "unsettle" || triage.kind === "snooze")
      delete chat.settledAt;
    // Settled by hand or automatically, moving it back keeps it out until something new happens.
    if (triage.kind === "unsettle") chat.unsettledAt = now;
    if (triage.kind === "snooze") {
      if (triage.until <= now) throw new Error("Choose a future wake time.");
      chat.snoozedAt = now;
      chat.snoozedUntil = triage.until;
    }
    await this.storage.persist(chat);
    return chatSummary(chat);
  }
  /** Only moves forward, so a device that read less can't mark a thread unread again. */
  async markSeen(id: string, seenAt: number) {
    const chat = await this.storage.load(id);
    if ((chat.seenAt ?? 0) >= seenAt && !chat.markedUnread) return;
    chat.seenAt = Math.max(chat.seenAt ?? 0, seenAt);
    delete chat.markedUnread;
    await this.storage.persist(chat);
  }
  rename(id: string, candidate: string) {
    return this.titles.rename(id, candidate);
  }
  async create(
    projectId: string,
    scope: ChatScope,
    workspace: ChatWorkspace = "checkout",
  ) {
    const { plain } = await this.projects.inspect(projectId);
    if (plain && (workspace === "worktree" || scope.kind !== "project"))
      throw new Error("Worktrees, PRs and deep reviews need a Git repository.");
    if (workspace === "worktree" && scope.kind !== "project")
      throw new Error("Only repository threads can work in a worktree.");
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      scope,
      // The worktree itself is made with the first message, named after it.
      ...(workspace === "worktree" ? { worktree: {} } : {}),
      title:
        scope.kind === "pr"
          ? `PR #${scope.ref.number}`
          : scope.kind === "review"
            ? "Deep review"
            : "New chat",
      created: Date.now(),
      updated: Date.now(),
      messages: [],
    };
    await this.storage.add(chat);
    return chatSummary(chat);
  }
  /**
   * A new thread holding the conversation up to an answer, side conversation
   * included when the answer is in one. The original keeps its turns' changes
   * to review and roll back; the fork starts without them.
   */
  async fork(id: string, messageId?: string) {
    const source = await this.storage.load(id);
    if (source.scope.kind === "review")
      throw new Error("A deep review can't be forked.");
    const at = messageId
      ? source.messages.find((m) => m.id === messageId)
      : [...source.messages]
          .reverse()
          .find(
            (m) =>
              m.role === "assistant" &&
              m.status !== "streaming" &&
              !m.parentId &&
              !m.side &&
              !m.handoff &&
              !m.compaction,
          );
    if (at?.role !== "assistant" || at.status === "streaming")
      throw new Error("Fork from an answer that has finished.");
    const upTo = source.messages.slice(0, source.messages.indexOf(at) + 1);
    const side = at.parentId;
    const main = side
      ? upTo.slice(0, upTo.findIndex((m) => m.id === side) + 1)
      : upTo;
    const kept = upTo.filter((m) =>
      side
        ? m.parentId === side || (!m.parentId && main.includes(m))
        : !m.parentId,
    );
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId: source.projectId,
      scope: source.scope,
      title: `Fork: ${source.title}`.slice(0, 120),
      created: Date.now(),
      updated: Date.now(),
      ...(source.branch ? { branch: source.branch } : {}),
      // Its own worktree, made from the checkout with its first message.
      ...(source.worktree ? { worktree: {} } : {}),
      messages: kept.map(({ changes, pending, seq, parentId, ...m }) => ({
        ...structuredClone(m),
        id: randomUUID(),
        version: 1,
      })),
    };
    chat.forkedAt = chat.messages.at(-1)!.id;
    await this.storage.copyImages(source.id, chat.id, kept);
    await this.storage.add(chat);
    return chatSummary(chat);
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
  ) {
    return this.handoffs.adopt(projectId, thread, cameFrom, worktree);
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
  async get(id: string): Promise<ProjectChat> {
    const chat = await this.storage.load(id);
    return { ...structuredClone(chat), requests: this.active.requests(id) };
  }
  /** Like get, but messages the caller already holds at the same version come back as their ids. */
  async changes(id: string, known: KnownMessages): Promise<ProjectChatPatch> {
    const { messages, ...chat } = await this.storage.load(id);
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
  hasActiveProject(projectId: string) {
    return this.worktrees.checkoutBusy(projectId);
  }
  /** `fromRelay` marks Relay's own messages, which leave a stopped queue stopped. */
  send(id: string, input: ProjectChatSend, fromRelay = false) {
    return this.control(id, async () => {
      if (this.disposing) throw new Error("Relay is closing.");
      assertHere(await this.storage.load(id));
      if (input.side || input.parentId) {
        const chat = await this.storage.load(id);
        if (input.side || replyRoot(chat.messages, input.parentId!).side)
          return this.asides.ask(chat, input);
      }
      if (input.sendAt) return this.schedule.add(id, input);
      if (
        !this.active.has(id) &&
        !this.councils.busy(await this.storage.load(id))
      ) {
        await this.turns.sendNow(id, input);
        return this.queue.sentNow(id, input, fromRelay);
      }
      return this.queue.add(id, input);
    });
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
  /**
   * Takes back the agent sessions that kept running while Relay restarted.
   * A turn one was in carries on in the answer it was writing.
   */
  reattach() {
    return this.turns.reattach();
  }
  /** Threads with an answer running now. */
  working() {
    return this.active.size;
  }
  worktreeStatus(id: string) {
    return this.worktrees.status(id);
  }
  worktreeDiff(id: string, path: string) {
    return this.worktrees.diff(id, path);
  }
  removeWorktree(id: string) {
    return this.worktrees.remove(id);
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
  worktreeRoot(projectId: string, id: string) {
    return this.worktrees.rootFor(projectId, id);
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
  shareInfo(id: string) {
    return this.sharing.info(id);
  }
  share(id: string) {
    return this.sharing.share(id);
  }
  async sync(id: string) {
    await this.sharing.pull(id);
    return this.get(id);
  }
  /** Sync, answering like changes. */
  async syncChanges(id: string, known: KnownMessages) {
    await this.sharing.pull(id);
    return this.changes(id, known);
  }
  presence(
    id: string,
    value: { path: string | null; viewed: number; total: number } | null,
  ) {
    return this.sharing.presence(id, value);
  }
  workspace(id: string) {
    return this.sharing.workspace(id);
  }
  invite(id: string) {
    return this.sharing.invite(id);
  }
  sharedList(projectId: string) {
    return this.sharing.list(projectId);
  }
  openShared(projectId: string, roomId: string) {
    return this.sharing.open(projectId, roomId);
  }
  join(projectId: string, url: string) {
    return this.sharing.join(projectId, url);
  }
  respond(id: string, requestId: string, response: AgentResponse) {
    const active = this.active.get(id);
    if (!active) throw new Error("This turn is no longer running.");
    active.requests.respond(requestId, response);
    if (response.kind === "approval" && response.decision === "cancel")
      return this.cancel(id);
  }
  async cancel(id: string) {
    const chat = this.storage.cached(id);
    if (chat) chat.queuePaused = true;
    this.active.get(id)?.abort.abort();
    if (chat) await this.councils.stop(chat);
    return chat ? this.storage.save(chat) : undefined;
  }
  /**
   * Relay is closing. `detach`: it's restarting, and the agent host keeps
   * the agents' sessions going; running answers are saved as they stand and
   * picked back up by `reattach`.
   */
  async dispose({ detach = false } = {}) {
    this.sessions.stopListening();
    if (detach) {
      this.disposing = true;
      this.schedule.stop();
      this.limits.stop();
      for (const a of this.active.allSides()) a.abort.abort();
      this.titles.abort();
      // What was stopped writes its last state before the store goes to disk.
      await Promise.allSettled([
        ...this.active.allSides().map((a) => a.job),
        ...this.titles.running(),
      ]);
      await Promise.allSettled(
        this.active.ids().map((id) => {
          const chat = this.storage.cached(id);
          return chat && this.storage.save(chat);
        }),
      );
      await Promise.allSettled(this.storage.busy().writes);
      await this.store.flush();
      for (const runtime of Object.values(agentRuntimes)) runtime.detach?.();
      return;
    }
    await this.schedule
      .keepPending()
      .catch((e) =>
        console.warn("Could not keep Claude's background work:", e),
      );
    this.schedule.stop();
    this.limits.stop();
    this.disposing = true;
    for (const a of this.active.all()) a.abort.abort();
    for (const a of this.active.allSides()) a.abort.abort();
    this.titles.abort();
    await Promise.allSettled(this.active.allSides().map((a) => a.job));
    await Promise.allSettled(this.active.all().map((a) => a.job));
    await Promise.allSettled(this.titles.running());
    await Promise.allSettled(this.titles.writing());
    await Promise.allSettled(this.control.pending());
    // An answer still being set up starts its agent only once it is aborted.
    await Promise.allSettled(this.turns.starting());
    // A send already inside validation can attach its job while shutdown waits.
    await Promise.allSettled(this.active.all().map((a) => a.job));
    await Promise.allSettled(this.councils.stepping());
    await Promise.allSettled([
      ...this.sharing.pulling(),
      ...this.storage.busy().loads,
    ]);
    await Promise.all(this.storage.busy().writes);
    // A finished answer refreshes its sidebar summary without waiting for it.
    await this.store.flush();
    await this.sessions.closeAll();
    await Promise.all(
      Object.values(agentRuntimes).map((runtime) =>
        runtime.dispose?.().catch(() => {}),
      ),
    );
  }
}
