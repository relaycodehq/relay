// The subagents a session started, for agents whose runs follow them call by
// call (Codex, OpenCode): kept the way Claude's tracker keeps its own, so the
// composer's indicator, its card and the side thread read every agent alike.
// It outlives the turn that started them and goes with the session.
import type { AgentActivity, AgentTrace } from "../../shared/projects";
import type {
  SubagentDetail,
  SubagentRun,
  SubagentStatus,
} from "../../shared/subagents";
import type { SubagentSource } from "./types";

type Run = {
  id: string;
  description: string;
  type?: string;
  model?: string;
  brief?: string;
  parentId?: string;
  status: SubagentStatus;
  started: number;
  ended?: number;
  summary?: string;
  trace: AgentTrace[];
  report?: string;
  /** Stops it while it runs. */
  stop?: () => Promise<unknown>;
  /** Asked to stop: however its agent then words the ending, it was stopped. */
  stopping?: boolean;
};

export type SubagentStart = Pick<
  Run,
  "description" | "type" | "model" | "brief" | "parentId" | "stop"
>;

const limits = {
  runs: 40,
  trace: 400,
  text: 20_000,
  detail: 4_000,
  brief: 8_000,
};

export class SubagentBook implements SubagentSource {
  private runs = new Map<string, Run>();
  constructor(private now = () => Date.now()) {}

  /** An agent started, or a later turn met one it already knows. */
  start(id: string, start: SubagentStart) {
    const known = this.runs.get(id);
    if (known) return this.name(id, start);
    this.runs.set(id, {
      id,
      status: "running",
      started: this.now(),
      trace: [],
      ...start,
      description: start.description.slice(0, 500),
      brief: start.brief?.slice(0, limits.brief),
    });
    for (const old of this.runs.keys()) {
      if (this.runs.size <= limits.runs) break;
      if (this.runs.get(old)!.status !== "running") this.runs.delete(old);
    }
  }

  /** A follow-up starts another run on a child session that already finished. */
  resume(id: string) {
    const run = this.runs.get(id);
    if (!run || run.status === "running") return;
    run.status = "running";
    run.started = this.now();
    run.ended = undefined;
    run.report = undefined;
    run.stopping = false;
  }

  /** What names it, once the agent says more. */
  name(id: string, naming: Partial<SubagentStart>) {
    const run = this.runs.get(id);
    if (!run) return;
    for (const [key, value] of Object.entries(naming))
      if (value !== undefined && value !== "")
        (run as Record<string, unknown>)[key] =
          key === "brief"
            ? String(value).slice(0, limits.brief)
            : key === "description"
              ? String(value).slice(0, 500)
              : value;
  }

  /** What it is doing now, while it runs. */
  progress(id: string, summary: string | undefined) {
    const run = this.runs.get(id);
    if (run?.status === "running") run.summary = summary;
  }

  /** One of its calls, new or moved on. */
  call(id: string, activity: AgentActivity) {
    const { parentId, ...rest } = activity;
    // Its calls fold under its row in the turn; in its own run they're in line.
    const own = parentId === id ? rest : activity;
    this.put(id, {
      kind: "activity",
      id: activity.id,
      activity: own.detail
        ? { ...own, detail: own.detail.slice(-limits.detail) }
        : own,
    });
  }

  /** Something it said along the way, by the id of what said it. */
  say(id: string, entry: string, text: string) {
    const trimmed = text.trim();
    if (trimmed)
      this.put(id, {
        kind: "commentary",
        id: entry,
        text: trimmed.slice(0, limits.text),
      });
  }

  end(id: string, status: Exclude<SubagentStatus, "running">, report?: string) {
    const run = this.runs.get(id);
    if (!run || run.status !== "running") return;
    run.status = run.stopping ? "stopped" : status;
    run.ended = this.now();
    run.summary = undefined;
    run.stop = undefined;
    // A stopped one reports nothing; its agent's word for the stop isn't one.
    if (report?.trim() && !run.stopping)
      run.report = report.trim().slice(0, limits.text);
    // What it left mid-call won't be heard of again, or comes in late on its own.
    for (const entry of run.trace)
      if (entry.kind === "activity" && entry.activity.status === "running")
        entry.activity = { ...entry.activity, status: "stopped" };
  }

  /** The session ended, and its agents with it. */
  close() {
    for (const run of this.runs.values())
      if (run.status === "running") this.end(run.id, "stopped");
  }

  list(): SubagentRun[] {
    return [...this.runs.values()].map((run) => this.view(run));
  }

  detail(id: string): SubagentDetail | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    // Its last word is the report, shown once.
    const last = run.trace.at(-1);
    const trace =
      run.report && last?.kind === "commentary" && last.text === run.report
        ? run.trace.slice(0, -1)
        : run.trace;
    return {
      ...this.view(run),
      trace,
      ...(run.report ? { report: run.report } : {}),
    };
  }

  async stop(id: string) {
    const run = this.runs.get(id);
    if (run?.status !== "running")
      throw new Error("That agent has already finished.");
    if (!run.stop)
      throw new Error("That agent isn't ready to stop yet. Try again shortly.");
    run.stopping = true;
    try {
      await run.stop();
    } catch (error) {
      run.stopping = false;
      throw error;
    }
    this.end(id, "stopped");
  }

  private put(id: string, entry: AgentTrace) {
    const run = this.runs.get(id);
    if (!run) return;
    const at = run.trace.findIndex((e) => e.id === entry.id);
    if (at >= 0) run.trace[at] = entry;
    else run.trace.push(entry);
    if (run.trace.length > limits.trace) run.trace.shift();
  }

  private view(run: Run): SubagentRun {
    const calls = run.trace.flatMap((e) =>
      e.kind === "activity" ? [e.activity] : [],
    );
    return {
      id: run.id,
      description: run.description,
      type: run.type,
      model: run.model,
      brief: run.brief,
      status: run.status,
      started: run.started,
      ended: run.ended,
      summary: run.summary,
      calls: calls.length,
      // The card lists them; their output stays in the side thread.
      recent: calls.slice(-5).map(({ detail, ...call }) => call),
      outcome: run.report?.replace(/\s+/g, " ").slice(0, 240),
      parentId: run.parentId,
    };
  }
}

/** A runtime's books, one per session key. */
export class SubagentBooks {
  private books = new Map<string, SubagentBook>();
  /** The session's book, made on first use. */
  open(key: string) {
    let book = this.books.get(key);
    if (!book) this.books.set(key, (book = new SubagentBook()));
    return book;
  }
  get(key: string): SubagentSource | undefined {
    return this.books.get(key);
  }
  /** The session is gone: its agents stop counting as running. */
  drop(key: string) {
    this.books.get(key)?.close();
    this.books.delete(key);
  }
}
