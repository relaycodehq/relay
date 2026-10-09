// How an agent turn reads while it runs and once it ends, shared by the
// desktop's AgentTurn and the phone app so both tell a turn the same way.
import type { AgentActivity, AgentTrace, ChatMessage } from "./projects";
import { summarizeActivity } from "./activity-labels";
import { isImagePath } from "./answer-images";

/** A turn's events in order; saves from before traces kept only the calls. */
function traceOf(message: ChatMessage): AgentTrace[] {
  return (
    message.trace ??
    (message.activity ?? []).map((activity) => ({
      kind: "activity" as const,
      id: activity.id,
      activity,
    }))
  );
}

/** A call that looks at an image Relay can show; it's still running or done. */
export const looksAtImage = (a: AgentActivity) =>
  a.kind === "read" && a.status !== "failed" && isImagePath(a.label);

/** The image a finished call looked at, which the desktop hands out for its turn. */
export const imageRead = (a: AgentActivity) =>
  looksAtImage(a) && a.status === "complete" ? a.label : undefined;

/** Takes the calls subagents made out of the trace, keyed by the agent call that ran them. */
function nestSubagents(entries: AgentTrace[]) {
  const ids = new Set(entries.map((e) => e.id));
  const calls = new Map<string, AgentActivity[]>();
  const shown = entries.filter((e) => {
    if (e.kind !== "activity") return true;
    const parent = e.activity.parentId;
    // An orphan, its agent row dropped from a full trace, stays in line.
    if (!parent || !ids.has(parent)) return true;
    calls.set(parent, [...(calls.get(parent) ?? []), e.activity]);
    return false;
  });
  return { shown, calls };
}

type TracePart =
  | { kind: "commentary"; id: string; text: string }
  | { kind: "run"; id: string; activity: AgentActivity[] };

/** Consecutive tool calls become one run; commentary splits them. */
export function groupTrace(entries: AgentTrace[]) {
  const parts: TracePart[] = [];
  for (const entry of entries) {
    if (entry.kind === "commentary") {
      parts.push(entry);
      continue;
    }
    const last = parts.at(-1);
    if (last?.kind === "run") last.activity.push(entry.activity);
    else parts.push({ kind: "run", id: entry.id, activity: [entry.activity] });
  }
  return parts;
}

/** Everything a turn's heading and trace are drawn from. */
export function readTurn(message: ChatMessage) {
  const live = message.status === "streaming";
  const entries = traceOf(message);
  const { shown, calls } = nestSubagents(entries);
  // The agent's own calls; a subagent's are counted by its agent row.
  const activity = shown.flatMap((e) =>
    e.kind === "activity" ? [e.activity] : [],
  );
  const current = live
    ? [...activity].reverse().find((a) => a.status === "running")
    : undefined;
  return {
    live,
    entries,
    shown,
    calls,
    activity,
    current,
    /** Between calls with nothing written yet: the thinking line shows. */
    thinking: live && !current && !message.body,
  };
}

/**
 * What a turn's heading says. Open while live, it's the whole run and stays
 * still; folded, it stands in for the one live row.
 */
export type TurnHeading =
  | { kind: "working" }
  | { kind: "call"; activity: AgentActivity }
  | { kind: "writing" }
  | { kind: "thinking" }
  | { kind: "done"; text: string; last?: AgentActivity };

export function turnHeading(
  message: ChatMessage,
  expanded: boolean,
  turn: ReturnType<typeof readTurn> = readTurn(message),
): TurnHeading {
  if (!turn.live)
    return {
      kind: "done",
      text: summarizeActivity(turn.activity) || "Thought",
      last: turn.activity.at(-1),
    };
  if (expanded) return { kind: "working" };
  if (turn.current) return { kind: "call", activity: turn.current };
  return message.body ? { kind: "writing" } : { kind: "thinking" };
}

/**
 * The batch still being worked on shows one row: its running call, else its
 * latest. The ones before fold behind it until commentary or the end of the
 * turn closes the batch and it gets its "Ran 6 commands" summary.
 */
export function batchHead(activity: AgentActivity[]) {
  const head =
    [...activity].reverse().find((a) => a.status === "running") ??
    activity.at(-1)!;
  return { head, earlier: activity.filter((a) => a !== head) };
}

const thinkingWords = [
  "Thinking",
  "Pondering",
  "Mulling it over",
  "Noodling",
  "Ruminating",
  "Percolating",
  "Cogitating",
  "Brewing",
  "Tinkering",
  "Musing",
  "Scheming",
  "Untangling",
  "Marinating",
  "Puzzling",
  "Chewing on it",
  "Connecting dots",
];

const hash = (text: string) =>
  [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;

/**
 * The turn's word for this six-second window: the same on every remount, so
 * the line coming and going around each call doesn't reshuffle it.
 */
export const thinkingWord = (seed: string, now = Date.now()) =>
  thinkingWords[
    hash(`${seed}:${Math.floor(now / 6000)}`) % thinkingWords.length
  ]!;
