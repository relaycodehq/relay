import { setTimeout as delay } from "node:timers/promises";
import { inputBlocksThread } from "../../shared/thread-state";
import { sliceWhole } from "../../shared/truncate";
import { agentName } from "../../shared/agents";
import type { ProjectChat, ChatSummary } from "../../shared/projects";
import { noteForAgent } from "../../shared/thread-notes";
import type { ProjectChats, ChatStatus } from "../project-chats";
import { toolText, MESSAGE_CHARS, type RelayToolArgs } from "../relay-mcp";
import type { ProjectAccess } from "./project-access";
import { json, localTime } from "./tool-output";

const settled = new Set<ChatStatus["status"]>([
  "needs-input",
  "done",
  "stopped",
  "failed",
  "idle",
]);

/** Where a read stops adding messages, under what the agent's harness cuts from a tool's result. */
const PAGE_CHARS = 80_000;
const POLL_MS = 1000;

/** Where a thread is when that's another computer, as the tools say it. */
function away({ sentTo }: Pick<ChatSummary, "sentTo">) {
  if (!sentTo) return {};
  return {
    on: sentTo.computer,
    ...(sentTo.state === "away"
      ? sentTo.live
        ? {}
        : {
            note: `Bring it back with hand_off_thread to "here" before messaging it.`,
          }
      : {
          handoff:
            sentTo.state === "sending"
              ? `on its way to ${sentTo.computer}`
              : `coming back from ${sentTo.computer}`,
        }),
    ...(sentTo.error ? { handoffError: sentTo.error } : {}),
  };
}

/** A message's text from `offset`, and where to read on when there's more. */
function bodyFrom(body: string, offset = 0) {
  const part = sliceWhole(body, offset, offset + MESSAGE_CHARS);
  const end = offset + part.length;
  return end < body.length ? { body: part, nextOffset: end } : { body: part };
}

/** A message from a started thread that a wait handed to its lead itself. */
interface Heard {
  from: string;
  thread: string;
  message: string;
}

/** A wait_for_threads running now: which threads it covers, every one the lead started without `ids`. */
interface Wait {
  ids?: string[];
  /** Aborted when the lead's call is: what it returns then never reaches the lead. */
  signal: AbortSignal;
  /** Threads the lead started that messaged it meanwhile, through its thread. */
  messaged: string[];
  /** Messages the wait hands over, so they never queue in the lead's thread. */
  heard: Heard[];
  /** Threads whose message another wait of the lead's handed over. */
  heardElsewhere: string[];
  woken: AbortController;
  /** Whether the wait's result reached the lead, once it returned. */
  reached: Promise<boolean>;
}

const covers = (wait: Wait, id: string) => !wait.ids || wait.ids.includes(id);

const messagedMeanwhile = (wait: Wait) =>
  wait.messaged.length + wait.heard.length + wait.heardElsewhere.length > 0;

/** What a wait that ended says besides where each thread stands. */
function waitOutcome(wait: Wait, done: boolean, aborted: boolean) {
  const { heard, messaged, heardElsewhere } = wait;
  const notes: string[] = [];
  if (heard.length)
    notes.push("`heard` holds their messages; they won't come in again.");
  if (messaged.length)
    notes.push("The messages from `messaged` come in this thread next.");
  if (heardElsewhere.length)
    notes.push(
      "The messages from `heardElsewhere` are in another wait_for_threads of yours.",
    );
  if (notes.length)
    return {
      ...(heard.length ? { heard } : {}),
      ...(messaged.length ? { messaged } : {}),
      ...(heardElsewhere.length ? { heardElsewhere } : {}),
      note: `${notes.join(" ")} Answer with send_to_thread, then wait again if you need to.`,
    };
  if (done) return {};
  return {
    timedOut: !aborted,
    note: "Still working; wait again or read them.",
  };
}

/** Read-only thread discovery, transcript pagination and status polling. */
export class ThreadReads {
  private waits = new Map<string, Set<Wait>>();

  constructor(
    private chats: Pick<
      ProjectChats,
      "list" | "startedThreads" | "get" | "statuses"
    >,
    private projects: Pick<ProjectAccess, "real" | "all">,
  ) {}

