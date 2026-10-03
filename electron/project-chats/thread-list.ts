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
import { sentAgent } from "../../shared/recipient";
import type { ActiveChat } from "./active";
import type { ChatCore } from "./core";
import type { CleanupCandidate } from "./worktree-cleanup";

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
  /** The project's threads as saved, with what runs or waits in each now. */
  private live(projectId: string): ChatSummary[] {
    const chats = (this.core.store.get().chats ?? []).filter(
      (c) => c.projectId === projectId,
    );
    // A review runs while any of its reviewers does, a thread while its thinkers do.
    const helpers = new Map<string, ActiveChat[]>();
    for (const c of chats) {
      const parent = (c.reviewer ?? c.thinker)?.parent;
      const active = parent && this.core.active.get(c.id);
      if (active) helpers.set(parent, [...(helpers.get(parent) ?? []), active]);
    }
    // Once for the list: it is read on every change to any of its threads.
    const live = this.core.sessions.pending();
    return chats
      .filter((c) => !c.reviewer && !c.thinker)
      .sort((a, b) => b.updated - a.updated)
      .map((c) => {
        const crew = [
          this.core.active.get(c.id),
          ...(helpers.get(c.id) ?? []).sort((a, b) => a.started - b.started),
          // A stopped answer reads as stopped while its agent winds down.
        ].filter((a): a is ActiveChat => !!a && !a.stopping);
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
        return active || pending.length
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
