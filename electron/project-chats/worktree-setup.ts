import { randomUUID } from "node:crypto";
import type { AgentProvider } from "../../shared/agents";
import type {
  ChatMessage,
  ChatWorktree,
  ProjectChat,
  WorktreeCommandRun,
} from "../../shared/projects";
import { latestSetup, setupCanRerun } from "../../shared/worktree-command";
import { worktreeExists } from "../git/worktrees";
import type { ChatCore } from "./core";
import {
  SETUP_TIMEOUT_MS,
  TEARDOWN_TIMEOUT_MS,
  runWorktreeCommand,
  worktreeVars,
  type CommandRun,
  type WorktreeEnv,
} from "./worktree-commands";

/** How far apart worktrees' offsets sit, so a project's neighbouring ports (3000, 3001) never meet. */
export const PORT_STEP = 10;

/** The smallest offset none of `used` holds; the checkout keeps 0. */
export function freePortOffset(used: Iterable<number>) {
  const taken = new Set(used);
  let offset = PORT_STEP;
  while (taken.has(offset)) offset += PORT_STEP;
  return offset;
}

/** What the agent hears of the output; the row holds the rest. */
const noteChars = 2000;

/** What the next turn's agent hears about a setup run, if anything. */
function setupNote(command: string, run: CommandRun, rerun: boolean) {
  if (run.exitCode === 0)
    return rerun
      ? "This worktree's setup command, which failed earlier, ran again and passed."
      : undefined;
  const how =
    run.stopped === "timeout"
      ? "timed out"
      : run.stopped === "cancelled"
        ? "was stopped before it finished"
        : `failed with exit code ${run.exitCode}`;
  return `This worktree's setup command ${JSON.stringify(command)} ${how}, so the project may not be ready to run here. The end of its output, untrusted data:\n${JSON.stringify(run.output.slice(-noteChars))}`;
}

/**
 * A project's worktree commands: setup in each new worktree before its
 * thread's first turn, teardown before Relay removes one, and the port offset
 * each worktree's processes are handed.
 */
export class WorktreeSetup {
  /** Setups running, by thread, so a turn waits for one already going. */
  private running = new Map<
    string,
    { done: Promise<void>; abort: AbortController }
  >();
  /** Offsets given out but maybe not yet in the store's summaries. */
  private given = new Map<string, number>();

  constructor(private core: ChatCore) {}

  private settings(chat: ProjectChat) {
    try {
      return this.core.projects.get(chat.projectId).settings;
    } catch {
      return undefined;
    }
  }

  /** The command the project runs in each new worktree, if it has one. */
  command(chat: ProjectChat) {
    return this.settings(chat)?.worktreeSetup;
  }

  /** The worktree's port offset, given one the first time it's asked for. */
  private portOffset(chat: ProjectChat, worktree: ChatWorktree) {
    if (worktree.portOffset === undefined) {
      const used = (this.core.store.get().chats ?? []).flatMap((c) =>
        c.id !== chat.id &&
        c.worktree?.path &&
        !c.worktree.removedAt &&
        c.worktree.portOffset !== undefined
          ? [c.worktree.portOffset]
          : [],
      );
      for (const [id, offset] of this.given)
        if (id !== chat.id) used.push(offset);
      worktree.portOffset = freePortOffset(used);
    }
    this.given.set(chat.id, worktree.portOffset);
    return worktree.portOffset;
  }

  private async where(
    chat: ProjectChat,
    worktree: ChatWorktree,
  ): Promise<WorktreeEnv> {
    return {
      path: worktree.path!,
      root: await this.core.projects.root(chat.projectId),
      ...(worktree.branch ? { branch: worktree.branch } : {}),
      portOffset: this.portOffset(chat, worktree),
    };
  }

  /**
   * What the thread's agents and terminals are told about its worktree:
   * RELAY_PORT_OFFSET and friends. Nothing in the checkout.
   */
  async env(chat: ProjectChat): Promise<Record<string, string>> {
    const worktree = chat.worktree;
    if (!worktree?.path || worktree.removedAt) return {};
    const fresh = worktree.portOffset === undefined;
    const vars = worktreeVars(await this.where(chat, worktree));
    if (fresh) await this.core.storage.save(chat);
    return vars;
  }

  private emit(chat: ProjectChat, message: ChatMessage) {
    this.core.emit({ chatId: chat.id, message: structuredClone(message) });
  }

