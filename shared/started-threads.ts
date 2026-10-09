// The threads a lead's agent started with Relay's start_threads tool, as its
// turn and its composer tell them: which call started which, in what order
// they're listed, and the one line each gets. Desktop and phone read the same.
import type { AgentActivity, AgentProvider, ChatMessage } from "./projects";
import { agentName } from "./agents";
import { liveLabel, plural } from "./activity-labels";
import { familyLine, type FamilyMember } from "./started-families";
import { inputBlocksThread } from "./thread-state";
import { preview } from "./thread-news";

/** A call to Relay's start_threads tool. */
export const isStartThreads = (a: AgentActivity) =>
  a.mcp?.server === "relay" && a.mcp.tool === "start_threads";

/** The ids a start_threads call's result names, when it can be read. */
export function startedIds(result: string | undefined) {
  try {
    const parsed = JSON.parse(result ?? "");
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.flatMap((t) =>
      t && typeof t.id === "string" ? [t.id] : [],
    );
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}

/** Needs the user first, then working, then done. */
export const startedRank = (c: FamilyMember) =>
  c.waiting ? 0 : c.running ? 1 : 2;

export const byStanding = <C extends FamilyMember>(a: C, b: C) =>
  startedRank(a) - startedRank(b) || a.created - b.created;

/** The lead's started threads, in the order they're listed. */
export const startedOf = <C extends FamilyMember>(lead: string, chats: readonly C[]) =>
  chats.filter((c) => c.startedBy?.chatId === lead).sort(byStanding);

/** Something in the family still moves: the composer's strip shows. */
export const familyLive = (started: readonly FamilyMember[]) =>
  started.some((c) => c.running || c.waiting);

/** A turn's start_threads calls that went through, or are still going. */
export const startCalls = (message: Pick<ChatMessage, "trace" | "activity">) =>
  (
    message.trace?.flatMap((e) => (e.kind === "activity" ? [e.activity] : [])) ??
    message.activity ??
    []
  ).filter((a) => isStartThreads(a) && a.status !== "failed");

export interface StartGroup<C> {
  /** The start_threads call. */
  id: string;
  /** How many it started, as far as is known. */
  count: number;
  threads: C[];
}

/**
 * Each start_threads call in a turn with the threads it started. A result
 * that can't be read (Codex keeps none, a phone gets long ones cut) falls
 * back to the threads started while the turn ran, all under its first call.
 */
export function startGroups<C extends FamilyMember>(
  message: Pick<ChatMessage, "created" | "ended" | "trace" | "activity">,
  started: readonly C[],
): StartGroup<C>[] {
  const calls = startCalls(message);
  if (!calls.length) return [];
  const ids = calls.map((a) => (a.detailCut ? undefined : startedIds(a.detail)));
  if (ids.every(Boolean))
    return calls.map((a, i) => ({
      id: a.id,
      count: ids[i]!.length,
      threads: started.filter((c) => ids[i]!.includes(c.id)).sort(byStanding),
    }));
  const end = message.ended ?? Infinity;
  const during = started
    .filter((c) => c.created >= message.created && c.created <= end)
    .sort(byStanding);
  return during.length
    ? [{ id: calls[0]!.id, count: during.length, threads: during }]
    : [];
}

/** What the strip over the composer says, with the subagents working beside them. */
export function slotLine(started: readonly FamilyMember[], agents = 0) {
  if (!agents) return familyLine(started);
  const asking = started.filter((c) => c.waiting).length;
  const working = started.filter(
    (c) => c.running && !inputBlocksThread(c),
  ).length;
  const needs = (n: number) => `need${n === 1 ? "s" : ""} you`;
  return [
    plural(agents, "agent"),
    working && `${plural(working, "thread")} working`,
    asking &&
      (working ? `${asking} ${needs(asking)}` : `${plural(asking, "thread")} ${needs(asking)}`),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a started thread's row says under its title. */
export interface StartedNow {
  tone: "asks" | "plain";
  text: string;
}

/** The last thing a started thread said or is doing, from what the phone or desktop holds of it. */
export function startedNow(
  chat: FamilyMember & { provider?: AgentProvider },
  held: {
    /** Its main conversation's latest answer. */
    answer?: Pick<ChatMessage, "body" | "status" | "trace" | "activity">;
    /** The open question or approval's title. */
    request?: string;
  },
): StartedNow {
  if (chat.waiting)
    return {
      tone: "asks",
      text: held.request ? `Needs you: ${held.request}` : "Needs you",
    };
  const answer = held.answer;
  const body = answer?.body.trim() ?? "";
  if (chat.running) {
    const calls =
      answer?.trace?.flatMap((e) => (e.kind === "activity" ? [e.activity] : [])) ??
      answer?.activity ??
      [];
    const current = [...calls].reverse().find((a) => a.status === "running");
    const line = current
      ? liveLabel(current)
      : body
        ? preview(body.split("\n").filter((l) => l.trim()).at(-1) ?? "", 120)
        : "Starting…";
    return {
      tone: "plain",
      text: chat.provider ? `${agentName(chat.provider)} · ${line}` : line,
    };
  }
  const said = body && preview(body, 120);
  const ended =
    answer?.status === "failed"
      ? "Failed"
      : answer?.status === "cancelled"
        ? "Stopped"
        : "Done";
  return { tone: "plain", text: said ? `${ended}: ${said}` : ended };
}
