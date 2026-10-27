import { createHash, createHmac, randomUUID } from "node:crypto";
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
  /** The thread as it is now; messages unchanged since `previous` may be its own objects. */
  thread(id: string, previous?: ProjectChat): Promise<ProjectChat>;
  summary(id: string): ChatSummary | undefined;
  /** The folder the thread's agents work in; null when it's gone. */
  root(thread: ProjectChat): Promise<string | null>;
  media: ThreadMedia;
  renderPage(threadId: string, renderId: string, page: number): Promise<string>;
  /** Hears that threads may read differently; returns how to stop. */
  onSummaries(listener: () => void): () => void;
  send(event: GuestShareEvent): void;
  /** Runs a guest's message as a turn in the thread, in the guest's name. */
  sendAsGuest(threadId: string, name: string, text: string): Promise<void>;
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
/** An unchanged thread is shown from what was built this long ago; its files may change on disk meanwhile. */
const UNCHANGED_MS = 15_000;

/** A snapshot with what it was built from, to tell whether the thread changed since. */
interface Built {
  snapshot: GuestSnapshot;
  thread: ProjectChat;
  stamp: string;
  at: number;
}

/**
 * The threads shared with guests. Each link's token is an HMAC of its share
 * under a key kept for this Relay, so links survive a restart without any
 * token being saved. A link ends when it's stopped, its thread is settled,
 * archived or handed off, or after GUEST_SHARE_HOURS.
 */
export class GuestShares {
  private links = new Map<string, Link>();
  private threadLinks = new Map<string, Link>();
  /** Links being made, so a second start for the thread waits for the first's. */
  private making = new Map<string, Promise<Link>>();
  /** Suggestions on their way to the agent, which nothing else may answer meanwhile. */
  private sending = new Set<string>();
  /** Threads whose stopped link is still saved, as saving the stop failed; a retry saves it. */
  private stopsToSave = new Set<string>();
  private snapshots = new Map<string, { at: number; built: Promise<Built> }>();
  /** Each render's own address, so its page never sees the link's token. */
  private renderKeys = new Map<string, { token: string; renderId: string }>();
  /** Opening and closing the server, one at a time. */
  private serving: Promise<unknown> = Promise.resolve();

  private server = new GuestServer({
    live: (token) => this.liveLink(token),
    snapshot: (link) => this.snapshot(link),
    page: (link, guestId) => this.pageView(link, guestId),
    suggest: (link, input) => this.suggest(link, input),
    render: (key) => this.render(key),
    renderPage: (link, renderId, page) =>
      this.host.renderPage(link.threadId, renderId, page),
  });

  private funnel: Funnel;
  /** Where the internet reaches the server, once Funnel opened it. */
  private reach?: Promise<GuestReach>;
  private now: () => number;
  private stopListening?: () => void;
  /** Links saved before this run, coming back; anything touching links waits for it. */
  private restored: Promise<void>;
  /** Saved links that couldn't come back, as a refused Keychain prompt leaves them; saving keeps them. */
  private unrestored: SavedGuestShare[] = [];

  constructor(private host: GuestSharesHost) {
    this.funnel = host.funnel ?? new Funnel();
    this.now = host.now ?? Date.now;
    this.restored = this.restoreLogged();
  }

  async share(threadId: string): Promise<GuestShare | null> {
    await this.restored;
    const link = this.threadLinks.get(threadId);
    // Without a server, nothing answers the link; the next start opens one.
    const served = !!this.server.port;
    return link && served && this.liveLink(link.token)
      ? this.describe(link)
      : null;
  }

  async start(threadId: string): Promise<GuestShare> {
    await this.restored;
    // Starting asks for the key anyway, so it asks for the links it kept away too.
    if (this.unrestored.length) {
      this.restored = this.restoreLogged();
      await this.restored;
    }
    if (!this.host.summary(threadId)) throw new Error("That thread is gone.");
    // Made before the server opens, so a stop of another link can't close it under this one.
    const link = await this.linkOf(threadId);
    await this.listen().catch(async (e) => {
      // A link nothing serves would show as shared.
      await this.stop(threadId).catch(() => {});
      throw e;
    });
    const share = await this.describe(link);
    this.host.send({ kind: "share", threadId, share });
    return share;
  }

