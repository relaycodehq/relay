import { createHmac, randomUUID } from "node:crypto";
import { chatSettled } from "../../shared/chat-activity";
import {
  GUEST_SHARE_HOURS,
  type GuestPageView,
  type GuestReach,
  type GuestShare,
  type GuestShareEvent,
} from "../../shared/guest-share";
import type { ChatSummary, ProjectChat } from "../../shared/projects";
import type { SavedGuestShare } from "../app/store-types";
import { Funnel } from "./funnel";
import { GuestServer, TOKEN_PATTERN } from "./server";
import {
  guestSnapshot,
  type GuestSnapshot,
  type ThreadMedia,
} from "./snapshot";
import {
  guestsOwn,
  suggestionRefusal,
  waitingOf,
  withSuggestion,
} from "./suggestions";

export interface GuestSharesHost {
  thread(id: string): Promise<ProjectChat>;
  summary(id: string): ChatSummary | undefined;
  /** The folder the thread's agents work in; null when it's gone. */
  root(thread: ProjectChat): Promise<string | null>;
  media: ThreadMedia;
  renderPage(threadId: string, renderId: string, page: number): Promise<string>;
  /** Hears that threads may read differently; returns how to stop. */
  onSummaries(listener: () => void): () => void;
  send(event: GuestShareEvent): void;
  saved: {
    load(): SavedGuestShare[];
    save(shares: SavedGuestShare[]): Promise<void>;
  };
  /** The key links are signed with, made once for this Relay. */
  key(): Promise<Buffer>;
  /** The loopback port to try first; any free one does when it's taken. */
  port: number;
  now?: () => number;
  funnel?: Funnel;
}

/** A saved share with its token, live while Relay runs. */
interface Link extends SavedGuestShare {
  token: string;
  timer: NodeJS.Timeout;
}

/** A thread is read at most this often however many guests follow it. */
const SNAPSHOT_MS = 1000;

/**
 * The threads shared with guests. Each link's token is an HMAC of its share
 * under a key kept for this Relay, so links survive a restart without any
 * token being saved. A link ends when it's stopped, its thread is settled or
 * archived, or after GUEST_SHARE_HOURS.
 */
export class GuestShares {
  private links = new Map<string, Link>();
  private threadLinks = new Map<string, Link>();
  private snapshots = new Map<
    string,
    { at: number; snapshot: Promise<GuestSnapshot> }
  >();

  private server = new GuestServer({
    live: (token) => this.liveLink(token),
    snapshot: (link) => this.snapshot(link),
    page: (link, guestId) => this.pageView(link, guestId),
    suggest: (link, input) => this.suggest(link, input),
    renderPage: (link, renderId, page) =>
      this.host.renderPage(link.threadId, renderId, page),
  });

  private funnel: Funnel;
  /** Where the internet reaches the server, once Funnel opened it. */
  private reach?: Promise<GuestReach>;
  private now: () => number;
  private stopListening?: () => void;
  /** Links saved before this run, coming back; starting a share waits for it. */
  readonly restored: Promise<void>;

  constructor(private host: GuestSharesHost) {
    this.funnel = host.funnel ?? new Funnel();
    this.now = host.now ?? Date.now;
    this.restored = this.restore().catch((e) =>
      console.warn("Could not bring guest links back:", e),
    );
  }

  async share(threadId: string): Promise<GuestShare | null> {
    await this.restored;
    const link = this.threadLinks.get(threadId);
    return link && this.liveLink(link.token) ? this.describe(link) : null;
  }

  async start(threadId: string): Promise<GuestShare> {
    await this.restored;
    if (!this.host.summary(threadId)) throw new Error("That thread is gone.");
    await this.listen();
    let link = this.threadLinks.get(threadId);
    if (!link) {
      const startedAt = this.now();
      link = await this.add({
        id: randomUUID(),
        threadId,
        startedAt,
        endsAt: startedAt + GUEST_SHARE_HOURS * 3600_000,
        suggestions: [],
      });
      await this.persist();
    }
    const share = await this.describe(link);
    this.host.send({ kind: "share", threadId, share });
    return share;
  }

  async stop(threadId: string) {
    await this.restored;
    const link = this.threadLinks.get(threadId);
    if (!link) return;
    clearTimeout(link.timer);
    this.links.delete(link.token);
    this.threadLinks.delete(threadId);
    this.snapshots.delete(threadId);
    await this.persist();
    this.host.send({ kind: "share", threadId, share: null });
    this.host.send({ kind: "suggestions", threadId, suggestions: [] });
    if (!this.links.size) await this.close();
  }

  /** Stops serving, as Relay quits; the links come back with it. */
  async close() {
    this.stopListening?.();
    this.stopListening = undefined;
    this.reach = undefined;
    for (const link of this.links.values()) clearTimeout(link.timer);
    await Promise.all([this.funnel.close(), this.server.close()]);
  }

