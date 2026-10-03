import { agentMentionPattern } from "../../../shared/agents";
import { parseCodeReferences } from "../../../shared/code-references";
import { pasteBlock } from "../../../shared/pasted-texts";
import type { ChatMessage } from "../../../shared/projects";

/**
 * ↑/↓ through the messages sent in a conversation, as in Claude Code. ↑ in an
 * empty composer brings back the newest, ↑ again the one before; ↓ goes
 * forward, and past the newest gives back the draft from before. Typing in a
 * recalled message, or moving the caret off its end, ends it: the arrows move
 * the caret again until the composer is empty.
 */
export interface HistoryNav {
  /** The conversation's messages, newest first, as they were at the first ↑. */
  entries: string[];
  /** Which one the composer shows. */
  at: number;
  /** The draft from before the first ↑. */
  before: string;
  /** The composer's text and caret offset once it showed the message; recall holds while both stay. */
  text: string;
  caret: number;
}

export type HistoryDirection = "older" | "newer";

/**
 * What ↑ or ↓ does: puts `text` in the composer and goes on with `nav`, or
 * nothing at all; undefined leaves the key to move the caret.
 */
export type HistoryStep =
  { nav: HistoryPlace | null; text: string } | "hold" | undefined;

/** Where in the history a step lands; the composer adds what it then shows. */
export type HistoryPlace = Omit<HistoryNav, "text" | "caret">;

const IMAGE_TOKENS = /\[Image #\d+\][ \t]?/g;

/**
 * What a sent message gives back to type over: its words, without the agent
 * mention or the code references it carried, as the thread shows it.
 * Screenshots don't come back, so their tokens go too.
 */
export function recallText(body: string) {
  const text = parseCodeReferences(body).body.replace(agentMentionPattern, "");
  let out = "",
    last = 0;
  for (const m of text.matchAll(pasteBlock)) {
    out += text.slice(last, m.index).replace(IMAGE_TOKENS, "") + m[0];
    last = m.index + m[0].length;
  }
  return (out + text.slice(last).replace(IMAGE_TOKENS, "")).trim();
}

/** The user's messages in `shown`, newest first, without an immediate repeat. */
export function sentHistory(shown: ChatMessage[]): string[] {
  const out: string[] = [];
  for (let i = shown.length - 1; i >= 0; i--) {
    const m = shown[i];
    // In a shared thread someone else's message carries their name.
    if (m.role !== "user" || m.unprompted || m.author) continue;
    const text = recallText(m.body);
    if (text && text !== out.at(-1)) out.push(text);
  }
  return out;
}

/** Whether the composer still shows `nav`'s message, untouched. */
const recalling = (
  nav: HistoryNav | null,
  text: string,
  caret: number,
): nav is HistoryNav => !!nav && nav.text === text && nav.caret === caret;

export function stepHistory(
  nav: HistoryNav | null,
  draft: string,
  caret: number,
  direction: HistoryDirection,
  entries: () => string[],
): HistoryStep {
  if (!recalling(nav, draft, caret)) {
    if (draft.trim() || direction === "newer") return undefined;
    const list = entries();
    if (!list.length) return undefined;
    return {
      nav: { entries: list, at: 0, before: draft },
      text: list[0],
    };
  }
  const at = nav.at + (direction === "older" ? 1 : -1);
  // The oldest stays put rather than letting ↑ jump the caret to its start.
  if (at >= nav.entries.length) return "hold";
  if (at < 0) return { nav: null, text: nav.before };
  const { entries: list, before } = nav;
  return { nav: { entries: list, at, before }, text: list[at] };
}
