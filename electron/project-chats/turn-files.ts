import { access } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  threadWorktree,
  turnImages,
  type ChatMessage,
  type ProjectChat,
} from "../../shared/projects";
import { answerImagePaths, embedsImages } from "../../shared/answer-images";
import {
  dropRevert,
  redoRevert,
  revertTurn,
  turnDiff,
} from "../git/turn-changes";
import { worktreeExists } from "../git/worktrees";
import type { ChatCore } from "./core";
import { imageFileData } from "./images";
import type { ThreadWorktrees } from "./worktrees";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Files a thread's turns read, showed or changed, which the renderer may
 * open only through here; and rolling a turn's changes back or forth.
 */
export class TurnFiles {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
  ) {}

  async image(chatId: string, imageId: string): Promise<string> {
    const chat = await this.core.storage.load(chatId);
    const image = chat.messages
      .flatMap((message) => message.images ?? [])
      .find((item) => item.id === imageId);
    if (!image) throw new Error("Screenshot not found in this conversation.");
    return this.core.storage.image(chatId, image);
  }

  /** Only a path the turn itself read or its answer shows, so the renderer can't reach any other file on disk. */
  async turnImagePath(chatId: string, messageId: string, path: string) {
    const chat = await this.core.storage.load(chatId);
    const message = chat.messages.find((m) => m.id === messageId);
    if (!message || !isAbsolute(path))
      throw new Error("This turn didn't read that image.");
    if (turnImages(message).includes(path)) return path;
    const root = await this.worktrees
      .terminalFolder(chat.projectId, chatId)
      .catch(() => null);
    if (
      message.role !== "assistant" ||
      !message.body ||
      !root ||
      !answerImagePaths(message.body, root).includes(path)
    )
      throw new Error("This turn didn't read or show that image.");
    return path;
  }

  async readImage(chatId: string, messageId: string, path: string) {
    await this.turnImagePath(chatId, messageId, path);
    const kept = this.core.storage.shown.path(chatId, messageId, path);
    return imageFileData((await exists(kept)) ? kept : path);
  }

  /** The preview's last frame the turn `messageId` kept. */
  async previewShot(chatId: string, messageId: string) {
    const chat = await this.core.storage.load(chatId);
    if (!chat.messages.find((m) => m.id === messageId)?.preview?.shot)
      throw new Error("This turn kept no frame of the preview.");
    return imageFileData(
      this.core.storage.shown.previewShot(chatId, messageId),
    );
  }

  /** The image file to show in Finder: where the agent left it, or the answer's copy once that's gone. */
  async revealImagePath(chatId: string, messageId: string, path: string) {
    await this.turnImagePath(chatId, messageId, path);
    const kept = this.core.storage.shown.path(chatId, messageId, path);
    return !(await exists(path)) && (await exists(kept)) ? kept : path;
  }

  /**
   * Copies the local images a finished answer shows into the thread, so one
   * in a temp folder that's cleared, or a file the agent draws over for its
   * next screenshot, still shows what the answer showed.
   */
  async keepShown(chat: ProjectChat, message: ChatMessage) {
    if (message.role !== "assistant" || !embedsImages(message.body)) return;
    const root = await this.worktrees
      .terminalFolder(chat.projectId, chat.id)
      .catch(() => null);
    if (!root) return;
    for (const path of answerImagePaths(message.body, root))
      await this.core.storage.shown
        .keep(chat.id, message.id, path)
        .catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT")
            console.warn("Could not keep an image the answer shows:", e);
        });
  }

  async diff(chatId: string, messageId: string, path: string) {
    const chat = await this.core.storage.load(chatId);
    const message = chat.messages.find((m) => m.id === messageId);
    if (!message?.changes?.some((f) => f.path === path))
      throw new Error("This turn didn't change that file.");
    return turnDiff(
      await this.core.projects.root(chat.projectId),
      messageId,
      path,
    );
  }

  /** Where a file one turn changed sits on disk (`messageId` null: any file of the thread's worktree). */
  async path(chatId: string, messageId: string | null, path: string) {
    const chat = await this.core.storage.load(chatId);
    if (messageId === null)
      return join(await this.worktrees.rootFor(chat.projectId, chatId), path);
    const message = chat.messages.find((m) => m.id === messageId);
    if (!message?.changes?.some((f) => f.path === path))
      throw new Error("This turn didn't change that file.");
    const root = await this.worktrees.terminalFolder(chat.projectId, chatId);
    return join(root, path);
  }

  /** Rolls back files one turn changed, or redoes that rollback. */
  rewind(
    chatId: string,
    messageId: string,
    paths: string[] | null,
    mode: "revert" | "redo",
    force: boolean,
  ): Promise<{ conflicts: string[] }> {
    return this.core.control(chatId, async () => {
      await this.core.storage.load(chatId);
      const chat = this.core.storage.cached(chatId)!;
      await this.worktrees.refreshAgentWorktrees(chat);
      const worktree = threadWorktree(chat);
      if (!chat.worktree && !worktree)
        this.core.projects.assertCheckoutAvailable(chat.projectId);
      if (
        (chat.worktree || worktree) &&
        !(await worktreeExists(chat.worktree ?? worktree!))
      )
        throw new Error("This thread's worktree was removed.");
      // A running agent may still edit these files; like an edit from the
      // user's editor, the rollback merges and the agent sees it on next read.
      const message = chat.messages.find((m) => m.id === messageId);
      const files = (message?.changes ?? []).filter(
        (f) =>
          (!paths || paths.includes(f.path)) &&
          (mode === "revert") === !f.revertedBy,
      );
      if (!message || !files.length) return { conflicts: [] };
      const root = await this.worktrees.terminalFolder(chat.projectId, chatId);
      let moved: string[];
      if (mode === "revert") {
        const result = await revertTurn(
          root,
          messageId,
          files.map((f) => f.path),
          force,
        );
        if (result.conflicts.length) return { conflicts: result.conflicts };
        for (const f of files) f.revertedBy = result.undo;
        moved = result.moved;
      } else {
        // Each rollback redoes from its own snapshot; check them all before
        // writing so a conflict in one leaves the others untouched too.
        const groups = new Map<string, typeof files>();
        for (const f of files)
          groups.set(f.revertedBy!, [...(groups.get(f.revertedBy!) ?? []), f]);
        if (!force)
          for (const [undo, group] of groups) {
            const check = await redoRevert(
              root,
              messageId,
              undo,
              group.map((f) => f.path),
              false,
              true,
            );
            if (check.conflicts.length) return { conflicts: check.conflicts };
          }
        moved = [];
        for (const [undo, group] of groups) {
          const result = await redoRevert(
            root,
            messageId,
            undo,
            group.map((f) => f.path),
            force,
          );
          if (result.conflicts.length) continue;
          for (const f of group) delete f.revertedBy;
          moved.push(...result.moved);
          if (!message.changes!.some((f) => f.revertedBy === undo))
            await dropRevert(root, messageId, undo);
        }
      }
      const when = new Date(message.created).toLocaleString();
      const listed = moved.slice(0, 20).join(", ");
      const more = moved.length > 20 ? ` and ${moved.length - 20} more` : "";
      chat.checkoutNotes = [
        ...(chat.checkoutNotes ?? []),
        mode === "revert"
          ? `I rolled back your edits to ${listed}${more} from your turn at ${when}; those files are back to how that turn found them, apart from later edits that merged cleanly.`
          : `I restored your edits to ${listed}${more} from your turn at ${when} after an earlier rollback.`,
      ].slice(-10);
      message.version++;
      await this.core.storage.save(chat);
      this.core.emit({ chatId, message: structuredClone(message) });
      return { conflicts: [] };
    });
  }
}
