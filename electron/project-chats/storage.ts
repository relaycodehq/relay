import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  ChatImage,
  ChatMessage,
  ChatSummary,
  ProjectChat,
  ProjectChatSend,
  ScheduledChatMessage,
} from "../../shared/projects";
import { reviewFolder } from "../../shared/projects";
import { reviewerTitle } from "../../shared/deep-review";
import { contextAgent } from "../../shared/recipient";
import { notesMark } from "../../shared/thread-notes";
import { keyedQueue } from "../util/keyed-queue";
import type { Store } from "../app/store";
import { RenderFiles } from "../html-renders";
import { imageMimeType } from "./images";
import {
  liveTurn,
  savedBase,
  withLiveTurn,
  type LiveTurn,
  type SavedBase,
} from "./live-turn";
import { reviveChat } from "./revive";
import { migrateReviewRounds } from "../deep-review";
import { latestReview } from "../../shared/deep-review";
import { ShownImages } from "./shown-images";
import { writeFileAtomic } from "../util/atomic-write";

/** The earliest scheduled message still waiting to go out on its own. */
export function nextSend(scheduled: ScheduledChatMessage[] = []) {
  const times = scheduled.filter((s) => !s.error).map((s) => s.at);
  return times.length ? Math.min(...times) : undefined;
}

/** A short mark of what waits in the thread's queue and Send later list; none when nothing does. */
export function queueMark({
  queue,
  queuePaused,
  scheduled,
}: Pick<ProjectChat, "queue" | "queuePaused" | "scheduled">) {
  if (!queue?.length && !scheduled?.length) return undefined;
  const waiting = JSON.stringify([
    (queue ?? []).map((q) => [q.input.id, q.error ?? ""]),
    !!queuePaused,
    (scheduled ?? []).map((s) => [s.input.id, s.at, s.error ?? ""]),
  ]);
  return createHash("sha1").update(waiting).digest("base64url").slice(0, 10);
}

/** A question the agent asked in the thread is still open. */
export const asksYou = (messages: ProjectChat["messages"]) =>
  messages.some((m) =>
    m.questions?.some((group) => !group.answers && !group.dismissed),
  );

/** What the sidebar lists of a thread: everything but its conversation and the state behind it. */
export function chatSummary({
  messages,
  requests,
  queue,
  queuePaused,
  scheduled,
  lastInput,
  sessions,
  forkedAt,
  replySessions,
  checkoutNotes,
  scopeHeard,
  movedIn,
  setupNote,
  reviews,
  findings: _findings,
  handover,
  outbox,
  carriedIds,
  notes,
  setup,
  // Worked out below; a stale copy on the thread itself doesn't count.
  queueMark: _staleMark,
  notesMark: _staleNotesMark,
  setupMark: _staleSetupMark,
  asking,
  ...summary
}: ProjectChat): ChatSummary {
  const provider = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.provider;
  const holder = contextAgent(messages.filter((m) => !m.parentId));
  const providers = [
    ...new Set(
      [...messages]
        .reverse()
        .flatMap((m) =>
          m.role === "assistant" && m.provider ? [m.provider] : [],
        ),
    ),
  ];
  const next = nextSend(scheduled);
  const mark = queueMark({ queue, queuePaused, scheduled });
  const notesAt = notesMark(notes);
  const open = asksYou(messages);
  const review = reviewFolder({ reviews });
  return {
    ...summary,
    providers,
    ...(provider ? { provider } : {}),
    ...(holder ? { contextAgent: holder } : {}),
    ...(next ? { nextSend: next } : {}),
    ...(mark ? { queueMark: mark } : {}),
    ...(notesAt ? { notesMark: notesAt } : {}),
    ...(setup ? { setupMark: `${setup.state}:${setup.at}` } : {}),
    ...(open ? { asking: true as const } : {}),
    ...(review ? { reviewFolder: review } : {}),
    ...(latestReview({ reviews })?.status === "reviewing"
      ? { reviewing: true as const }
      : {}),
    empty: !messages.length && !scheduled?.length,
  };
}

/** Whether two summaries read alike once saved, whatever order or undefined keys they hold. */
function same(a: ChatSummary, b: ChatSummary) {
  const plain = (summary: ChatSummary) => JSON.parse(JSON.stringify(summary));
  return isDeepStrictEqual(plain(a), plain(b));
}

