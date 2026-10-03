const CUT = "\n\n… (truncated)";

/** `text` within `limit` characters, ending in a marker when it was cut. */
export function truncated(text: string, limit: number) {
  return text.length > limit ? text.slice(0, limit - CUT.length) + CUT : text;
}
