import { pastedTexts, replacePastedTexts } from "./pasted-texts";
import { agentMentionPattern } from "./agents";

/**
 * What a thread is called from its first message until a generated title
 * comes: the desktop names it so, and a phone opening one it just started.
 */
export function promptTitle(body: string): string {
  const pastes = pastedTexts(body);
  const text = replacePastedTexts(body, () => "\n\n");
  // A message that is only a paste is named after the paste's first line;
  // one that is only screenshots waits for a generated title as "Screenshot".
  return (
    (
      text.replace(agentMentionPattern, "").trim() ||
      (pastes[0]?.text.trimStart().split("\n", 1)[0] ?? "")
    )
      .trim()
      .slice(0, 65) || "Screenshot"
  );
}