/**
 * Threads used lately stay loaded; older ones are let go of, at ~1MB of heap
 * per MB of thread file.
 */
const KEEP_LOADED = 12;

/** Threads saved this long before the store was are read back too, in case other store writes queued ahead of theirs. */
const RECONCILE_MARGIN_MS = 5000;

/**
 * The threads' files in Relay's data folder (`<id>.json`, a running turn's
 * progress over it in `<id>.live.json` (see ./live-turn), their screenshots
 * under `images/<id>/` and copies of the images their answers show under
 * `images/<id>/shown/<message id>/`), the one cached copy of each, and their
 * summaries in the store, with whoever listens for a list reading differently.
 *
 * A thread let go of stays the one copy while anything still holds it, like a
 * running turn, so no two copies of a thread ever take turns writing it.
 */
export class ChatStorage {
  /** The threads used lately, least recent first. */
  private cache = new Map<string, ProjectChat>();
  private released = new Map<string, WeakRef<ProjectChat>>();
  /** Threads this session held: one read back after being let go of left nothing running behind it. */
  private held = new Set<string>();
  /** Saves still writing, and threads whose last save failed: kept until on disk. */
  private saving = new Map<string, number>();
  private unsaved = new Set<string>();
  private loading = new Map<string, Promise<ProjectChat>>();
  private writes = keyedQueue();
  /** Loads wait for the agent host's sessions, so none of their answers is failed first. */
  private ready: Promise<void> = Promise.resolve();
  private listeners = new Set<(projectId: string) => void>();
  private savedListeners = new Set<(chat: ProjectChat) => void>();
  /** What each loaded thread's file holds, for its checkpoints to write only what changed since. */
  private bases = new WeakMap<ProjectChat, SavedBase>();
  private lastRev = 0;
  /** The pages answers showed with show_html. */
  readonly renders: RenderFiles;
  readonly shown: ShownImages;
  constructor(
    private store: Store,
    private dir: string,
    /** The answer's session is still in the turn a restart cut off. */
    private resuming: (chatId: string, branch?: string) => boolean,
  ) {
    this.renders = new RenderFiles(join(dir, "renders"));
    this.shown = new ShownImages(join(dir, "images"));
  }

  /** Loads wait for `ready` from here on. */
  waitFor(ready: Promise<void>) {
    this.ready = ready;
  }

  /** The store lists the thread. */
  has(id: string) {
    return !!this.store.get().chats?.some((c) => c.id === id);
  }

  /** The cached chat itself, read from disk the first time; never hand it out. */
  async load(id: string): Promise<ProjectChat> {
    await this.ready;
    if (!this.has(id)) throw new Error("Chat not found.");
    let chat = this.cached(id);
    if (chat) this.use(chat);
    else {
      let pending = this.loading.get(id);
      if (!pending) {
        pending = (async () => {
          // Behind the writes, which a copy let go of may have left queued.
          const { chat, base } = await this.writes(id, () => this.read(id));
          if (base) this.bases.set(chat, base);
          this.readLinks(chat);
          const changed = reviveChat(
            chat,
            (m) => this.resuming(chat.id, m.parentId ?? undefined),
            !this.held.has(id),
            (other) => this.resuming(other),
          );
          if (changed) await this.save(chat);
          this.use(chat);
          return chat;
        })();
        this.loading.set(id, pending);
      }
      try {
        chat = await pending;
      } finally {
        if (this.loading.get(id) === pending) this.loading.delete(id);
      }
    }
    this.readLinks(chat);
    return chat;
  }

  /** The thread as its files have it, without keeping it loaded; the loaded copy if it is. */
  async peek(id: string): Promise<ProjectChat> {
    return this.cached(id) ?? (await this.read(id)).chat;
  }

  private file(id: string, live = false) {
    return join(this.dir, id + (live ? ".live.json" : ".json"));
  }

