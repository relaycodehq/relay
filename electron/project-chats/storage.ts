import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ChatImage,
  ChatMessage,
  ChatSummary,
  ProjectChat,
  ProjectChatSend,
  ScheduledChatMessage,
} from "../../shared/projects";
import { contextAgent } from "../../shared/recipient";
import { keyedQueue } from "../keyed-queue";
import type { Store } from "../store";
import { imageMimeType } from "./images";
import { reviveChat } from "./revive";

/** The earliest scheduled message still waiting to go out on its own. */
export function nextSend(scheduled: ScheduledChatMessage[] = []) {
  const times = scheduled.filter((s) => !s.error).map((s) => s.at);
  return times.length ? Math.min(...times) : undefined;
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
  sharedCursor,
  replySessions,
  checkoutNotes,
  scopeHeard,
  movedIn,
  deepReview,
  ultraplans,
  handover,
  ...summary
}: ProjectChat): ChatSummary {
  const provider = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.provider;
  const holder = contextAgent(messages.filter((m) => !m.parentId));
  const next = nextSend(scheduled);
  return {
    ...summary,
    ...(provider ? { provider } : {}),
    ...(holder ? { contextAgent: holder } : {}),
    ...(next ? { nextSend: next } : {}),
    empty: !messages.length && !scheduled?.length,
  };
}

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
  constructor(
    private store: Store,
    private dir: string,
    /** The answer's session is still in the turn a restart cut off. */
    private resuming: (chatId: string, branch?: string) => boolean,
  ) {}

  /** Loads wait for `ready` from here on. */
  waitFor(ready: Promise<void>) {
    this.ready = ready;
  }

  /** The cached chat itself, read from disk the first time; never hand it out. */
  async load(id: string): Promise<ProjectChat> {
    await this.ready;
    if (!this.store.get().chats?.some((c) => c.id === id))
      throw new Error("Chat not found.");
    if (!this.cache.has(id)) {
      let pending = this.loading.get(id);
      if (!pending) {
        pending = (async () => {
          const chat = JSON.parse(
            await readFile(join(this.dir, id + ".json"), "utf8"),
          ) as ProjectChat;
          if (chat.id !== id)
            throw new Error("Saved chat identity does not match.");
          const { interrupted, summaryChanged } = reviveChat(chat, (m) =>
            this.resuming(chat.id, m.parentId ?? undefined),
          );
          if (interrupted) await this.save(chat);
          if (summaryChanged) await this.updateSummary(chat);
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
    return this.cache.get(id)!;
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

  async save(chat: ProjectChat) {
    const value = JSON.stringify(chat),
      path = join(this.dir, chat.id + ".json");
    await this.writes(chat.id, async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = path + "." + randomUUID() + ".tmp";
      await writeFile(tmp, value, { mode: 0o600 });
      await rename(tmp, path);
    });
  }

  /** Saves the thread and refreshes its sidebar summary. */
  async persist(chat: ProjectChat) {
    await this.save(chat);
    await this.updateSummary(chat);
  }

  async updateSummary(chat: ProjectChat) {
    await this.store.update((s) => {
      const index = s.chats!.findIndex((c) => c.id === chat.id);
      if (index >= 0) s.chats![index] = chatSummary(chat);
      else s.chats!.push(chatSummary(chat));
    });
    this.summariesChanged(chat.projectId);
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
