import { unfence } from "../helper-output";

/**
 * What the composer asks beside a thread once its answer is in: the message
 * the person is most likely to send next, in their own words, or nothing.
 */
export const predictionPrompt = `Stop working on the task for a moment. Guess the next message the person will send you in this conversation, so the composer can offer it as a draft they accept with one key.

- Read what you just finished, what you proposed, asked or left open, and how this person writes to you.
- Write it as them, to you: their language, casing and tone. One line, under 15 words. Never your own voice, never "I'll…", never a summary.
- It's what they were about to type, not what you think they should do: the concrete next step they'd take, like answering your question, picking the option they'd want from the ones you offered, or asking for the follow-up you suggested. Nothing they haven't pointed toward.
- Abstain when you can't guess with confidence: the work is wrapped up, the next step is theirs to do away from the chat (trying it, reviewing it), something just failed or you got their ask wrong (let them assess it), any guess would be generic ("thanks", "looks good", "continue"), or the next step could be risky or touches credentials or private data.

Don't use any tools. Reply with only JSON, nothing before or after it: {"next":"<their message>"} or {"next":null}.`;

/** Longer than a line a person types next. */
const TOO_LONG = 140;
/** The agent talking, not the person. */
const AGENT_VOICE = /^(i'll|i will|i've|let me|here's|here is)\b/i;
/** Praise isn't a next step. */
const EVALUATIVE =
  /^(thanks?|thank you|thx|ty|looks good|lgtm|perfect|great|nice|awesome|cool)\W*$/i;

/** The guess in a reply; null when it abstained or said something else. */
export function parsePrediction(reply: string): string | null {
  const text = unfence(reply);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let next: unknown;
  try {
    next = JSON.parse(json)?.next;
  } catch {
    return null;
  }
  if (typeof next !== "string" || /[\r\n]/.test(next.trim())) return null;
  const line = next
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  if (!line || line.length > TOO_LONG) return null;
  return AGENT_VOICE.test(line) || EVALUATIVE.test(line) ? null : line;
}