  waiting(threadId: string) {
    return waitingOf(this.threadLinks.get(threadId)?.suggestions ?? []);
  }

  async resolve(id: string, status: "drafted" | "dismissed") {
    const found = this.findSuggestion(id);
    if (found) await this.answer(found, status);
  }

  private findSuggestion(id: string) {
    for (const link of this.threadLinks.values()) {
      const suggestion = link.suggestions.find((s) => s.id === id);
      if (suggestion) return { link, suggestion };
    }
    return undefined;
  }

  private async answer(
    {
      link,
      suggestion,
    }: NonNullable<ReturnType<GuestShares["findSuggestion"]>>,
    status: "sent" | "drafted" | "dismissed",
  ) {
    suggestion.status = status;
    await this.persist();
    this.suggestionsChanged(link);
  }

  private async restore() {
    const live = this.host.saved.load().filter((s) => s.endsAt > this.now());
    for (const saved of live) await this.add(saved);
    if (live.length) await this.listen();
  }

  private async add(saved: SavedGuestShare) {
    const token = createHmac("sha256", await this.host.key())
      .update(saved.id)
      .digest("base64url");
    const link: Link = {
      ...saved,
      token,
      timer: setTimeout(
        () => void this.stop(saved.threadId),
        saved.endsAt - this.now(),
      ),
    };
    link.timer.unref();
    this.links.set(token, link);
    this.threadLinks.set(saved.threadId, link);
    return link;
  }

  private persist() {
    return this.host.saved.save(
      [...this.threadLinks.values()].map(
        ({ token: _, timer: __, ...saved }) => saved,
      ),
    );
  }

  private async listen() {
    await this.server.listen(this.host.port);
    this.watchThreads();
    await this.openFunnel();
  }

  /** Opens Funnel once; a refusal is asked again, as the user may have just turned it on. */
  private async openFunnel() {
    const reach = await this.reach;
    if (reach?.public) return;
    this.reach = this.funnel.open(this.server.port!);
    await this.reach;
  }

  private async describe(link: Link): Promise<GuestShare> {
    const reach = (await this.reach) ?? {
      public: false,
      reason: "Not shared.",
    };
    const path = `/g/${link.token}`;
    const snapshot = await this.snapshot(link).catch(() => undefined);
    return {
      threadId: link.threadId,
      reach: reach.public
        ? { public: true, url: `${reach.url}${path}` }
        : reach,
      localUrl: `http://127.0.0.1:${this.server.port}${path}`,
      startedAt: link.startedAt,
      endsAt: link.endsAt,
      contents: snapshot?.contents ?? {
        files: 0,
        bytes: 0,
        images: 0,
        videos: 0,
        renders: 0,
      },
    };
  }

  private liveLink(token: string) {
    if (!TOKEN_PATTERN.test(token)) return undefined;
    const link = this.links.get(token);
    if (!link || link.endsAt <= this.now()) return undefined;
    return link;
  }

  private snapshot(link: Link) {
    const cached = this.snapshots.get(link.threadId);
    if (cached && this.now() - cached.at < SNAPSHOT_MS) return cached.snapshot;
    const snapshot = (async () => {
      const thread = await this.host.thread(link.threadId);
      return guestSnapshot(
        thread,
        await this.host.root(thread),
        this.host.media,
        link.endsAt,
      );
    })();
    this.snapshots.set(link.threadId, { at: this.now(), snapshot });
    snapshot.catch(() => this.snapshots.delete(link.threadId));
    return snapshot;
  }

  private async pageView(link: Link, guestId: string): Promise<GuestPageView> {
    const { view } = await this.snapshot(link);
    return { ...view, suggestions: guestsOwn(link.suggestions, guestId) };
  }

  private suggest(
    link: Link,
    input: { guestId: string; name: string; text: string },
  ) {
    const refused = suggestionRefusal(link.suggestions, input.guestId);
    if (refused) return refused;
    link.suggestions = withSuggestion(
      link.suggestions,
      link.threadId,
      input,
      this.now(),
    );
    void this.persist();
    this.suggestionsChanged(link);
    return undefined;
  }

  private suggestionsChanged(link: Link) {
    this.host.send({
      kind: "suggestions",
      threadId: link.threadId,
      suggestions: waitingOf(link.suggestions),
    });
  }

  /** Ends the link of a thread settled or archived after it was shared. */
  private watchThreads() {
    if (this.stopListening) return;
    this.stopListening = this.host.onSummaries(() => {
      for (const link of [...this.threadLinks.values()])
        if (this.linkShouldEnd(link)) void this.stop(link.threadId);
    });
  }

  private linkShouldEnd(link: Link) {
    const thread = this.host.summary(link.threadId);
    if (!thread || thread.archivedAt) return true;
    const settledByHand = !thread.settleWhenDone && chatSettled(thread);
    return settledByHand && thread.settledAt! >= link.startedAt;
  }
}

export type { Link as GuestLink };
