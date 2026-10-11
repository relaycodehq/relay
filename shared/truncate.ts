const CUT = "\n\n… (truncated)";

const lowSurrogate = (text: string, at: number) => {
  const code = text.charCodeAt(at);
  return code >= 0xdc00 && code <= 0xdfff;
};

/** `text.slice(start, end)` without cutting an emoji's surrogate pair in half at either end. */
export function sliceWhole(text: string, start: number, end = text.length) {
  if (start < 0) start = Math.max(0, text.length + start);
  if (end < 0) end = Math.max(0, text.length + end);
  if (start > 0 && lowSurrogate(text, start)) start++;
  if (end < text.length && lowSurrogate(text, end)) end--;
  return text.slice(start, end);
}

/** `text` within `limit` characters, ending in a marker when it was cut. */
export function truncated(text: string, limit: number) {
  return text.length > limit
    ? sliceWhole(text, 0, limit - CUT.length) + CUT
    : text;
}