  /** The thread's file with the progress of a turn that was running over it, and what the file itself held. */
  private async read(id: string) {
    const [text, liveText] = await Promise.all([
      readFile(this.file(id), "utf8"),
      readFile(this.file(id, true), "utf8").catch(() => undefined),
    ]);
    const { rev, ...saved } = JSON.parse(text) as ProjectChat & {
      rev?: number;
    };
    if (saved.id !== id) throw new Error("Saved chat identity does not match.");
    let live: LiveTurn | undefined;
    try {
      live = liveText ? (JSON.parse(liveText) as LiveTurn) : undefined;
    } catch (e) {
      // Cut off mid-write it can't be: it's renamed into place whole.
      console.warn("Could not read a thread's last turn:", e);
    }
    const chat = withLiveTurn(saved, rev, live);
    migrateReviewRounds(chat);
    return {
      chat,
      base: rev ? savedBase(saved, rev, text.length) : undefined,
    };
  }

  /** Link scopes are authoritative in the state file so promotions commit atomically. */
  private readLinks(chat: ProjectChat) {
    const listed = this.store.get().chats?.find((c) => c.id === chat.id);
    if (!listed) return;
    if (listed.links) chat.links = structuredClone(listed.links);
    else delete chat.links;
  }

  /** The chat if it's loaded already. */
  cached(id: string) {
    const chat = this.cache.get(id) ?? this.released.get(id)?.deref();
    if (!chat) this.released.delete(id);
    return chat;
  }

  keep(chat: ProjectChat) {
    this.use(chat);
  }

  /** Marks the thread used now, letting go of the least recent past the limit. */
  private use(chat: ProjectChat) {
    this.held.add(chat.id);
    this.released.delete(chat.id);
    this.cache.delete(chat.id);
    this.cache.set(chat.id, chat);
    for (const [id, old] of this.cache) {
      if (this.cache.size <= KEEP_LOADED) break;
      if (this.saving.has(id) || this.unsaved.has(id)) continue;
      this.cache.delete(id);
      this.released.set(id, new WeakRef(old));
    }
  }

  private forget(id: string) {
    this.cache.delete(id);
    this.released.delete(id);
    this.held.delete(id);
  }

  /** A new thread: saved, listed, and cached. */
  async add(chat: ProjectChat) {
    await this.save(chat);
    await this.addSummary(chat);
    this.use(chat);
  }

  /** Takes back a thread that was added but never shown, like a reviewer whose review didn't start. */
  async remove(chat: ProjectChat) {
    this.forget(chat.id);
    await this.writes(chat.id, async () => {
      await rm(this.file(chat.id), { force: true });
      await rm(this.file(chat.id, true), { force: true });
    });
    await rm(join(this.dir, "images", chat.id), {
      recursive: true,
      force: true,
    }).catch((e) =>
      console.warn("Could not remove a dropped thread's images:", e),
    );
    // Its kept subagents; see ./subagent-archive.
    await rm(join(this.dir, "subagents", chat.id + ".json"), {
      force: true,
    }).catch(() => {});
    await this.store.update((s) => {
      s.chats = (s.chats ?? []).filter((c) => c.id !== chat.id);
    });
    this.summariesChanged(chat.projectId);
  }

  /**
   * Writes the thread, and its sidebar summary when that reads differently
   * now, so no caller has to remember which of its changes the sidebar shows.
   * `holdSummary` leaves the summary for a later `syncSummary`, where it
   * mustn't move yet.
   */
  async save(chat: ProjectChat, { holdSummary = false } = {}) {
    // Links belong to the state-file transaction, not a second persisted copy.
    const { links: _, ...record } = chat;
    this.lastRev = Math.max(Date.now(), this.lastRev + 1);
    const rev = this.lastRev;
    const value = JSON.stringify({ ...record, rev });
    // Checkpoints from here on build on this file, even before it's written:
    // theirs queue behind it.
    this.bases.set(chat, savedBase(chat, rev, value.length));
    await this.persist(chat, holdSummary, async () => {
      await this.replace(this.file(chat.id), value);
      // The file now has all of the turn the live file had.
      await rm(this.file(chat.id, true), { force: true });
    });
  }

  /**
   * Keeps a running turn's progress: what changed since the thread's last
   * full save, mostly the turn's answer, goes to `<id>.live.json` rather than
   * the thread being rewritten whole. A full save takes over without a file
   * to build on, or once the turn changed a good part of the thread.
   */
  async checkpoint(chat: ProjectChat) {
    const base = this.bases.get(chat);
    const live = base && JSON.stringify(liveTurn(chat, base));
    if (!live || live.length > base.bytes / 4) return this.save(chat);
    await this.persist(chat, false, () =>
      this.replace(this.file(chat.id, true), live),
    );
  }

