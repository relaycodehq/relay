import type {
  AwayThread,
  ComputersOverview,
  HandoffRemoteStatus,
  HandoffView,
} from "../../shared/handoff";
import type { ChatSummary } from "../../shared/projects";
import { inputBlocksThread } from "../../shared/thread-state";
import type { Store } from "../app/store";
import type { Projects } from "../projects/projects";
import { ComputerInfos, outdated } from "./computer-infos";
import { computerName, type Computers } from "./computers";

type SentTo = NonNullable<ChatSummary["sentTo"]>;

/**
 * How the threads this computer handed off stand on the computers that have
 * them, asked at most every `statusMs`: what the sidebar's cards and
 * Settings → Computers show.
 */
export class RemoteStatuses {
  private statuses = new Map<
    string,
    { at: number; status: HandoffRemoteStatus | null }
  >();

  constructor(
    private store: Store,
    private computers: Computers,
    private projects: Projects,
    private infos: ComputerInfos,
    private statusMs: number,
  ) {}

  /** The last known status, however old. */
  known(id: string) {
    return this.statuses.get(id)?.status;
  }

  forget(id: string) {
    this.statuses.delete(id);
  }

  /** The other computer's view of the thread, asked at most every few seconds. */
  async remote(sentTo: SentTo, fresh = false) {
    const cached = this.statuses.get(sentTo.id);
    if (!fresh && cached && Date.now() - cached.at < this.statusMs)
      return cached.status;
    const client = await this.computers.connected(sentTo.computerId);
    return this.remember(
      sentTo.id,
      (await client.call("handoffStatus", [sentTo.id]))[sentTo.id] ?? null,
    );
  }

  /** Every thread that's away, as its strip shows it, for the sidebar's cards. */
  async views(): Promise<Record<string, HandoffView>> {
    const away = await this.refresh(false);
    return Object.fromEntries(
      away.map((chat) => {
        const sentTo = chat.sentTo!;
        const remote = this.known(sentTo.id);
        const online = this.computers.status(sentTo.computerId) === "online";
        return [chat.id, { sentTo, online, ...(remote ? { remote } : {}) }];
      }),
    );
  }

  /** Each paired computer with the threads this one handed it, statuses fresh within seconds. */
  async overview(): Promise<ComputersOverview> {
    const away = await this.refresh(true);
    return {
      name: computerName(),
      computers: this.computers.list().map((c) => {
        const known =
          c.status === "online" ? this.infos.known(c.id) : undefined;
        const info = known?.info;
        return {
          ...c,
          ...(info ? { version: info.version, update: info.update } : {}),
          ...(known && outdated(info) ? { outdated: true } : {}),
          threads: away
            .filter((a) => a.sentTo!.computerId === c.id)
            .map((chat) => this.awayThread(chat)),
        };
      }),
    };
  }

  private awayThread(chat: ChatSummary): AwayThread {
    const sentTo = chat.sentTo!;
    const remote = this.known(sentTo.id);
    const state = sentTo.error
      ? "failed"
      : sentTo.state !== "away"
        ? sentTo.state
        : !remote
          ? "unknown"
          : inputBlocksThread(remote)
            ? "waiting"
            : remote.running
              ? "working"
              : remote.failed
                ? "stopped"
                : "finished";
    return {
      chatId: chat.id,
      projectId: chat.projectId,
      project: this.projectName(chat.projectId),
      title: remote?.title ?? chat.title,
      state,
      since:
        (state === "finished" || state === "stopped") && remote
          ? remote.updated
          : sentTo.at,
      ...(sentTo.error || remote?.failed
        ? { error: sentTo.error ?? remote?.failed }
        : {}),
      ...(sentTo.error && !sentTo.conflicts?.length
        ? { retry: sentTo.state === "sending" ? "send" : "return" }
        : {}),
    };
  }

  private projectName(id: string) {
    try {
      return this.projects.get(id).name;
    } catch {
      return "Removed project";
    }
  }

  /**
   * Asks each online computer about the threads it has from here, unless
   * they were asked about within seconds; `withInfo` asks its version too.
   * Returns the threads that are away.
   */
  private async refresh(withInfo: boolean) {
    const away = (this.store.get().chats ?? []).filter((c) => c.sentTo);
    await Promise.all(
      this.computers
        .list()
        .filter((c) => c.status === "online")
        .map(async (c) => {
          const ids = away
            .map((a) => a.sentTo!)
            .filter((s) => s.computerId === c.id && s.state !== "sending")
            .map((s) => s.id);
          const stale = ids.some(
            (id) =>
              Date.now() - (this.statuses.get(id)?.at ?? 0) > this.statusMs,
          );
          if (!stale && !withInfo) return;
          try {
            const client = await this.computers.connected(c.id);
            if (withInfo) await this.infos.get(c.id, client);
            if (!stale) return;
            const found = await client.call("handoffStatus", ids);
            for (const id of ids) this.remember(id, found[id] ?? null);
          } catch {
            // Offline after all; the last known states stand.
          }
        }),
    );
    return away;
  }

  /** The other computer's clock stays there: how long its turn ran becomes since when, here. */
  private remember(id: string, status: HandoffRemoteStatus | null) {
    const at = Date.now();
    this.statuses.set(id, {
      at,
      status:
        status?.runningFor === undefined
          ? status
          : { ...status, runningSince: at - status.runningFor },
    });
    return this.statuses.get(id)!.status;
  }
}