  /** The thread's link, made once however many starts ask for it at the same time. */
  private async linkOf(threadId: string) {
    const link = this.threadLinks.get(threadId);
    if (link && this.liveLink(link.token)) return link;
    // Its end passed while the computer slept, so its timer hasn't fired yet.
    if (link) await this.stop(threadId);
    const making = this.making.get(threadId) ?? this.newLink(threadId);
    this.making.set(threadId, making);
    try {
      return await making;
    } finally {
      this.making.delete(threadId);
    }
  }

  private async newLink(threadId: string) {
    const startedAt = this.now();
    const link = await this.add({
      id: randomUUID(),
      threadId,
      startedAt,
      endsAt: startedAt + GUEST_SHARE_HOURS * 3600_000,
      suggestions: [],
    });
    await this.persist();
    return link;
  }

  async stop(threadId: string) {
    await this.restored;
    const link = this.threadLinks.get(threadId);
    if (!link && !this.stopsToSave.has(threadId)) return;
    if (link) this.revoke(link);
    // Guests lose the link at once; until the stop is saved, a restart would bring it back.
    this.stopsToSave.add(threadId);
    await this.persist();
    this.stopsToSave.delete(threadId);
    this.host.send({ kind: "share", threadId, share: null });
    this.host.send({ kind: "suggestions", threadId, suggestions: [] });
    if (!this.links.size) await this.inTurn(() => this.closeWhenUnused());
  }

  private revoke(link: Link) {
    clearTimeout(link.timer);
    this.links.delete(link.token);
    this.threadLinks.delete(link.threadId);
    this.snapshots.delete(link.threadId);
    for (const [key, render] of this.renderKeys)
      if (render.token === link.token) this.renderKeys.delete(key);
  }

  /**
   * Stops serving; the links come back with the next start. Quitting needs
   * none of it: the server goes with the process, and Funnel takes its route
   * off as the process exits.
   */
  close() {
    return this.shutDown({ ended: false });
  }

  /** The last link ended: nothing is left to serve, unless a start got in first. */
  private async closeWhenUnused() {
    if (this.links.size || this.making.size) return;
    await this.shutDown({ ended: true });
  }

  /** `ended` tells the pages still open that their link is over. */
  private async shutDown({ ended }: { ended: boolean }) {
    this.stopListening?.();
    this.stopListening = undefined;
    this.reach = undefined;
    for (const link of this.links.values()) clearTimeout(link.timer);
    const [published] = await Promise.all([
      this.funnel.close(),
      ended && this.server.endStreams(),
    ]);
    // A route left up would publish whatever took the port next: the server keeps it, answering 404s.
    if (!published) await this.server.close();
  }

  /** Runs `job` once the server's earlier opening or closing is done. */
  private inTurn<T>(job: () => Promise<T>) {
    const run = this.serving.then(job);
    this.serving = run.catch(() => {});
    return run;
  }

  async waiting(threadId: string) {
    await this.restored;
    return waitingOf(this.threadLinks.get(threadId)?.suggestions ?? []);
  }

  /** Runs the suggestion as a turn in its guest's name. */
  async send(id: string) {
    await this.restored;
    const found = this.waitingSuggestion(id);
    if (!found) throw new Error("That suggestion was already answered.");
    this.sending.add(id);
    try {
      await this.host.sendAsGuest(
        found.link.threadId,
        found.suggestion.name,
        found.suggestion.text,
      );
    } finally {
      this.sending.delete(id);
    }
    await this.answer(found, "sent");
  }

  async resolve(id: string, status: "drafted" | "dismissed") {
    await this.restored;
    const found = this.waitingSuggestion(id);
    if (found) await this.answer(found, status);
  }

  /** A suggestion nobody has answered or started sending yet. */
  private waitingSuggestion(id: string) {
    if (this.sending.has(id)) return undefined;
    for (const link of this.threadLinks.values()) {
      const suggestion = link.suggestions.find((s) => s.id === id);
      if (suggestion?.status === "waiting") return { link, suggestion };
    }
    return undefined;
  }

  private async answer(
    {
      link,
      suggestion,
    }: NonNullable<ReturnType<GuestShares["waitingSuggestion"]>>,
    status: "sent" | "drafted" | "dismissed",
  ) {
    suggestion.status = status;
    await this.persist();
    this.suggestionsChanged(link);
  }

  private restoreLogged() {
    return this.restore().catch((e) =>
      console.warn("Could not bring guest links back:", e),
    );
  }

