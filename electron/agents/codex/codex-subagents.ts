// Codex runs a subagent as a thread of its own on the same app server. Its
// turn names the turn it was started from as `rootTurnId`; that is the one
// sure sign, since the spawn itself may show as a `subAgentActivity` item
// (multi-agent v2), a `collabAgentToolCall` (older servers) or not at all (v1).
import type { AgentActivity } from "../../../shared/projects";
import { CodexPlanRows, codexActivity } from "../activity";
import { SubagentBooks, type SubagentBook } from "../subagent-book";
import type { CodexNotification } from "./codex-schemas";

/** Each Codex session's subagents, for the composer's indicator and side thread. */
export const codexSubagentBooks = new SubagentBooks();

export type CodexSubagentHooks = {
  onActivity?: (activity: AgentActivity) => void;
  /** A subagent's patch, kept and counted as the run's own are. */
  onFileChange: (id: string, changes: unknown) => void;
  /** One of a subagent's requests finished; `model` when Codex said which. */
  onUsage: (last: unknown, model: string | undefined) => void;
  /** Codex's record of a thread, which says what the subagent was asked. */
  read: (threadId: string) => Promise<unknown>;
  interrupt: (threadId: string, turnId: string) => Promise<unknown>;
  /** The session's book, which keeps them past the turn. */
  book?: SubagentBook;
};

/** What names a subagent, gathered from wherever Codex says it. */
type Naming = {
  path?: string;
  prompt?: string;
  nickname?: string;
  model?: string;
  /** The thread that started it. */
  parent?: string;
};

type Agent = {
  thread: string;
  row: AgentActivity;
  turn?: string;
  /** Its own calls so far, for the row's progress. */
  calls: Set<string>;
  /** The latest thing it said it is doing. */
  said?: string;
  answer?: string;
};