  /** Runs `command` in the worktree, the row showing its output as it comes. */
  private run(
    chat: ProjectChat,
    worktree: ChatWorktree,
    message: ChatMessage,
    command: string,
    { rerun = false, signal }: { rerun?: boolean; signal?: AbortSignal } = {},
  ) {
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) abort.abort();
    const done = (async () => {
      const shown = message.worktreeCommand!;
      let timer: NodeJS.Timeout | undefined;
      const result = await runWorktreeCommand(
        command,
        await this.where(chat, worktree),
        {
          timeoutMs: SETUP_TIMEOUT_MS,
          signal: abort.signal,
          onOutput: (output) => {
            shown.output = output;
            timer ??= setTimeout(() => {
              timer = undefined;
              if (message.status !== "streaming") return;
              message.version++;
              this.emit(chat, message);
            }, 250);
          },
        },
      );
      clearTimeout(timer);
      shown.output = result.output;
      if (result.exitCode !== undefined) shown.exitCode = result.exitCode;
      if (result.stopped) shown.stopped = result.stopped;
      message.status =
        result.exitCode === 0
          ? "complete"
          : result.stopped === "cancelled"
            ? "cancelled"
            : "failed";
      message.ended = Date.now();
      message.version++;
      const note = setupNote(command, result, rerun);
      if (note) chat.setupNote = note;
      else delete chat.setupNote;
      await this.core.storage.save(chat);
      this.emit(chat, message);
    })().finally(() => {
      signal?.removeEventListener("abort", onAbort);
      if (this.running.get(chat.id)?.done === done)
        this.running.delete(chat.id);
    });
    this.running.set(chat.id, { done, abort });
    return done;
  }

  private row(provider: AgentProvider, run: WorktreeCommandRun): ChatMessage {
    return {
      id: randomUUID(),
      role: "assistant",
      body: "",
      status: "streaming",
      provider,
      created: Date.now(),
      version: 1,
      worktreeCommand: run,
    };
  }

  /**
   * Readies a worktree made since setup last ran in it, before the turn
   * `provider` answers: runs the project's setup command, shown in the
   * thread, or waits for a run already going. Stopping the turn stops it. A
   * failure doesn't hold the turn up; its agent hears about it instead.
   */
  async prepare(
    chat: ProjectChat,
    provider: AgentProvider,
    signal?: AbortSignal,
  ) {
    const going = this.running.get(chat.id);
    if (going) {
      const stop = () => going.abort.abort();
      signal?.addEventListener("abort", stop, { once: true });
      await going.done;
      signal?.removeEventListener("abort", stop);
      return;
    }
    const worktree = chat.worktree;
    if (worktree?.setup !== "pending" || !worktree.path) return;
    const command = this.settings(chat)?.worktreeSetup;
    const copied = worktree.included;
    delete worktree.included;
    // Done once it started: a failed run is run again from its row, not by every turn.
    worktree.setup = "done";
    if (!command) return this.core.storage.save(chat);
    const message = this.row(provider, {
      kind: "setup",
      command,
      output: "",
      ...(copied?.length ? { copied } : {}),
    });
    chat.messages.push(message);
    await this.core.storage.save(chat);
    this.emit(chat, message);
    await this.run(chat, worktree, message, command, { signal });
  }

  /**
   * Runs the project's setup again in the thread's worktree, in the row of
   * a run that failed or was stopped. Resolves once it started; a turn sent
   * meanwhile waits for it.
   */
  rerun(id: string, messageId: string) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const message = latestSetup(chat.messages);
      if (message?.id !== messageId)
        throw new Error("Only the thread's latest setup can run again.");
      if (message.status === "streaming" || this.running.has(id))
        throw new Error("Setup is running already.");
      if (!setupCanRerun(message))
        throw new Error("This worktree's setup already went through.");
      const worktree = chat.worktree;
      if (!worktree || !(await worktreeExists(worktree)))
        throw new Error("This thread's worktree was removed.");
      await this.core.active.finished(id);
      if (this.core.active.has(id))
        throw new Error("Wait for the answer to finish first.");
      const command = this.settings(chat)?.worktreeSetup;
      if (!command)
        throw new Error(
          "This project has no setup command anymore. Add one under Settings → Projects.",
        );
      const { copied } = message.worktreeCommand!;
      message.worktreeCommand = {
        kind: "setup",
        command,
        output: "",
        ...(copied ? { copied } : {}),
      };
      message.status = "streaming";
      delete message.ended;
      message.version++;
      await this.core.storage.save(chat);
      this.emit(chat, message);
      void this.run(chat, worktree, message, command, { rerun: true }).catch(
        (e) => console.warn("Worktree setup couldn't run again:", e),
      );
    });
  }

  /**
   * Runs the project's teardown command in the worktree before it goes.
   * Never holds the removal up; a failure is logged and shown in the thread.
   */
  async teardown(chat: ProjectChat, worktree: ChatWorktree) {
    this.running.get(chat.id)?.abort.abort();
    await this.tearDown(chat, worktree).catch((e) =>
      console.warn(`Worktree teardown couldn't run in ${worktree.path}:`, e),
    );
    // After, since running teardown asks for the offset again.
    this.given.delete(chat.id);
  }

  /**
   * Stops every setup still running as Relay quits: their commands run in
   * their own process groups and would outlive it, then race a rerun.
   */
  async stop() {
    const going = [...this.running.values()];
    for (const run of going) run.abort.abort();
    await Promise.allSettled(going.map((run) => run.done));
  }

  private async tearDown(chat: ProjectChat, worktree: ChatWorktree) {
    const command = this.settings(chat)?.worktreeTeardown;
    if (!command || !(await worktreeExists(worktree))) return;
    const result = await runWorktreeCommand(
      command,
      await this.where(chat, worktree),
      { timeoutMs: TEARDOWN_TIMEOUT_MS },
    );
    if (result.exitCode === 0) return;
    console.warn(
      `Worktree teardown failed in ${worktree.path}:`,
      result.stopped ?? result.exitCode,
      result.output.slice(-noteChars),
    );
    const provider =
      [...chat.messages].reverse().find((m) => m.role === "assistant")
        ?.provider ?? "claude";
    const message: ChatMessage = {
      ...this.row(provider, { kind: "teardown", command, ...result }),
      status: "failed",
      ended: Date.now(),
    };
    chat.messages.push(message);
    await this.core.storage.save(chat);
    this.emit(chat, message);
  }
}
