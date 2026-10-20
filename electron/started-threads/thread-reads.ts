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

/** Read-only thread discovery, transcript pagination and status polling. */
export class ThreadReads {
  constructor(
    private chats: Pick<
      ProjectChats,
      "list" | "startedThreads" | "get" | "status"
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
    const listed = await Promise.all(
      (ids ?? this.children(lead).map((c) => c.id)).map((id) =>
        this.chats.status(id).catch(() => {
          throw new Error("There's no such thread; see find_threads.");
        }),
      ),
    );
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

  async wait(
    lead: ProjectChat,
    { ids, timeoutSeconds = 300 }: RelayToolArgs<"wait_for_threads">,
    signal: AbortSignal,
  ) {
    const until = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const threads = await this.list(lead, ids);
      const done = threads.every((t) => settled.has(t.status));
      if (done || signal.aborted || Date.now() >= until)
        return json({
          ...(done
            ? {}
            : {
                timedOut: !signal.aborted,
                note: "Still working; wait again or read them.",
              }),
          threads,
        });
      await delay(Math.min(POLL_MS, until - Date.now()), undefined, {
        signal,
      }).catch(() => {});
    }
  }
}