  /** The threads the lead started, in whichever project. */
  children(lead: ProjectChat) {
    return this.chats.startedThreads(lead.id).filter((c) => !c.archivedAt);
  }

  /** Any listed thread, as list() shows it. */
  async thread(id: string) {
    const chat = await this.chats.get(id).catch(() => {
      throw new Error("There's no such thread; see find_threads.");
    });
    const summary = this.chats
      .list(chat.projectId)
      .find((c) => c.id === id && !c.archivedAt);
    if (!summary) throw new Error("There's no such thread; see find_threads.");
    return { summary, chat };
  }

  async list(lead: ProjectChat, ids?: string[]) {
    const listed = await this.chats
      .statuses(ids ? { ids } : { startedBy: lead.id })
      .catch(() => {
        throw new Error("There's no such thread; see find_threads.");
      });
    const names = listed.some(
      ({ summary }) => summary.projectId !== lead.projectId,
    )
      ? new Map((await this.projects.real()).map((p) => [p.id, p.name]))
      : undefined;
    return listed.map(({ summary, ...status }) => ({
      id: summary.id,
      title: summary.title,
      ...status,
      ...(summary.projectId !== lead.projectId
        ? { project: names?.get(summary.projectId) ?? summary.projectId }
        : {}),
      ...(summary.branch ? { branch: summary.branch } : {}),
      ...away(summary),
    }));
  }

  async find(
    lead: ProjectChat,
    { project, query, limit = 20 }: RelayToolArgs<"find_threads">,
  ) {
    const projects = (await this.projects.all()).filter(
      (p) => !project || p.id === project,
    );
    if (!projects.length)
      return toolText("There's no such project; see list_projects.", true);
    const words = query?.toLowerCase().split(/\s+/) ?? [];
    const found = projects
      .flatMap((p) => this.chats.list(p.id).map((summary) => ({ summary, p })))
      .filter(
        ({ summary: c }) =>
          !c.archivedAt &&
          !c.empty &&
          // A reviewer is part of its review, found through the review.
          !c.reviewer &&
          words.every((w) =>
            `${c.title} ${c.branch ?? ""}`.toLowerCase().includes(w),
          ),
      )
      .sort((a, b) => b.summary.updated - a.summary.updated)
      .slice(0, limit);
    return json(
      found.map(({ summary: c, p }) => ({
        id: c.id,
        title: c.title,
        project: p.scratch ? "Scratchpad" : p.name,
        ...(c.id === lead.id ? { you: true } : {}),
        status: inputBlocksThread(c)
          ? "needs-input"
          : c.running
            ? "working"
            : c.settledAt || c.autoSettled
              ? "settled"
              : "idle",
        updated: localTime(c.updated),
        ...(c.contextAgent || c.provider
          ? { agent: agentName(c.contextAgent ?? c.provider!) }
          : {}),
        ...(c.branch ? { branch: c.branch } : {}),
        ...(c.startedBy ? { startedBy: c.startedBy.chatId } : {}),
        ...away(c),
      })),
    );
  }