  private async replace(path: string, value: string) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(path, value);
  }

  private async persist(
    chat: ProjectChat,
    holdSummary: boolean,
    write: () => Promise<void>,
  ) {
    const id = chat.id;
    this.saving.set(id, (this.saving.get(id) ?? 0) + 1);
    try {
      await this.writes(id, write);
      this.unsaved.delete(id);
    } catch (e) {
      // Kept loaded, so flush can retry what only lives in memory, in full.
      this.unsaved.add(id);
      this.bases.delete(chat);
      if (this.cached(id) === chat) this.use(chat);
      throw e;
    } finally {
      const left = this.saving.get(id)! - 1;
      if (left) this.saving.set(id, left);
      else this.saving.delete(id);
    }
    for (const listener of this.savedListeners) listener(chat);
    if (!holdSummary) await this.syncSummary(chat);
  }

  /** Brings the listed summary up to the thread, writing the store only if they differ. */
  async syncSummary(chat: ProjectChat) {
    this.readLinks(chat);
    const listed = this.store.get().chats?.find((c) => c.id === chat.id);
    // A thread that isn't listed yet is `add`ed, or was taken back.
    if (!listed || same(listed, chatSummary(chat))) return;
    await this.store.update((s) => {
      const index = s.chats!.findIndex((c) => c.id === chat.id);
      if (index >= 0) {
        // A queued metadata write must not undo a link transaction that ran first.
        s.chats![index] = {
          ...chatSummary(chat),
          links: s.chats![index].links,
        };
      }
    });
    this.summariesChanged(chat.projectId);
  }

  /**
   * After a crash between a thread's file and its summary, the summary reads
   * the older of the two. Reads only the threads saved since the store was,
   * the other files being too many to parse at launch. Older summaries missing
   * the agent history are backfilled once from their conversations too.
   */
  async reconcile(storeSavedAt: number) {
    await this.dropThinkers();
    await this.adoptReviewers();
    const listed = this.store.get().chats ?? [];
    const recent = await Promise.all(
      listed.map(async ({ id, providers }) => {
        if (!providers) return id;
        const [saved, live] = await Promise.all(
          [this.file(id), this.file(id, true)].map((path) =>
            stat(path).catch(() => undefined),
          ),
        );
        const at = Math.max(saved?.mtimeMs ?? 0, live?.mtimeMs ?? 0);
        return at > storeSavedAt - RECONCILE_MARGIN_MS ? id : undefined;
      }),
    );
    for (const id of recent) {
      if (!id) continue;
      try {
        await this.syncSummary(await this.load(id));
      } catch {
        // An unreadable thread surfaces when it is opened.
      }
    }
  }

  /** Ultraplan is gone; the hidden threads its thinkers worked in would only show up as strays. */
  private async dropThinkers() {
    const isThinker = (c: object) => !!(c as { thinker?: unknown }).thinker;
    const strays = (this.store.get().chats ?? []).filter(isThinker);
    if (!strays.length) return;
    for (const { id } of strays) {
      this.forget(id);
      await Promise.all(
        [this.file(id), this.file(id, true)].map((path) =>
          rm(path, { force: true }).catch((e) =>
            console.warn("Could not remove a retired thinker thread:", e),
          ),
        ),
      );
    }
    await this.store.update((s) => {
      s.chats = (s.chats ?? []).filter((c) => !isThinker(c));
    });
  }

  /**
   * Deep reviewers once worked in hidden threads; now they're listed under
   * their review, as threads its agent started are. Older ones join it the
   * same way, named for what they ran on and settled with it if it is, so
   * an old review doesn't come back to Activity with them. One whose review
   * is gone stays unlisted.
   */
  private async adoptReviewers() {
    const listed = this.store.get().chats ?? [];
    const byId = new Map(listed.map((c) => [c.id, c]));
    // Read without caching: a long history of reviews needn't sit in memory.
    const read = (id: string) => this.peek(id);
    for (const stray of listed) {
      const review = stray.reviewer && byId.get(stray.reviewer.parent);
      if (!review || stray.startedBy) continue;
      try {
        const [parent, chat] = await Promise.all([
          read(review.id),
          read(stray.id),
        ]);
        // Reviewers from before rounds all belong to the first one.
        const state = parent.reviews?.[0];
        const slot = chat.reviewer?.slot ?? -1;
        const reviewer = state?.reviewers[slot];
        chat.startedBy = {
          chatId: parent.id,
          agent: state?.lead.provider ?? review.provider ?? "claude",
        };
        if (reviewer?.chatId === chat.id)
          chat.title = reviewerTitle(slot, reviewer);
        if (review.settledAt && !chat.settledAt)
          chat.settledAt = review.settledAt;
        await this.save(chat);
      } catch (e) {
        console.warn("Could not list an older reviewer under its review:", e);
      }
    }
  }

  async addSummary(chat: ProjectChat) {
    await this.store.update((s) => {
      (s.chats ??= []).push(chatSummary(chat));
    });
    this.summariesChanged(chat.projectId);
  }

  /** Writes still going to disk, and threads still being read. */
  busy() {
    return { writes: this.writes.pending(), loads: [...this.loading.values()] };
  }

  /** Retry cached data too: a failed write may already have left the queue. */
  async flush() {
    await Promise.all(this.busy().loads);
    const loaded = [...this.cache.values()];
    for (const ref of this.released.values()) {
      const chat = ref.deref();
      if (chat) loaded.push(chat);
    }
    const saved = await Promise.allSettled(
      loaded.map((chat) => this.save(chat)),
    );
    const failed = saved.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    await Promise.all(this.busy().writes);
  }

  onSummaries(listener: (projectId: string) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Hears every thread written to disk, the cached copy itself: read it, never change it. */
  onSaved(listener: (chat: ProjectChat) => void) {
    this.savedListeners.add(listener);
    return () => void this.savedListeners.delete(listener);
  }

  /** Says a project's list may read differently; every project's, given none. */
  summariesChanged(projectId?: string) {
    const ids = projectId
      ? [projectId]
      : new Set((this.store.get().chats ?? []).map((c) => c.projectId));
    for (const id of ids) for (const listener of this.listeners) listener(id);
  }

  chatChanged(id: string) {
    const projectId =
      this.cached(id)?.projectId ??
      this.store.get().chats?.find((c) => c.id === id)?.projectId;
    if (projectId) this.summariesChanged(projectId);
  }

  /** The complete saved conversation, readable by a fresh agent in chunks. */
  historyPath(chatId: string) {
    return this.file(chatId);
  }

  imagePath(chatId: string, image: ChatImage) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        image.id,
      )
    )
      throw new Error("Invalid saved screenshot identity.");
    const ext =
      image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1];
    return join(this.dir, "images", chatId, `${image.id}.${ext}`);
  }

  /** A thread's screenshot as a data URL. */
  async image(chatId: string, image: ChatImage) {
    const bytes = await readFile(this.imagePath(chatId, image));
    return `data:${image.mimeType};base64,${bytes.toString("base64")}`;
  }

  async saveImages(
    chatId: string,
    images: NonNullable<ProjectChatSend["images"]>,
  ) {
    const checked = images.map(({ name, mimeType, dataUrl, browser }) => {
      const bytes = Buffer.from(
        dataUrl.slice(dataUrl.indexOf(",") + 1),
        "base64",
      );
      if (imageMimeType(bytes) !== mimeType || bytes.length > 800_000)
        throw new Error("Screenshot is invalid or exceeds the 800 KB limit.");
      return {
        meta: {
          id: randomUUID(),
          name,
          mimeType,
          sizeBytes: bytes.length,
          ...(browser ? { browser } : {}),
        } as ChatImage,
        bytes,
      };
    });
    await this.imageFolder(chatId);
    for (const { meta, bytes } of checked)
      await writeFile(this.imagePath(chatId, meta), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    return checked.map(({ meta }) => meta);
  }

  /** A fork's copies of the screenshots its messages carry over. */
  async copyImages(from: string, to: string, messages: ChatMessage[]) {
    const images = messages.flatMap((m) => m.images ?? []);
    if (!images.length) return;
    await this.imageFolder(to);
    for (const image of images)
      await copyFile(this.imagePath(from, image), this.imagePath(to, image));
  }

  private imageFolder(chatId: string) {
    return mkdir(join(this.dir, "images", chatId), {
      recursive: true,
      mode: 0o700,
    });
  }
}
