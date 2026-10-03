import type { ChatSummary } from "../../shared/projects";
import type { Repo } from "../../shared/types";

/** Where a sweep stops waiting for the Git host. */
const SWEEP_TIMEOUT_MS = 20_000;
/** An open thread asking again within this gets the last answer. */
const CHECK_EVERY_MS = 60_000;

export interface PullHost {
  chats(): readonly ChatSummary[];
  /** The project's repository on the signed-in Git host; null when signed out or not linked to it. */
  repository(projectId: string): Promise<Repo | null>;
  /** Which of a repository's pull requests were merged. */
  mergedAmong(
    repo: Repo,
    numbers: number[],
    signal: AbortSignal,
  ): Promise<number[]>;
  merged(repo: Repo, number: number): Promise<boolean>;
  /** Notes the thread's PR as merged, which settles it when nothing newer happened. */
  record(chatId: string): Promise<void>;
  online(): boolean;
  now?(): number;
}

/** A thread still waiting for its PR to land, so merging is news. */
function watching(chat: ChatSummary) {
  const worktree = chat.worktree;
  return (
    !!worktree?.pr &&
    !worktree.landed &&
    !chat.archivedAt &&
    !chat.reviewer &&
    !chat.thinker &&
    !(chat.settledAt != null && chat.settledAt >= chat.updated)
  );
}

/**
 * Notices a thread's PR merging on the Git host, for threads nobody has open
 * as well: the host's answer is the only place that is written down.
 */
export class PullMerges {
  private sweeping = false;
  private checked = new Map<string, { at: number; merged: boolean }>();
  constructor(private host: PullHost) {}

  private now() {
    return this.host.now?.() ?? Date.now();
  }

  /** One request per repository for every watching thread in it; skipped offline or signed out. */
  async sweep() {
    if (this.sweeping || !this.host.online()) return;
    this.sweeping = true;
    try {
      const byProject = new Map<string, ChatSummary[]>();
      for (const chat of this.host.chats())
        if (watching(chat))
          byProject.set(chat.projectId, [
            ...(byProject.get(chat.projectId) ?? []),
            chat,
          ]);
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), SWEEP_TIMEOUT_MS);
      try {
        for (const [projectId, chats] of byProject) {
          if (stop.signal.aborted) break;
          await this.sweepProject(projectId, chats, stop.signal).catch(
            () => {},
          );
        }
      } finally {
        clearTimeout(timer);
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async sweepProject(
    projectId: string,
    chats: ChatSummary[],
    signal: AbortSignal,
  ) {
    const repo = await this.host.repository(projectId);
    if (!repo) return;
    const merged = new Set(
      await this.host.mergedAmong(
        repo,
        [...new Set(chats.map((c) => c.worktree!.pr!.number))],
        signal,
      ),
    );
    for (const chat of chats)
      if (merged.has(chat.worktree!.pr!.number))
        await this.host.record(chat.id).catch(() => {});
  }

  /** Whether an open thread's PR merged, noted on the thread when it did; asked at most once a minute. */
  async check(chatId: string, number: number) {
    const seen = this.checked.get(chatId);
    if (seen && this.now() - seen.at < CHECK_EVERY_MS) return seen.merged;
    const chat = this.host.chats().find((c) => c.id === chatId);
    const repo =
      chat && this.host.online()
        ? await this.host.repository(chat.projectId).catch(() => null)
        : null;
    if (!repo) return false;
    const merged = await this.host.merged(repo, number).catch(() => false);
    this.checked.set(chatId, { at: this.now(), merged });
    if (merged) await this.host.record(chatId);
    return merged;
  }
}