const firstLine = (text: unknown) =>
  typeof text === "string"
    ? text
        .trim()
        .split("\n")[0]!
        .replace(/^[#>\-*\s]+/, "")
        .replace(/`|\*\*/g, "")
        .trim()
        .slice(0, 160)
    : "";

/** "/root/explore_auth" reads "Explore auth", the name the model gave the task. */
const pathName = (path: string | undefined) => {
  const name = path
    ?.split("/")
    .filter((part) => part && part !== "root")
    .at(-1)
    ?.replace(/[_-]+/g, " ")
    .trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
};

const finished: Record<string, AgentActivity["status"]> = {
  completed: "complete",
  interrupted: "stopped",
  failed: "failed",
};
const ended = {
  complete: "completed",
  stopped: "stopped",
  failed: "failed",
} as const;

/** A run's subagents: each is one agent row its own calls fold under. */
export class CodexSubagents {
  private agents = new Map<string, Agent>();
  private names = new Map<string, Naming>();
  private plans = new CodexPlanRows();
  private closed = false;

  constructor(private hooks: CodexSubagentHooks) {}

  /** An item of the run's thread or a subagent's (`sender`) that starts or talks to one. */
  spawned(item: Record<string, unknown>, sender?: string) {
    if (
      item.type === "subAgentActivity" &&
      typeof item.agentThreadId === "string"
    )
      this.name(item.agentThreadId, {
        path: typeof item.agentPath === "string" ? item.agentPath : undefined,
        model: typeof item.model === "string" ? item.model : undefined,
        parent: sender,
      });
    if (item.type !== "collabAgentToolCall") return;
    const receivers = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.filter((id) => typeof id === "string")
      : [];
    if (item.tool === "spawnAgent")
      for (const thread of receivers)
        this.name(thread, {
          prompt: typeof item.prompt === "string" ? item.prompt : undefined,
          model: typeof item.model === "string" ? item.model : undefined,
          parent: sender,
        });
    // A wait hands back what each agent answered; its own turn usually said so first.
    const states = (item.agentsStates ?? {}) as Record<
      string,
      { message?: unknown } | undefined
    >;
    for (const [thread, state] of Object.entries(states)) {
      const agent = this.agents.get(thread);
      if (agent && typeof state?.message === "string" && state.message)
        agent.answer ??= state.message;
    }
  }

  /** A notification from a thread other than the run's own, whose turn is `rootTurn`. */
  notification(n: CodexNotification, rootTurn: string) {
    if (this.closed) return;
    const thread = n.params.threadId;
    if (!thread) return;
    let agent = this.agents.get(thread);
    if (n.method === "turn/started") {
      if (!agent) {
        const root = n.params.turn.rootTurnId;
        const ours =
          !!root &&
          (root === rootTurn ||
            [...this.agents.values()].some((a) => a.turn === root));
        if (!ours) return;
        agent = this.add(thread);
      }
      agent.turn = n.params.turn.id;
      this.update(agent, { status: "running" });
      return;
    }
    if (!agent) return;
    if (n.method === "item/started" || n.method === "item/completed") {
      const item = n.params.item as Record<string, unknown> & {
        type: string;
      };
      if (
        item.type === "fileChange" &&
        typeof item.id === "string" &&
        item.changes
      )
        this.hooks.onFileChange(item.id, item.changes);
      this.spawned(item, thread);
      if (
        n.method === "item/completed" &&
        item.type === "agentMessage" &&
        typeof item.text === "string"
      ) {
        // What it says along the way is its status; the rest is its answer.
        if (item.phase === "commentary") agent.said = firstLine(item.text);
        else agent.answer = item.text;
        if (typeof item.id === "string")
          this.hooks.book?.say(agent.row.id, item.id, item.text);
      }
      const activity = codexActivity(n.method, item);
      if (activity) {
        if (n.method === "item/started") agent.calls.add(activity.id);
        const call = { ...activity, parentId: agent.row.id };
        this.hooks.onActivity?.(call);
        this.hooks.book?.call(agent.row.id, call);
      }
      this.progress(agent);
    }
    if (n.method === "turn/plan/updated") {
      const row = this.plans.update(thread, n.params);
      if (row) {
        const call = { ...row, parentId: agent.row.id };
        this.hooks.onActivity?.(call);
        this.hooks.book?.call(agent.row.id, call);
      }
    }
    if (n.method === "thread/tokenUsage/updated") {
      const last = (n.params.tokenUsage as { last?: unknown } | null)?.last;
      if (last) this.hooks.onUsage(last, this.names.get(thread)?.model);
    }
    if (n.method === "turn/completed" && n.params.turn.id === agent.turn)
      this.update(agent, {
        status: finished[n.params.turn.status] ?? "complete",
        progress: undefined,
        ...(agent.answer ? { detail: agent.answer.slice(-8000) } : {}),
      });
  }

  /**
   * Interrupts every subagent still working: Codex lets them run on past the
   * turn that started them, even a stopped one, where nobody would see them.
   */
  stop() {
    const pending: Promise<unknown>[] = [];
    for (const agent of this.agents.values()) {
      if (agent.row.status !== "running") continue;
      this.update(agent, { status: "stopped", progress: undefined });
      if (agent.turn)
        pending.push(
          this.hooks.interrupt(agent.thread, agent.turn).catch(() => {}),
        );
    }
    this.closed = true;
    return Promise.all(pending);
  }

  private add(thread: string) {
    const agent: Agent = {
      thread,
      row: {
        id: `agent:${thread}`.slice(0, 180),
        kind: "agent",
        label: "",
        status: "running",
      },
      calls: new Set(),
    };
    this.agents.set(thread, agent);
    this.relabel(agent);
    // The spawn may not have said what it asked (v1 says nothing); the thread does.
    void this.hooks
      .read(thread)
      .then((value) => {
        const record = ((value as { thread?: unknown } | null)?.thread ??
          {}) as Record<string, any>;
        const spawn = record.source?.subAgent?.thread_spawn;
        this.name(thread, {
          prompt: record.preview || undefined,
          nickname: record.agentNickname || undefined,
          path: spawn?.agent_path || undefined,
          model: record.model || undefined,
          parent: record.parentThreadId || undefined,
        });
      })
      .catch(() => {});
    return agent;
  }

  private name(thread: string, naming: Naming) {
    const known = (this.names.get(thread) ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(naming))
      if (typeof value === "string" && value) known[key] ??= value;
    this.names.set(thread, known as Naming);
    const agent = this.agents.get(thread);
    if (agent && !this.closed) this.relabel(agent);
    if (agent) this.record(agent);
  }

  /** The row reads as its task, under the agent that started it when that is one. */
  private relabel(agent: Agent) {
    const naming = this.names.get(agent.thread) ?? {};
    const label =
      pathName(naming.path) ||
      firstLine(naming.prompt) ||
      naming.nickname ||
      "Subagent";
    const parent = naming.parent && this.agents.get(naming.parent)?.row.id;
    if (
      label === agent.row.label &&
      parent === agent.row.parentId &&
      agent.row.label
    )
      return;
    this.update(agent, {
      label: label.slice(0, 500),
      ...(parent ? { parentId: parent } : {}),
    });
  }

  /** "Reading auth.ts · 4 tools" while it works, as Claude's agent rows read. */
  private progress(agent: Agent) {
    if (agent.row.status !== "running") return;
    const count = agent.calls.size;
    const progress =
      [agent.said, count && `${count} tool${count === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 300) || undefined;
    if (progress !== agent.row.progress) this.update(agent, { progress });
  }

  private update(agent: Agent, patch: Partial<AgentActivity>) {
    const row: AgentActivity = { ...agent.row, ...patch };
    if (row.progress === undefined) delete row.progress;
    agent.row = row;
    this.record(agent);
    if (!this.closed) this.hooks.onActivity?.(row);
  }

  /** Keeps the session's book in step with the agent's row. */
  private record({ row, thread, answer, turn }: Agent) {
    const book = this.hooks.book;
    if (!book) return;
    const naming = this.names.get(thread) ?? {};
    book.start(row.id, {
      description: row.label || "Subagent",
      parentId: row.parentId,
      model: naming.model,
      brief: naming.prompt,
      stop: async () => {
        if (!turn)
          throw new Error(
            "That agent isn't ready to stop yet. Try again shortly.",
          );
        await this.hooks.interrupt(thread, turn);
      },
    });
    if (row.status === "running") book.progress(row.id, row.progress);
    else book.end(row.id, ended[row.status], answer);
  }
}
