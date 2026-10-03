import { useEffect, useState } from "react";

/** True for `ms` after `at`, then re-renders to say it's over. */
export function useRecent(at: number | undefined, ms: number) {
  const [, expire] = useState(0);
  const recent = at !== undefined && Date.now() - at < ms;
  useEffect(() => {
    if (!recent) return;
    const timer = setTimeout(
      () => expire((n) => n + 1),
      ms - (Date.now() - at),
    );
    return () => clearTimeout(timer);
  }, [recent, at, ms]);
  return recent;
}
