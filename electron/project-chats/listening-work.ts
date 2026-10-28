import { commandKey } from "../../shared/tasks";
import { claudeTaskCommand } from "../agents/claude/project";
import { projectTasks } from "../terminal/tasks";
import type { ChatCore } from "./core";

/** A server can take a while to start listening; until then it's looked for this often. */
const LOOK_AGAIN_MS = 10_000;
/** Background work changes in bursts: a task's start and its command arrive apart. */
const SETTLE_MS = 1000;

type Unplaced = { chatId: string; taskId: string; key: string };

/**
 * Which of Claude's background commands listen on a port. A server only ends
 * when someone stops it, so its thread isn't waiting on it, though Claude
 * still hears if it ever exits.
 */
export class ListeningWork {
  /** The ports of each background task found listening, by task id. */
  private ports = new Map<string, number[]>();
  private timer?: ReturnType<typeof setTimeout>;
  private looking?: Promise<void>;

  constructor(private core: ChatCore) {
    core.sessions.onPending(() => this.lookSoon(SETTLE_MS));
  }

  /** The ports a background task listens on, once found. */
  portsOf(taskId: string) {
    return this.ports.get(taskId);
  }

  private lookSoon(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.looking ??= this.look().finally(() => (this.looking = undefined));
    }, delay);
    this.timer.unref?.();
  }

  private async look() {
    const unplaced = this.unplaced();
    for (const chatId of new Set(unplaced.map((task) => task.chatId))) {
      const tasks = unplaced.filter((task) => task.chatId === chatId);
      const found = await this.listening(chatId, tasks).catch((e) => {
        console.warn("Could not check what Claude's background work listens on:", e);
        return false;
      });
      if (found) this.core.storage.chatChanged(chatId);
    }
    if (this.unplaced().length) this.lookSoon(LOOK_AGAIN_MS);
  }

  /** Background commands not yet seen listening; forgets the ones that ended. */
  private unplaced(): Unplaced[] {
    const tasks = this.core.sessions
      .pending()
      .filter((p) => p.item.kind === "task" && !p.item.agent);
    const live = new Set(tasks.map((p) => p.item.id));
    for (const taskId of this.ports.keys())
      if (!live.has(taskId)) this.ports.delete(taskId);
    return tasks.flatMap(({ key, chatId, item }) => {
      const command = claudeTaskCommand(key, item.id);
      if (!command || this.ports.has(item.id)) return [];
      return [{ chatId, taskId: item.id, key: commandKey(command) }];
    });
  }

  /** Looks for the thread's tasks among the project's processes; whether any listen now. */
  private async listening(chatId: string, tasks: Unplaced[]) {
    const thread = this.core.store.get().chats?.find((c) => c.id === chatId);
    if (!thread) return false;
    const root = await this.core.projects.root(thread.projectId);
    const worktree = thread.worktree;
    const worktrees =
      worktree?.path && !worktree.removedAt
        ? [{ path: worktree.path, chatId }]
        : [];
    const running = await projectTasks.list(root, worktrees, {
      includeNewServers: true,
    });
    let found = false;
    for (const task of tasks) {
      const server = running.find(
        (process) =>
          process.chatId === chatId &&
          process.ports.length > 0 &&
          commandKey(process.command) === task.key,
      );
      if (!server) continue;
      this.ports.set(task.taskId, server.ports);
      found = true;
    }
    return found;
  }
}
