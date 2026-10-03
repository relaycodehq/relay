import { isAbsolute, join } from "node:path";
import { turnImages } from "../../shared/projects";
import { answerImagePaths } from "../../shared/answer-images";
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
    return imageFileData(path);
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
      return join(await this.worktrees.path(chatId), path);
    const message = chat.messages.find((m) => m.id === messageId);
    if (!message?.changes?.some((f) => f.path === path))
      throw new Error("This turn didn't change that file.");
    const root =
      chat.worktree?.path ?? (await this.core.projects.root(chat.projectId));
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
      if (!chat.worktree)
        this.core.projects.assertCheckoutAvailable(chat.projectId);
      if (chat.worktree && !(await worktreeExists(chat.worktree)))
        throw new Error("This thread's worktree was removed.");
      // An agent editing the same folder would race the rollback.
      for (const id of this.core.active.ids()) {
        const other = this.core.storage.cached(id);
        if (
          other?.projectId === chat.projectId &&
          other.worktree?.path === chat.worktree?.path
        )
          throw new Error(
            "Wait for the running answer to finish before rolling back files.",
          );
      }
      const message = chat.messages.find((m) => m.id === messageId);
      const files = (message?.changes ?? []).filter(
        (f) =>
          (!paths || paths.includes(f.path)) &&
          (mode === "revert") === !f.revertedBy,
      );
      if (!message || !files.length) return { conflicts: [] };
      const root =
        chat.worktree?.path ?? (await this.core.projects.root(chat.projectId));
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
