/**
 * A `$name` skill mention, as T3 Code reads one (its composerInlineTokens):
 * any currency sign works as the `$`, a name may start with a digit but needs
 * a letter, and amounts like `$20`, `$20k` or `$1e6` stay prose. The mention
 * starts the text or follows whitespace, and ends at whitespace or the end.
 * Group 1 is the whitespace before it, group 2 the name.
 */
const mentionSource =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/u
    .source;
/** Every mention in a text; global, so for `matchAll` and `replace` only. */
export const skillMentionPattern = new RegExp(mentionSource, "gu");

/** Text that might mention a skill, before asking which skills there are. */
export const mayMentionSkill = (text: string) =>
  new RegExp(mentionSource, "u").test(text);

/**
 * The `$name` mentions in `text` that name one of `skills`, in order; other
 * names stay text, so `$HOME` does. Sending and showing a message both go by
 * this, so a skill shown as a pill is one the agent runs.
 */
export function skillMentions(text: string, skills: ReadonlySet<string>) {
  return [...text.matchAll(skillMentionPattern)].flatMap((match) => {
    const name = match[2];
    if (!skills.has(name)) return [];
    const start = match.index + match[1].length;
    return [{ name, start, end: match.index + match[0].length }];
  });
}

/** A skill the user picked as a pill, kept on the message it went out in. */
export interface SentSkill {
  name: string;
  label: string;
}

/**
 * The skills a draft picked as pills (`labels`, each `$name` token's label)
 * that its text still mentions, so the sent message pills the same ones.
 */
export function pickedSkills(
  text: string,
  labels: Record<string, string>,
): SentSkill[] {
  const names = new Set(
    Object.keys(labels)
      .filter((token) => token.startsWith("$"))
      .map((token) => token.slice(1)),
  );
  const picked = new Map<string, SentSkill>();
  for (const { name } of skillMentions(text, names))
    picked.set(name, { name, label: labels[`$${name}`]?.trim() || name });
  return [...picked.values()].slice(0, 20);
}
