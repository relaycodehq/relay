import {
  copyFile,
  mkdir,
  readFile,
  rename,
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
import { reviveChat } from "./revive";
import { ShownImages } from "./shown-images";

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
  deepReview,
  findings: _findings,
  handover,
  outbox,
  carriedIds,
  notes,
  // Worked out below; a stale copy on the thread itself doesn't count.
  queueMark: _staleMark,
  notesMark: _staleNotesMark,
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
  const open = messages.some((m) =>
    m.questions?.some((group) => !group.answers && !group.dismissed),
  );
  const review = reviewFolder({ deepReview });
  return {
    ...summary,
    providers,
    ...(provider ? { provider } : {}),
    ...(holder ? { contextAgent: holder } : {}),
    ...(next ? { nextSend: next } : {}),
    ...(mark ? { queueMark: mark } : {}),
    ...(notesAt ? { notesMark: notesAt } : {}),
    ...(open ? { asking: true as const } : {}),
    ...(review ? { reviewFolder: review } : {}),
    ...(deepReview?.status === "reviewing" ? { reviewing: true as const } : {}),
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
 * The threads' files in Relay's data folder (`<id>.json`, their screenshots
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
          const text = await this.writes(id, () =>
            readFile(join(this.dir, id + ".json"), "utf8"),
          );
          const chat = JSON.parse(text) as ProjectChat;
          if (chat.id !== id)
            throw new Error("Saved chat identity does not match.");
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
    await this.writes(chat.id, () =>
      rm(join(this.dir, chat.id + ".json"), { force: true }),
    );
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
    const value = JSON.stringify(record),
      path = join(this.dir, chat.id + ".json");
    const id = chat.id;
    this.saving.set(id, (this.saving.get(id) ?? 0) + 1);
    try {
      await this.writes(id, async () => {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        const tmp = path + "." + randomUUID() + ".tmp";
        await writeFile(tmp, value, { mode: 0o600 });
        await rename(tmp, path);
      });
      this.unsaved.delete(id);
    } catch (e) {
      // Kept loaded, so flush can retry what only lives in memory.
      this.unsaved.add(id);
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
        const saved = await stat(join(this.dir, id + ".json")).catch(
          () => undefined,
        );
        return saved && saved.mtimeMs > storeSavedAt - RECONCILE_MARGIN_MS
          ? id
          : undefined;
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
      await rm(join(this.dir, id + ".json"), { force: true }).catch((e) =>
        console.warn("Could not remove a retired thinker thread:", e),
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
    const read = async (id: string) =>
      this.cached(id) ??
      (JSON.parse(
        await readFile(join(this.dir, id + ".json"), "utf8"),
      ) as ProjectChat);
    for (const stray of listed) {
      const review = stray.reviewer && byId.get(stray.reviewer.parent);
      if (!review || stray.startedBy) continue;
      try {
        const [parent, chat] = await Promise.all([
          read(review.id),
          read(stray.id),
        ]);
        const state = parent.deepReview;
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
    const checked = images.map(({ name, mimeType, dataUrl }) => {
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
