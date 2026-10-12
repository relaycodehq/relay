/** Text that might mention a skill, before asking which skills there are. */
export const mayMentionSkill = (text: string) => /(^|\s)\$[A-Za-z_]/.test(text);

/**
 * The `$name` mentions in `text` that name one of `skills`, in order. A
 * mention starts the text or follows whitespace, and a sentence's own
 * punctuation isn't part of the name (`$review.`); other names stay text, so
 * `$HOME` or `$5` do. Sending and showing a message both go by this, so a
 * skill shown as a pill is one the agent runs.
 */
export function skillMentions(text: string, skills: ReadonlySet<string>) {
  return [...text.matchAll(/(^|\s)\$([A-Za-z_][A-Za-z0-9_.:-]*)/g)].flatMap(
    (match) => {
      const name = match[2].replace(/[.:-]+$/, "");
      if (!skills.has(name)) return [];
      const start = match.index! + match[1].length;
      return [{ name, start, end: start + 1 + name.length }];
    },
  );
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
