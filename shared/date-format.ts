/**
 * Formatters by their options. `toLocaleTimeString` with options makes a new
 * one on every call, which costs far more than the formatting, and the
 * thread labels every message's time again each time it draws.
 */
const formats = new Map<string, Intl.DateTimeFormat>();

/** `date.toLocale{Date,Time}String(undefined, options)`, with a reused formatter. */
export function formatDate(
  at: Date | number,
  options: Intl.DateTimeFormatOptions,
) {
  const key = JSON.stringify(options);
  let format = formats.get(key);
  if (!format)
    formats.set(key, (format = new Intl.DateTimeFormat(undefined, options)));
  return format.format(at);
}
