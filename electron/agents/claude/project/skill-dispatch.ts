import { skillMentions } from "../../../../shared/skill-mentions";

/**
 * Claude Code runs a skill only from a text block that starts with `/name`,
 * and only from the message's last text block; everything after the name is
 * the skill's arguments. So a `$skill` mentioned mid-message is split around:
 * the text before it goes first, then `/name` and the text after it. Earlier
 * mentions become `/name` inline, which the model starts through its Skill
 * tool (only one skill expands per message). Same approach as T3 Code's
 * ClaudeSkillDispatch.
 *
 * shared/skill-mentions decides which mentions count.
 */
export function planSkillDispatch(
  prompt: string,
  skills: ReadonlySet<string>,
  /** The user's own words within `prompt`; only these are the skill's arguments. */
  request = prompt,
): { lead?: string; command: string } | undefined {
  const from = prompt.indexOf(request);
  if (!request || from < 0) return undefined;
  const to = from + request.length;
  const mentions = skillMentions(request, skills).map((m) => ({
    ...m,
    start: m.start + from,
    end: m.end + from,
  }));
  const last = mentions.at(-1);
  if (!last) return undefined;
  // What Relay adds after the user's words goes before the skill instead.
  const lead = (
    mentions
      .slice(0, -1)
      .reduceRight(
        (text, m) => `${text.slice(0, m.start)}/${m.name}${text.slice(m.end)}`,
        prompt.slice(0, last.start),
      )
      .trimEnd() + prompt.slice(to)
  ).trim();
  return {
    ...(lead ? { lead } : {}),
    command: `/${last.name}${prompt.slice(last.end, to)}`.trimEnd(),
  };
}
