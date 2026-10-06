import { readTurn } from "../../../shared/agent-trace";
import { summarizeActivity } from "../../../shared/activity-labels";
import type { AgentProvider } from "../../../shared/agents";
import type { AgentActivity, ChatMessage } from "../../../shared/projects";
import { agentMention } from "../../../shared/rooms";

/** One prompt in the thread's timeline and the start of what answered it. */
export interface TimelineTurn {
  /** The prompt's message, which a jump brings to the top. */
  id: string;
  /** The agent the prompt opened with a mention of; the mention is left out of `prompt`. */
  agent?: AgentProvider;
  prompt: string;
  /** The answer's opening as plain text. An answer that wrote nothing, cut
   * short or all tool calls, says its last commentary, or else what it did.
   * Empty while there is nothing yet. */
  answer: string;
  /** One of its answers is still coming. */
  answering: boolean;
}

const isRow = (m: ChatMessage) =>
  !!(m.compaction || m.handoff || m.reload || m.worktreeCommand);

/** Markdown read as the sentence it says, for a few lines of preview. */
export function plainText(markdown: string, limit = 280) {
  // The start is all a preview shows; the whole of a long answer would be
  // read again on every streamed piece.
  const text = markdown
    .slice(0, limit * 6)
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
}

/** What one message gives the timeline. */
interface MessageText {
  agent?: AgentProvider;
  /** A prompt's text, or an answer's opening; empty when it wrote nothing. */
  said: string;
  /** An answer that wrote nothing: its last commentary and its calls. */
  note: string;
  activity: AgentActivity[];
}
// The timeline is rebuilt on every streamed piece, but only the streaming
// message is a new object; the rest are read once.
const texts = new WeakMap<ChatMessage, MessageText>();
function textOf(m: ChatMessage): MessageText {
  let text = texts.get(m);
  if (text) return text;
  if (m.role === "user") {
    const mention = agentMention(m.body);
    text = {
      ...(mention && { agent: mention.provider }),
      said: plainText(mention ? mention.question : m.body, 160),
      note: "",
      activity: [],
    };
  } else if (m.body) {
    // An answer that opens with a long code block has no prose in its start.
    text = { said: plainText(m.body) || "Code", note: "", activity: [] };
  } else {
    const read = readTurn(m);
    let note = "";
    for (const e of read.shown)
      if (e.kind === "commentary") note = plainText(e.text) || note;
    text = { said: "", note, activity: read.activity };
  }
  texts.set(m, text);
  return text;
}

/**
 * The conversation's prompts in order, each with the answer it got, and
 * which turn every listed message belongs to. Side questions, compaction and
 * other rows belong to the turn they sit in; answers the agent started on its
 * own extend the turn before them, or start one when nothing came before.
 */
export function timelineTurns(listed: ChatMessage[]) {
  const turns: TimelineTurn[] = [];
  const turnOf = new Map<string, number>();
  // Each turn's fallbacks, for when none of its answers wrote anything.
  let note = "",
    did: AgentActivity[] = [];
  const settle = () => {
    const turn = turns.at(-1);
    if (turn && !turn.answer) turn.answer = note || summarizeActivity(did);
    note = "";
    did = [];
  };
  for (const m of listed) {
    const opens =
      (m.role === "user" && !m.side) || (!turns.length && !isRow(m));
    if (opens) {
      settle();
      const text = m.role === "user" ? textOf(m) : undefined;
      turns.push({
        id: m.id,
        ...(text?.agent && { agent: text.agent }),
        prompt: text
          ? text.said || (m.images?.length ? "Image" : "Empty prompt")
          : "Started on its own",
        answer: "",
        answering: false,
      });
    }
    const turn = turns.at(-1);
    if (!turn) continue;
    turnOf.set(m.id, turns.length - 1);
    if (m.role !== "assistant" || isRow(m)) continue;
    if (m.status === "streaming") turn.answering = true;
    if (turn.answer) continue;
    const text = textOf(m);
    turn.answer = text.said;
    note = text.note || note;
    did.push(...text.activity);
  }
  settle();
  return { turns, turnOf };
}
