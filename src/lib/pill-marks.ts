/**
 * The attribute marking each kind of pill in copied HTML, with what it stands
 * for as its value, so a composer it's pasted into makes a pill of it again.
 */
export const PILL_MARK = {
  skill: "data-relay-skill",
  quote: "data-relay-quote",
  file: "data-relay-file",
  paste: "data-relay-paste",
} as const;
