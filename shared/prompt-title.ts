import { pastedTexts, replacePastedTexts } from "./pasted-texts";
import { agentMentionPattern } from "./agents";
import { sliceWhole } from "./truncate";
import { memesAsMeanings } from "./memes";

/**
 * The `@acp:goose ` a composer puts before a message to a registry agent,
 * which has no mention a person types (`buildSend`).
 */
const registryMentionPattern = /^@acp:[a-z0-9][a-z0-9-]*(?=\s|$)\s*/;

/**
 * What a thread is called from its first message until a generated title
 * comes: the desktop names it so, and a phone opening one it just started.
 */
export function promptTitle(body: string): string {
  const pastes = pastedTexts(body);
  // The mention goes first: a meme only reads as its meaning at a line's start.
  const text = memesAsMeanings(
    replacePastedTexts(body, () => "\n\n")
      .replace(agentMentionPattern, "")
      .replace(registryMentionPattern, ""),
  );
  // A message that is only a paste is named after the paste's first line;
  // one that is only screenshots waits for a generated title as "Screenshot".
  const title = (
    text.trim() ||
    (pastes[0]?.text.trimStart().split("\n", 1)[0] ?? "")
  ).trim();
  return sliceWhole(title, 0, 65) || "Screenshot";
}
