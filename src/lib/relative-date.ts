export function relativeDate(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : minutes < 10080
        ? `${Math.floor(minutes / 1440)}d`
        : new Date(value).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
}
/** "5m ago" while recent, a bare date once relativeDate gives one. */
export function timeAgo(value: string) {
  const rel = relativeDate(value);
  return /^\d+[mhd]$/.test(rel) ? `${rel} ago` : rel;
}