  private async restore() {
    const saved = this.host.saved.load();
    // Threads may have been archived, settled or deleted while Relay was closed.
    const live = saved.filter(
      (s) => s.endsAt > this.now() && !this.linkShouldEnd(s),
    );
    const missing = live.filter((s) => !this.threadLinks.has(s.threadId));
    this.unrestored = missing;
    for (const share of missing) await this.add(share);
    this.unrestored = [];
    if (live.length < saved.length) await this.persist();
    if (!live.length) return;
    for (const link of this.threadLinks.values())
      if (waitingOf(link.suggestions).length) this.suggestionsChanged(link);
    await this.inTurn(() => this.serve());
    // Tailscale can take half a minute to answer; nothing waits for it.
    void this.inTurn(() => this.openFunnel());
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
    const live = [...this.threadLinks.values()].map(
      ({ token: _, timer: __, ...saved }) => saved,
    );
    const kept = this.unrestored.filter(
      (s) => !this.threadLinks.has(s.threadId),
    );
    return this.host.saved.save([...live, ...kept]);
  }

  private listen() {
    return this.inTurn(async () => {
      await this.serve();
      await this.openFunnel();
    });
  }

  private async serve() {
    await this.server.listen(this.host.port);
    this.watchThreads();
  }

  /** Opens Funnel once; a refusal is asked again, as the user may have just turned it on. */
  private async openFunnel() {
    const reach = await this.reach;
    const port = this.server.port;
    if (reach?.public || !port) return;
    this.reach = this.funnel.open(port).catch((e): GuestReach => {
      console.warn("Could not open Tailscale Funnel:", e);
      return { public: false, reason: "Tailscale Funnel didn't answer." };
    });
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

  private async snapshot(link: Link) {
    const cached = this.snapshots.get(link.threadId);
    if (cached && this.now() - cached.at < SNAPSHOT_MS)
      return (await cached.built).snapshot;
    const entry = { at: this.now(), built: this.build(link, cached?.built) };
    this.snapshots.set(link.threadId, entry);
    entry.built.catch(() => {
      if (this.snapshots.get(link.threadId) === entry)
        this.snapshots.delete(link.threadId);
    });
    return (await entry.built).snapshot;
  }

  /** The thread as guests see it, built again only once it changed or has aged. */
  private async build(link: Link, previous?: Promise<Built>): Promise<Built> {
    const last = await previous?.catch(() => undefined);
    const thread = await this.host.thread(link.threadId, last?.thread);
    const stamp = threadStamp(thread);
    if (last?.stamp === stamp && this.now() - last.at < UNCHANGED_MS)
      return last;
    const snapshot = await guestSnapshot(
      thread,
      await this.host.root(thread),
      this.host.media,
      link.endsAt,
      (renderId) => this.renderKey(link, renderId),
    );
    return { snapshot, thread, stamp, at: this.now() };
  }

  private renderKey(link: Link, renderId: string) {
    const key = createHash("sha256")
      .update(`${link.token}\0render\0${renderId}`)
      .digest("base64url");
    this.renderKeys.set(key, { token: link.token, renderId });
    return key;
  }

  private render(key: string) {
    const render = this.renderKeys.get(key);
    const link = render && this.liveLink(render.token);
    return link && { link, renderId: render.renderId };
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
    this.persist().catch((e) =>
      console.warn("Could not save a guest's suggestion:", e),
    );
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

  /** Ends the link of a thread settled, archived or handed off after it was shared. */
  private watchThreads() {
    if (this.stopListening) return;
    this.stopListening = this.host.onSummaries(() => {
      for (const link of [...this.threadLinks.values()])
        if (this.linkShouldEnd(link)) void this.stop(link.threadId);
    });
  }

  private linkShouldEnd(link: SavedGuestShare) {
    const thread = this.host.summary(link.threadId);
    if (!thread || thread.archivedAt) return true;
    // Its turns run on the other computer now, and suggestions can't be sent from here.
    if (thread.sentTo || thread.cameFrom?.returnedAt) return true;
    const settledByHand = !thread.settleWhenDone && chatSettled(thread);
    return settledByHand && thread.settledAt! >= link.startedAt;
  }
}

/** What a guest could see change in the thread; cheap next to building its snapshot. */
const threadStamp = (thread: ProjectChat) =>
  JSON.stringify([
    thread.title,
    !!thread.running,
    thread.messages.map((m) => [m.id, m.version, m.status, m.body.length]),
  ]);

export type { Link as GuestLink };
