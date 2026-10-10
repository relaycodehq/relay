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
import { contextAgent } from "../../shared/recipient";
import { notesMark } from "../../shared/thread-notes";
import { keyedQueue } from "../util/keyed-queue";
import type { Store } from "../app/store";
import { RenderFiles } from "../html-renders";
import { imageMimeType } from "./images";
import { reviveChat } from "./revive";

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
  handover,
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
  return {
    ...summary,
    providers,
    ...(provider ? { provider } : {}),
    ...(holder ? { contextAgent: holder } : {}),
    ...(next ? { nextSend: next } : {}),
    ...(mark ? { queueMark: mark } : {}),
    ...(notesAt ? { notesMark: notesAt } : {}),
    ...(open ? { asking: true as const } : {}),
    empty: !messages.length && !scheduled?.length,
  };
}

/** Whether two summaries read alike once saved, whatever order or undefined keys they hold. */
function same(a: ChatSummary, b: ChatSummary) {
  const plain = (summary: ChatSummary) => JSON.parse(JSON.stringify(summary));
  return isDeepStrictEqual(plain(a), plain(b));
}

/** Threads saved this long before the store was are read back too, in case other store writes queued ahead of theirs. */
const RECONCILE_MARGIN_MS = 5000;

/**
 * The threads' files in Relay's data folder (`<id>.json` and their
 * screenshots under `images/<id>/`), the one cached copy of each, and their
 * summaries in the store, with whoever listens for a list reading differently.
 */
export class ChatStorage {
  private cache = new Map<string, ProjectChat>();
  private loading = new Map<string, Promise<void>>();
  private writes = keyedQueue();
  /** Loads wait for the agent host's sessions, so none of their answers is failed first. */
  private ready: Promise<void> = Promise.resolve();
  private listeners = new Set<(projectId: string) => void>();
  /** The pages answers showed with show_html. */
  readonly renders: RenderFiles;
  constructor(
    private store: Store,
    private dir: string,
    /** The answer's session is still in the turn a restart cut off. */
    private resuming: (chatId: string, branch?: string) => boolean,
  ) {
    this.renders = new RenderFiles(join(dir, "renders"));
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
    if (!this.cache.has(id)) {
      let pending = this.loading.get(id);
      if (!pending) {
        pending = (async () => {
          const chat = JSON.parse(
            await readFile(join(this.dir, id + ".json"), "utf8"),
          ) as ProjectChat;
          if (chat.id !== id)
            throw new Error("Saved chat identity does not match.");
          this.readLinks(chat);
          const changed = reviveChat(chat, (m) =>
            this.resuming(chat.id, m.parentId ?? undefined),
          );
          if (changed) await this.save(chat);
          this.cache.set(id, chat);
        })();
        this.loading.set(id, pending);
      }
      try {
        await pending;
      } finally {
        if (this.loading.get(id) === pending) this.loading.delete(id);
      }
    }
    const chat = this.cache.get(id)!;
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
    return this.cache.get(id);
  }

  keep(chat: ProjectChat) {
    this.cache.set(chat.id, chat);
  }

  /** A new thread: saved, listed, and cached. */
  async add(chat: ProjectChat) {
    await this.save(chat);
    await this.addSummary(chat);
    this.cache.set(chat.id, chat);
  }

  /** Takes back a thread that was added but never shown, like a reviewer whose review didn't start. */
  async remove(chat: ProjectChat) {
    this.cache.delete(chat.id);
    await this.writes(chat.id, () =>
      rm(join(this.dir, chat.id + ".json"), { force: true }),
    );
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
    await this.writes(chat.id, async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = path + "." + randomUUID() + ".tmp";
      await writeFile(tmp, value, { mode: 0o600 });
      await rename(tmp, path);
    });
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
      this.cache.delete(id);
      await rm(join(this.dir, id + ".json"), { force: true }).catch((e) =>
        console.warn("Could not remove a retired thinker thread:", e),
      );
    }
    await this.store.update((s) => {
      s.chats = (s.chats ?? []).filter((c) => !isThinker(c));
    });
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
    const saved = await Promise.allSettled(
      [...this.cache.values()].map((chat) => this.save(chat)),
    );
    const failed = saved.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    await Promise.all(this.busy().writes);
  }

  onSummaries(listener: (projectId: string) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
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
      this.cache.get(id)?.projectId ??
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
