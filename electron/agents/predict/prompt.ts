import { unfence } from "../helper-output";

/**
 * What the composer asks beside a thread once its answer is in: the message
 * the person is most likely to send next, in their own words, or nothing.
 */
export const predictionPrompt = `Stop working on the task for a moment. Guess the next message the person will send you in this conversation, so the composer can offer it as a draft they accept with one key.

- Read what you just finished, what you proposed, asked or left open, and how this person writes to you.
- Write it as them, to you: their language, casing, tone and usual length. Usually under 15 words. Never your own voice, never "I'll…", never a summary.
- Prefer the concrete next step they would take: answering your question, picking the option they would want from the ones you offered, asking for the follow-up you suggested, or pointing at what you left unfinished.
- Abstain when you can't guess with confidence: the work is wrapped up, the next step is theirs to do away from the chat (trying it, reviewing it), or any guess would be generic ("thanks", "looks good", "continue", "ok").

Don't use any tools. Reply with only JSON, nothing before or after it: {"next":"<their message>"} or {"next":null}.`;

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
  if (typeof next !== "string") return null;
  const line = next
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  return line && line.length <= 400 ? line : null;
}
