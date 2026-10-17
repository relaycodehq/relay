import {
  autoSettledAt,
  DEFAULT_AUTO_SETTLE_DAYS,
  settledSince,
} from "../../shared/chat-activity";
import type {
  ChatPending,
  ChatSummary,
  ProjectSettings,
} from "../../shared/projects";
import { DEFAULT_WORKTREE_CLEANUP_DAYS } from "../../shared/projects";
import { working, type Turn } from "../../shared/turns";
import type { AwayLive, ChatCore } from "./core";
import type { CleanupCandidate } from "./worktree-cleanup";

/** Turns that make the thread read running; a side answer or a handoff note runs inside another. */
const holdsThread = (t: Turn) => t.kind !== "aside" && t.kind !== "handoff";

/** A thread on another computer through a live handoff, as running and waiting there. */
function awaySummary(
  c: ChatSummary,
  {
    running,
    runningSince,
    runningAgents,
    waiting,
    blocked,
    asking,
    pending,
    stopped,
    limitResume,
    goal,
  }: AwayLive,
): ChatSummary {
  const { asking: _a, stopped: _s, limitResume: _l, goal: _g, ...rest } = c;
  return {
    ...rest,
    ...(running ? { running, runningSince, runningAgents, waiting: !!waiting } : {}),
    ...(waiting && !running ? { waiting } : {}),
    ...(blocked ? { blocked } : {}),
    ...(asking ? { asking } : {}),
    ...(pending?.length ? { pending } : {}),
    ...(stopped ? { stopped } : {}),
    ...(limitResume ? { limitResume } : {}),
    ...(goal ? { goal } : {}),
  };
}

/** A project's threads as the sidebar lists them: saved summaries, what runs in each now, and how they settle. */
export class ThreadList {
  constructor(private core: ChatCore) {}
  autoSettleDays(): number | null {
    const days = this.core.store.get().autoSettleDays;
    return days === undefined ? DEFAULT_AUTO_SETTLE_DAYS : days;
  }
  worktreeCleanupDays(): number | null {
    const days = this.core.store.get().worktreeCleanupDays;
    return days === undefined ? DEFAULT_WORKTREE_CLEANUP_DAYS : days;
  }
  /** How the project's threads settle by themselves, its own settings first. */
  private settling(settings: ProjectSettings | undefined) {
    return {
      days:
        settings?.autoSettleDays !== undefined
          ? settings.autoSettleDays
          : this.autoSettleDays(),
      onCommit: !!settings?.settleOnCommit,
    };
  }
  list(projectId: string): ChatSummary[] {
    const { settings } = this.core.projects.get(projectId);
    const now = Date.now();
    const { days, onCommit } = this.settling(settings);
    return this.live(projectId).map((listed) => {
      const settledAt = autoSettledAt(listed, now, days, onCommit);
      return settledAt
        ? { ...listed, settledAt, autoSettled: true as const }
        : listed;
    });
  }
  /** The threads `leadId`'s agent started, in whichever project. */
  started(leadId: string): ChatSummary[] {
    const projects = new Set(
      (this.core.store.get().chats ?? [])
        .filter((c) => c.startedBy?.chatId === leadId)
        .map((c) => c.projectId),
    );
    return [...projects].flatMap((p) =>
      this.list(p).filter((c) => c.startedBy?.chatId === leadId),
    );
  }
  /** The project's threads as saved, with what runs or waits in each now. */
  private live(projectId: string): ChatSummary[] {
    const chats = (this.core.store.get().chats ?? []).filter(
      (c) => c.projectId === projectId,
    );
    const byId = new Map(chats.map((c) => [c.id, c]));
    const { ledger } = this.core.active;
    // A review runs while any of its reviewers does, until its lead takes
    // over; a reviewer asked something later runs on its own.
    const helpers = new Map<string, Turn[]>();
    for (const c of chats) {
      const parent = c.reviewer?.parent;
      if (!parent || !byId.get(parent)?.reviewing) continue;
      helpers.set(parent, [
        ...(helpers.get(parent) ?? []),
        ...ledger.inThread(c.id).filter(holdsThread),
      ]);
    }
    // Once for the list: it is read on every change to any of its threads.
    const live = this.core.sessions.pending();
    // Reviewers show under their review, and go with it once it's archived.
    const listed = (c: ChatSummary) => {
      if (!c.reviewer) return true;
      const review = byId.get(c.reviewer.parent);
      return !!c.startedBy && !!review && !review.archivedAt;
    };
    // A reviewer's Git, files and terminal follow the folder its review reads.
    const inReviewFolder = (c: ChatSummary): ChatSummary => {
      const folder = c.reviewer && byId.get(c.reviewer.parent)?.reviewFolder;
      return folder ? { ...c, reviewFolder: folder } : c;
    };
    return chats
      .filter(listed)
      .map(inReviewFolder)
      .sort((a, b) => b.updated - a.updated)
      .map((c) => {
        if (c.sentTo?.live) {
          const away = this.core.away?.get(c.id);
          return away ? awaySummary(c, away) : c;
        }
        // The thread's own turns first: the one holding it, any the agent
        // started beside it, then its reviewers' as they started.
        const turns = [
          ...ledger.inThread(c.id).filter(holdsThread),
          ...(helpers.get(c.id) ?? []).sort((a, b) => a.startedAt - b.startedAt),
        ];
        const crew = turns.filter((t) => working(t.phase));
        const active = crew.find((t) => t.threadId === c.id) ?? crew[0];
        // A stopped answer reads as stopping until its agent winds down.
        const stopping = !active && turns.some((t) => t.phase === "stopping");
        const running = [...new Set(crew.map((t) => t.provider))];
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
        // Open questions need the user even while the agent continues.
        // A thread handed away is answered on that computer.
        const blocked = crew.some((t) => t.blocked);
        const waiting = blocked || (!!c.asking && !c.sentTo);
        return active || stopping || pending.length || waiting
          ? {
              ...c,
              ...(active
                ? {
                    running: true,
                    runningSince: Math.min(...crew.map((t) => t.startedAt)),
                    runningAgents: running,
                    turn: {
                      id: active.id,
                      kind: active.kind,
                      phase: active.phase,
                      startedAt: active.startedAt,
                    },
                    waiting,
                    ...(blocked ? { blocked: true as const } : {}),
                  }
                : waiting
                  ? { waiting }
                  : {}),
              ...(stopping ? { stopping: true as const } : {}),
              ...(pending.length ? { pending } : {}),
            }
          : c;
      });
  }
  /** Threads with a worktree on disk, each with when it settled and how long it keeps the worktree after. */
  cleanupCandidates(): CleanupCandidate[] {
    const onDisk = (c: ChatSummary) =>
      !!c.worktree?.path && !c.worktree.removedAt;
    const projectIds = new Set(
      (this.core.store.get().chats ?? [])
        .filter(onDisk)
        .map((c) => c.projectId),
    );
    const now = Date.now();
    return [...projectIds].flatMap((projectId) => {
      let project;
      try {
        project = this.core.projects.get(projectId);
      } catch {
        return [];
      }
      const { settings } = project;
      const { days, onCommit } = this.settling(settings);
      const keepDays =
        settings?.worktreeCleanupDays !== undefined
          ? settings.worktreeCleanupDays
          : this.worktreeCleanupDays();
      return this.live(projectId)
        .filter(onDisk)
        .map((chat) => ({
          chat,
          settledSince: settledSince(chat, now, days, onCommit),
          days: keepDays,
          checkout: project.path,
        }));
    });
  }
}
