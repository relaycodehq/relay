const COLOR =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\))$/i;

/**
 * Whether inline code reads as a colour worth a swatch: hex or a colour
 * function. Names like `red` stay code; they're as often a variable or branch.
 */
export function looksLikeColor(value: string): boolean {
  if (!COLOR.test(value)) return false;
  // `#123` is far likelier an issue number than a colour.
  return !/^#[1-9]\d{2,3}$/.test(value) || /^#(\d)\1+$/.test(value);
}