  async read({
    id,
    after,
    before,
    message,
    offset,
    limit = 50,
  }: RelayToolArgs<"read_thread">) {
    const chat = await this.chats.get(id).catch(() => {
      throw new Error("There's no such thread; see find_threads.");
    });
    const main = chat.messages.filter((m) => !m.parentId);
    const said = (m: ProjectChat["messages"][number], from?: number) => ({
      id: m.id,
      from: m.role === "user" ? (m.author ?? "user") : agentName(m.provider),
      ...(m.status === "complete" ? {} : { status: m.status }),
      ...bodyFrom(m.body, from),
      ...(m.error ? { error: m.error } : {}),
      ...(m.changes?.length ? { changed: m.changes.map((c) => c.path) } : {}),
    });
    if (message) {
      const m = main.find((m) => m.id === message);
      if (!m) throw new Error("There's no such message in this thread.");
      return json(said(m, offset));
    }
    const where = (key: "after" | "before", value?: string) => {
      if (!value) return undefined;
      const at = main.findIndex((m) => m.id === value);
      if (at < 0)
        throw new Error(
          `That \`${key}\` isn't a message in this thread; read it again without it.`,
        );
      return at;
    };
    const from = (where("after", after) ?? -1) + 1;
    const to = where("before", before) ?? main.length;
    const range = main.slice(from, to);
    // On from `after` the page fills oldest first; otherwise newest first,
    // since what a reader comes for is usually the latest answer.
    const forward = after !== undefined;
    const shown: typeof main = [];
    let chars = 0;
    for (const m of forward ? range : [...range].reverse()) {
      const size = Math.min(m.body.length, MESSAGE_CHARS);
      if (shown.length === limit || (shown.length && chars + size > PAGE_CHARS))
        break;
      shown.push(m);
      chars += size;
    }
    if (!forward) shown.reverse();
    const cut = shown.length < range.length;
    // `next` stops before an answer still streaming, so the next read
    // returns it again, finished.
    const unfinished = shown.findIndex((m) => m.status === "streaming");
    const next =
      (unfinished < 0 ? shown.at(-1) : shown[unfinished - 1])?.id ??
      after ??
      null;
    // The notes come first: what the user keeps at hand there.
    const notes = after || before ? [] : (chat.notes ?? []).map(noteForAgent);
    return json({
      ...away(chat),
      ...(notes.length ? { notes } : {}),
      messages: shown.map((m) => said(m)),
      next,
      ...(cut && forward ? { more: true } : {}),
      ...(cut && !forward ? { earlier: shown[0]!.id } : {}),
    });
  }

  /**
   * Whether the lead is in a wait_for_threads that covers `id`, a thread it
   * started. A cancelled one's result never reaches it.
   */
  waitsFor(lead: string, id: string) {
    return [...(this.waits.get(lead) ?? [])].some(
      (w) => !w.signal.aborted && covers(w, id),
    );
  }

  /**
   * Hands `message` from `from` to one of the lead's waits that covers it,
   * and ends the rest: the lead reads no result until all its calls are
   * back. Whether the message reached the lead; when it didn't, it's the
   * caller's to deliver.
   */
  async hand(
    lead: string,
    from: Pick<ProjectChat, "id" | "title">,
    message: string,
  ) {
    const live = [...(this.waits.get(lead) ?? [])].filter(
      (w) => !w.signal.aborted,
    );
    const taker = live.find((w) => covers(w, from.id));
    if (!taker) return false;
    taker.heard.push({ from: from.id, thread: from.title, message });
    for (const wait of live) {
      if (wait !== taker && !wait.heardElsewhere.includes(from.id))
        wait.heardElsewhere.push(from.id);
      wait.woken.abort();
    }
    return taker.reached;
  }

  /** A thread the lead started messaged it: its waits end, so it reads the message. */
  messaged(lead: string, from: string) {
    for (const wait of this.waits.get(lead) ?? []) {
      if (!wait.messaged.includes(from)) wait.messaged.push(from);
      wait.woken.abort();
    }
  }

  async wait(
    lead: ProjectChat,
    { ids, timeoutSeconds = 300 }: RelayToolArgs<"wait_for_threads">,
    signal: AbortSignal,
  ) {
    const until = Date.now() + timeoutSeconds * 1000;
    let tellReached = (_reached: boolean) => {};
    const wait: Wait = {
      ...(ids ? { ids } : {}),
      signal,
      messaged: [],
      heard: [],
      heardElsewhere: [],
      woken: new AbortController(),
      reached: new Promise((resolve) => (tellReached = resolve)),
    };
    const waits = this.waits.get(lead.id) ?? new Set();
    this.waits.set(lead.id, waits.add(wait));
    let reached = false;
    try {
      for (;;) {
        const threads = await this.list(lead, ids);
        const done = threads.every((t) => settled.has(t.status));
        const ended = done || messagedMeanwhile(wait);
        if (ended || signal.aborted || Date.now() >= until) {
          reached = !signal.aborted;
          return json({
            ...waitOutcome(wait, done, signal.aborted),
            threads,
          });
        }
        await delay(Math.min(POLL_MS, until - Date.now()), undefined, {
          signal: AbortSignal.any([signal, wait.woken.signal]),
        }).catch(() => {});
      }
    } finally {
      waits.delete(wait);
      if (!waits.size) this.waits.delete(lead.id);
      tellReached(reached);
    }
  }
}
